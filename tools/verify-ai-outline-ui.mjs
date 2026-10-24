#!/usr/bin/env node
/* 大纲与正文生成导图浏览器验证。使用独立端口、随机临时导图与假API配置、临时浏览器资料；
 * 不读取个人导图或真实密钥。需要本机Edge/Chrome与Node>=22。
 * node tools/verify-ai-outline-ui.mjs --port 8896 --project <项目路径>
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--" + name + "="));
  return eq ? eq.slice(name.length + 3) : dflt;
};
const PORT = argOf("port", process.env.MM_PORT || "8788");
const URL_ = argOf("url", `http://127.0.0.1:${PORT}/`);
const EDGE_ARG = argOf("edge", process.env.MM_BROWSER || "");
const CHROME_ARG = argOf("chrome", "");
const TIMEOUT = Number(argOf("timeout", "60000"));
const KEEP = argv.includes("--keep");
const UI_MAP="ui-flat-"+Date.now();

if (typeof WebSocket !== "function") {
  console.error("这个脚本需要 Node ≥ 22（用到内置 WebSocket）。当前 " + process.version +
    "，请换 Node，或改用浏览器手测：打开 " + URL_ + " 后按 README 的验收清单走一遍。");
  process.exit(2);
}

/* ---------------- 找浏览器（先探测、再回退；不硬编码机器专属路径） ---------------- */
function findBrowser() {
  const named = [EDGE_ARG, CHROME_ARG].filter(Boolean);
  const env = [];
  const probes = [
    process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    process.env["LOCALAPPDATA"] && join(process.env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean);
  const cands = [...named, ...env, ...probes];
  for (const c of cands) if (c && existsSync(c)) return c;
  for (const exe of ["msedge", "chrome"]) {                       // 最后试 PATH
    try {
      const r = spawnSync(process.platform === "win32" ? "where" : "which", [exe], { encoding: "utf8" });
      const p = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (p && existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}
const BROWSER = findBrowser();

/* ---------------- 小工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULTS = [];
function check(name, cond, detail) {
  RESULTS.push({ name, ok: !!cond });
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond ? "" : "   → " + (detail || "")));
  return !!cond;
}
async function freePort() {
  return await new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}

/* ---------------- 开/关浏览器 + CDP ---------------- */
let child = null, profile = null, ws = null, seq = 0;
const waiters = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  const t = setTimeout(() => { waiters.delete(id); rej(new Error("CDP 超时：" + method)); }, 15000);
  waiters.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页内异常：" + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
const rectOf = (sel) => ev(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`).then((s) => (s ? JSON.parse(s) : null));
async function mouse(type, x, y, clickCount, buttons) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount, pointerType: "mouse" });
}
const clickAt = async (x, y) => { await mouse("mousePressed", x, y, 1, 1); await mouse("mouseReleased", x, y, 1, 0); };
async function clickSel(sel) { await ev('document.querySelector('+JSON.stringify(sel)+').scrollIntoView({block:"nearest"})'); const p = await rectOf(sel); if (!p) throw new Error("页面上找不到元素：" + sel); await clickAt(p.x, p.y); return p; }
const SCAN = `(() => {
  const st = window.Mindmap.state(), m = st.cur;
  /* 形状/遍历一律走 **vendor 导出的助手**（数据形状只有那一处权威）：这里不许自己写
     Array.isArray(m.nodes) ? m.nodes : [m.root] —— 页内片段抄一份，迟早和产品侧走偏。 */
  const M2 = window.Mindmap, trees = M2.nodesOf(m), live = M2.liveIds(m);
  const bad = [];
  /* 拿不到清单就**判失败**：兜底成空数组会让"扫 0 张表 → 0 孤儿 → 绿灯"，把"没拿到数据"变成"验过了"。 */
  const maps = M2 && M2.LAYER_MAPS, lists = M2 && M2.LAYER_LISTS;
  if (!Array.isArray(maps) || !maps.length || !Array.isArray(lists)) {
    return JSON.stringify({ orphans: ["清单没拿到或为空（maps=" + JSON.stringify(maps) + " lists=" + JSON.stringify(lists) + "）"], listsMissing: true, tree: live.size, pos: 0, size: 0, sel: st.sel });
  }
  for (const t of maps) for (const id of Object.keys(m[t] || {})) if (!live.has(id)) bad.push(t + ":" + id);
  for (const t of lists) for (const e of (Array.isArray(m[t]) ? m[t] : [])) { if (!e || !e.from || !e.to || !live.has(e.from.node) || !live.has(e.to.node)) bad.push(t + ":" + ((e && e.id) || "?")); }
  let tree = 0; for (const t of trees) (function w(n) { tree++; (n.children || []).forEach(w); })(t);
  return JSON.stringify({ orphans: bad, tree, pos: Object.keys(m.pos || {}).length, size: Object.keys(m.size || {}).length, sel: st.sel });
})()`;

async function openBrowser() {
  const port = await freePort();
  profile = join(tmpdir(), "mm-verify-" + randomUUID());                    // 系统临时目录 + 随机名，结束即删
  child = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1280,800", URL_], { stdio: "ignore", windowsHide: true });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("CDP WebSocket 连不上")); });
        ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = m.id && waiters.get(m.id); if (w) { waiters.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); } };
        return port;
      }
    } catch (e) {}
    await sleep(250);
  }
  throw new Error("20 秒内没等到调试端口 " + port + "（可能这台机器/这个会话不允许起浏览器进程）");
}

const fs=await import('node:fs'),path=await import('node:path'),http=await import('node:http');
const {pathToFileURL}=await import('node:url'),{createRequire}=await import('node:module');
const project=argOf('project',process.cwd()),base=path.resolve(argOf('artifacts',path.join(project,'tmp')));fs.mkdirSync(base,{recursive:true});
const temp=fs.mkdtempSync(path.join(base,'outline-browser-')),received=[],sockets=new Set();
const require=createRequire(path.join(project,'package.json')),{makePlan}=require('./tools/structure-review-fixture.cjs'),structureCalls=[];
const sourceText='导数学习：先理解变化率，再给出极限定义；可导则连续，最后用于切线估算。';
const plan={edges:[{from:'n1',to:'n2',kind:'hierarchy',label:''},{from:'n2',to:'n3',kind:'inference',label:'成立须满足'},{from:'n2',to:'n4',kind:'relation',label:'用于估算'}],nodes:[
 {id:'n1',title:'导数与局部变化',text:'研究函数的局部变化，整理定义、条件与应用。',origin:'source'},
 {id:'n2',title:'极限定义',origin:'source',blocks:[{type:'text',text:'从平均变化率取极限：'},{type:'math',latex:"f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}"}]},
 {id:'n3',title:'可导条件',text:'可导则连续。'.repeat(12),origin:'source'},
 {id:'n4',title:'切线估算',text:'用局部变化率估算函数值。'.repeat(10),origin:'source'}]};
const mock=http.createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const data=JSON.parse(raw);if(data.messages[0].content.includes('你是整图结构复核员')){structureCalls.push(data);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(makePlan(JSON.parse(data.messages.at(-1).content)))},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:750}}}));return;}received.push(data);
 const last=JSON.parse(data.messages.at(-1).content),source=last.source || '';
 let value=structuredClone(plan);if(data.messages[0].content.includes('允许为理解'))value.nodes[3].origin='supplement';
 if(source.includes('BAD'))value.edges.push({from:'n1',to:'missing',kind:'contains'});
 const content=JSON.stringify(value);res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(let i=0;i<content.length;i+=65){if(res.destroyed)return;res.write('data: '+JSON.stringify({choices:[{delta:{content:content.slice(i,i+65)}}]})+'\n\n');await sleep(source.includes('STOP') || source.includes('SWITCH')?120:35);}
 res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:2000,prompt_cache_hit_tokens:1500,prompt_cache_miss_tokens:500,completion_tokens:200}})+'\n\ndata: [DONE]\n\n');
});mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');
const profiles=Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]));
const config={version:1,activeProvider:'custom',profiles};
function saveConfig(enabled){config.profiles.custom=enabled?{baseURL:'http://127.0.0.1:'+mock.address().port+'/v1',model:'outline-fake-model',apiKey:'fake-outline-browser-key'}:{baseURL:'',model:'',apiKey:''};fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify(config));}
saveConfig(false);
const wait=async expression=>{for(let i=0;i<250;i++){if(await ev(expression))return;await sleep(60);}throw Error('UI timeout: '+expression);};
const fill=async(text,mode='ai',placement=null)=>ev(`(()=>{document.getElementById('mmOutlineText').value=${JSON.stringify(text)};document.getElementById('mmOutlineMode').value=${JSON.stringify(mode)};document.getElementById('mmOutlineMode').dispatchEvent(new Event('change'));${placement?`document.getElementById('mmOutlinePlacement').value=${JSON.stringify(placement)};`:''}})()`);
const submit=async()=>{await clickSel('#mmOutlineGenerate');};
const finished=()=>wait("!MMAIOutline.running && !document.querySelector('[data-outline-hide]').hidden && !document.getElementById('mmDlg').open");
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMAIOutline && !!window.MMFiles');
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 check('All three creation entries are grouped above the library and the obsolete import entry is absent',await ev("(()=>{const a=document.querySelector('.mm-home-actions'),lib=document.querySelector('.mm-home-library');return a.querySelectorAll('button').length===3 && a.getBoundingClientRect().bottom<lib.getBoundingClientRect().top && !document.querySelector('[data-mm=import-home]') && !document.querySelector('.mm-home-start')})()"));
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:950,deviceScaleFactor:1,mobile:false});await sleep(150);check('Desktop creation entries stay together in one row',await ev("new Set([...document.querySelectorAll('.mm-home-actions button')].map(e=>Math.round(e.getBoundingClientRect().top))).size===1"));
 const homeShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'home-creation-desktop.png'),Buffer.from(homeShot.data,'base64'));
 await clickSel('[data-mm="lecture-new"]');check('Lecture entry directly opens PDF mode with its own heading',await ev("document.getElementById('mmOutlineInputSource').value==='files' && !document.getElementById('mmLectureBox').hidden && document.getElementById('mmOutlineHeading').textContent==='课件 / 讲义生成导图'"));await clickSel('#mmOutlineCancel');
 await clickSel('[data-mm="paste-new"]');check('Text entry explicitly returns to text mode after visiting lecture generation',await ev("document.getElementById('mmOutlineInputSource').value==='text' && !document.getElementById('mmOutlineText').hidden"));await clickSel('#mmOutlineCancel');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(150);check('Mobile keeps every home creation entry within the viewport',await ev("[...document.querySelectorAll('.mm-home-actions button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})"));const mobileShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'home-creation-mobile.png'),Buffer.from(mobileShot.data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:1250,height:658,deviceScaleFactor:1,mobile:false});await sleep(150);
 await clickSel('[data-mm="paste-new"]');await fill(sourceText);await submit();await wait("document.getElementById('mmOutlineError').textContent.includes('API 接入')");
 check('Unconfigured AI returns to the existing form without creating a map or calling a model',received.length===0 && await ev("!Mindmap.state().cur && document.getElementById('mmOutlineError').textContent.includes('API 接入')"));
 await clickSel('#mmOutlineSettings');await wait("document.getElementById('mmAPISettingsDialog').open && !document.getElementById('mmAPISave').disabled");
 check('Generation opens the one existing API settings dialog',await ev("document.querySelectorAll('#mmAPISettingsDialog').length===1 && !document.getElementById('mmDlg').open"));
 await clickSel('#mmAPISettingsClose');await wait("document.getElementById('mmOutlineForm') && document.getElementById('mmDlg').open");
 check('Returning from settings preserves pasted source and generation choice',await ev('document.getElementById("mmOutlineText").value==='+JSON.stringify(sourceText)));
 await fill('# 原章节\n## 定义\n- 条件\n## 应用','local');await submit();await finished();
 check('Local generation works without configuration and retains hierarchy connections',received.length===0 && await ev("Mindmap.state().cur.nodes.length===4 && Mindmap.state().cur.edges.length===3 && Mindmap.state().cur.outlineSources[0].mode==='local'"));
 await ev("Mindmap.finishEditing();window.__localMap=Mindmap.state().cur.id;window.__original=JSON.stringify(Mindmap.state().cur.nodes)");
 saveConfig(true);const originalConfig=fs.readFileSync(process.env.MM_AI_CONFIG_FILE,'utf8');
 await clickSel('[data-mm="paste-in"]');await fill(sourceText,'ai','blank');await wait("document.getElementById('mmOutlineModel').textContent.includes('outline-fake-model')");
 check('AI generation reuses current model with no second configuration surface',await ev("document.getElementById('mmOutlineModel').textContent.includes('outline-fake-model') && document.querySelectorAll('input[type=password]').length===1"));
 await submit();await wait("!document.getElementById('mmDlg').open && Mindmap.state().cur.nodes.length>4 && !document.querySelector('[data-outline-stop]').hidden");
 check('Usage details are open by default during actual streaming',await ev("document.querySelector('.mm-outline-progress:not(.mm-lecture-progress) .mm-ai-usage').open"));
 await ev("document.querySelector('.mm-outline-progress:not(.mm-lecture-progress) .mm-ai-usage').open=false");await sleep(250);
 check('Manual collapse survives polling updates',await ev("!document.querySelector('.mm-outline-progress:not(.mm-lecture-progress) .mm-ai-usage').open"));
 await ev("document.querySelector('.mm-outline-progress:not(.mm-lecture-progress) .mm-ai-usage').open=true");
 check('Complete nodes render on the main canvas while the model is still streaming',await ev("Mindmap.state().cur.nodes.length<8 && document.querySelectorAll('.mm-node').length>4"));
 await finished();
 check('Independent blank-area generation preserves old nodes and adds no question entry',await ev("Mindmap.state().cur.nodes.length===8 && JSON.stringify(Mindmap.state().cur.nodes.slice(0,4))===__original && Mindmap.state().cur.nodes.every(n=>!n.aiEntry) && Mindmap.state().cur.edges.length===8"));
 check('Final usage panel combines generation and review exactly once',await ev("(()=>{const t=document.querySelector('.mm-outline-progress:not(.mm-lecture-progress) .mm-ai-usage').textContent;return t.includes('2 次模型响应')&&t.includes('输入 3,000')&&t.includes('输出 300')&&t.includes('2,250')&&t.includes('512.00 MiB')&&t.includes('32.00 MiB')})()"));
 {const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'usage-completed-desktop.png'),Buffer.from(shot.data,'base64'));}
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(100);
 check('Expanded usage panel remains within a narrow viewport',await ev("(()=>{const r=document.querySelector('.mm-outline-progress:not(.mm-lecture-progress)').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"));
 {const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'usage-completed-mobile.png'),Buffer.from(shot.data,'base64'));}
 await send('Emulation.setDeviceMetricsOverride',{width:1250,height:658,deviceScaleFactor:1,mobile:false});
 check('Text generation runs one additional configured-model review and stores a validated plan',structureCalls.length===1 && await ev("Mindmap.state().cur.outlineSources.at(-1).structureReview.status==='completed'"));
 check('Only the current input was sent once through the shared streaming model',received.length===1 && received[0].model==='outline-fake-model' && received[0].stream===true && received[0].messages.length===2 && JSON.parse(received[0].messages[1].content).source===sourceText);
 check('Custom relation text reaches canvas labels while obvious hierarchy labels stay empty',await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1),ids=new Set(r.generatedIds);return m.edges.some(e=>ids.has(e.from.node)&&ids.has(e.to.node)&&e.label==='') && m.edges.some(e=>e.label==='成立须满足') && [...document.querySelectorAll('.mm-edge-label')].some(e=>e.textContent==='用于估算')})()"));
 await ev("(()=>{const r=Mindmap.state().cur.outlineSources.at(-1),n=Mindmap.state().cur.nodes.find(n=>r.generatedIds.includes(n.id) && n.text.includes('$$'));Mindmap.selectNodes([n.id]);Mindmap.revealBox(Mindmap.state().L.nodes.get(n.id))})()");
 check('Generated formulas are displayed as math blocks in actual nodes',await ev("[...document.querySelectorAll('.mm-node')].some(n=>n.querySelector('.katex-display'))"));
 await undo();check('One real keyboard undo removes the entire generated batch',await ev('Mindmap.state().cur.nodes.length===4 && Mindmap.state().cur.outlineSources.length===2'));
 await clickSel('#mmRedo');check('Redo restores the whole batch',await ev('Mindmap.state().cur.nodes.length===8'));
 await ev('MMFiles.save()');await ev('Mindmap.open(__localMap)');
 check('Saved and reopened map retains source, model and completion record',await ev('Mindmap.state().cur.outlineSources[1].text==='+JSON.stringify(sourceText)+" && Mindmap.state().cur.outlineSources[1].status==='completed'"));
 await sleep(300);await clickSel('[data-mm="outline-records"]');await wait("!!document.querySelector('[data-outline-record]')");await clickSel('[data-outline-record]');
 check('Original source can be read after reopening without cluttering the map',await ev('document.querySelector(".mm-outline-source textarea").value==='+JSON.stringify(sourceText)));
 await clickSel('[data-mm="dclose"]');
 await ev("Mindmap.selectNodes([Mindmap.state().cur.nodes[0].id]);window.__anchor=Mindmap.state().cur.nodes[0].id");await clickSel('[data-mm="paste-in"]');await fill(sourceText,'ai','node');await ev("document.getElementById('mmOutlineSupplement').checked=true");await submit();await finished();
 check('Attach-to-node adds a source connection and explicitly labels permitted supplements',await ev("Mindmap.state().cur.edges.some(e=>e.from.node===__anchor && e.label==='整理') && Mindmap.state().cur.nodes.some(n=>n.text.startsWith('# 【补充】'))"));
 await clickSel('[data-mm="paste-in"]');await fill('STOP '+sourceText,'ai','blank');await submit();await wait("Mindmap.state().cur.outlineSources.at(-1).generatedIds.length>0 && !document.querySelector('[data-outline-stop]').hidden");await clickSel('[data-outline-stop]');
 const stopped=await ev('JSON.stringify(Mindmap.state().cur.nodes)');await sleep(1400);
 check('Stopping preserves partial nodes and prevents late arrivals',await ev('JSON.stringify(Mindmap.state().cur.nodes)==='+JSON.stringify(stopped)+" && Mindmap.state().cur.outlineSources.at(-1).status==='stopped'"));
 await clickSel('[data-mm="paste-in"]');await fill('BAD '+sourceText,'ai','blank');await ev("document.getElementById('mmOutlineSupplement').checked=false");await submit();await finished();
 check('Invalid final relationships report failure while preserving complete partial nodes',await ev("Mindmap.state().cur.outlineSources.at(-1).status==='failed' && Mindmap.state().cur.outlineSources.at(-1).generatedIds.length>0 && document.querySelector('.mm-outline-progress p').textContent.includes('无效')"));
 await clickSel('[data-mm="paste-in"]');await fill('SWITCH '+sourceText,'ai','blank');await submit();await wait("Mindmap.state().cur.outlineSources.at(-1).generatedIds.length>0 && !document.querySelector('[data-outline-stop]').hidden");
 await ev("Mindmap.openDocument({id:'switch-target',title:'切换目标',v:3,flat:true,nodes:[{id:'safe',text:'不应被改动',children:[]}],edges:[],pos:{safe:{x:0,y:0}}})");await sleep(1600);
 check('Switching maps cancels generation and never inserts stale results into the new map',await ev("Mindmap.state().cur.id==='switch-target' && Mindmap.state().cur.nodes.length===1"));
 check('Using outline generation never changes saved provider credentials',fs.readFileSync(process.env.MM_AI_CONFIG_FILE,'utf8')===originalConfig);
 await ev("Mindmap.leaveDocument();MMAIOutline.open(false)");await fill(sourceText,'ai');await submit();await finished();
 check('Home AI generation opens a fresh document with exactly the logical output nodes and a clear title',await ev("Mindmap.state().cur.nodes.length===4 && Mindmap.state().cur.edges.length===5 && Mindmap.state().cur.outlineSources.length===1 && Mindmap.state().cur.title==='导数与局部变化'"));
 await send('Emulation.setDeviceMetricsOverride',{width:1380,height:950,deviceScaleFactor:1,mobile:false});await sleep(180);await ev("document.querySelector('[data-outline-hide]').click();Mindmap.fitView()");await sleep(400);
 check('Fresh AI map fits its complete graph inside the available canvas',await ev("(()=>{const v=document.getElementById('mmView').getBoundingClientRect();return [...document.querySelectorAll('.mm-node')].every(n=>{const r=n.getBoundingClientRect();return r.left>=v.left-1 && r.right<=v.right+1 && r.top>=v.top-1 && r.bottom<=v.bottom+1})})()"));
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'outline-canvas-preview.png'),Buffer.from(shot.data,'base64'));
 await clickSel('[data-mm="paste-in"]');await fill(sourceText,'ai','blank');const dialogShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'outline-dialog-preview.png'),Buffer.from(dialogShot.data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(100);
 check('Phone-width generation dialog keeps all visible inputs within its horizontal bounds',await ev("(()=>{const d=document.getElementById('mmDlg').getBoundingClientRect();return d.left>=0 && d.right<=innerWidth && [...document.querySelectorAll('#mmOutlineForm input,#mmOutlineForm select,#mmOutlineForm textarea')].filter(e=>e.getBoundingClientRect().width>0).every(e=>{const r=e.getBoundingClientRect();return r.left>=d.left && r.right<=d.right})})()"));
 await ev("document.getElementById('mmOutlineGenerate').scrollIntoView({block:'nearest'})");
 check('Long mobile form scrolls to keep its action button reachable',await ev("(()=>{const r=document.getElementById('mmOutlineGenerate').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()"));
 check('No uncaught browser exceptions or rejections',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const bad=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-bad.length} passed / ${bad.length} failed`);code=bad.length?1:0;
}catch(error){console.error(error);try{console.log(await ev('document.querySelector(".mm-outline-progress p").textContent'));console.log(await ev('__uiErrors'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'outline-regression-error.png'),Buffer.from(shot.data,'base64'));}catch{}}
finally{
 try{if(ws)await send('Browser.close');}catch{}await sleep(300);try{child?.kill();}catch{}
 for(const s of sockets)s.destroy();mock.close();
 if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
 const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('outline-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}
}
process.exit(code);
