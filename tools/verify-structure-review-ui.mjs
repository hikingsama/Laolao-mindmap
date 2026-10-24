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
const require=createRequire(path.join(project,'package.json')),{makePlan}=require('./tools/structure-review-fixture.cjs');
const temp=fs.mkdtempSync(path.join(base,'structure-browser-')),sockets=new Set(),received=[];let responseMode='ok',upstreamAborted=false;
const mock=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const data=JSON.parse(raw),input=JSON.parse(data.messages[1].content);received.push(data);
 if(responseMode==='slow'){res.on('close',()=>{upstreamAborted=true;});await sleep(1800);if(res.destroyed)return;}
 const prepared={...input,nodes:input.nodes.map(n=>({...n,topic:n.id==='r'?'':['基本概念与分类','极限与连续','一元导数与微分','多元导数与微分'][Math.floor(Number(n.id.slice(1))/4)]}))},p=makePlan(prepared);if(responseMode==='bad')p.modules.pop();
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(p)},finish_reason:'stop'}]}));
});mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');
fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify({version:1,activeProvider:'custom',profiles:Object.fromEntries(['custom','glm','kimi','deepseek'].map(id=>[id,id==='custom'?{baseURL:'http://127.0.0.1:'+mock.address().port+'/v1',model:'fake-review',apiKey:'fake-structure-key'}:{baseURL:'',model:'',apiKey:''}]))}));
const wait=async expression=>{for(let i=0;i<220;i++){if(await ev(expression))return;await sleep(70);}throw Error('UI timeout: '+expression);};
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
const fixture={id:'structure-manual-test',v:3,flat:true,title:'向量值函数及其导数',nodes:[{id:'r',text:'# 总览\n\n课程目录：基本概念、极限连续、一元微分、多元微分。',brief:'本讲的四个主要学习板块。',layoutRole:'overview',children:[]},...Array.from({length:16},(_,i)=>({id:'n'+i,text:'# '+['概念与分类','极限与连续','导数与微分','多元导数'][Math.floor(i/4)]+i+'\n\n保留原定义、条件及公式 $x_k$。\n\n$$f(x)=x^2$$',brief:'解释定义与条件，结合性质与应用建立理解。',topic:'旧模块'+i%8,layoutParent:'r',citations:[{documentId:'doc',page:i+1}],children:[]}))],edges:Array.from({length:16},(_,i)=>({id:'e'+i,from:{node:'r',side:'e'},to:{node:'n'+i,side:'w'},kind:'hierarchy',label:'',dir:'fwd'})),pos:Object.fromEntries(['r',...Array.from({length:16},(_,i)=>'n'+i)].map((id,i)=>[id,{x:300*(i%4),y:180*Math.floor(i/4)}]))};
const start=async()=>{await clickSel('#mmStructureReviewButton');await clickSel('#mmStructureStart');};
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMAIStructureReview');
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 await ev('Mindmap.openDocument('+JSON.stringify(fixture)+')');await ev("window.__original=JSON.stringify(Mindmap.state().cur.nodes);window.__oldEdges=JSON.stringify(Mindmap.state().cur.edges)");
 await start();await wait("!!document.getElementById('mmStructureApply')");
 check('Manual review previews a four-module three-level scheme before changing the map',received.length===1 && await ev("JSON.stringify(Mindmap.state().cur.nodes)===__original && JSON.stringify(Mindmap.state().cur.edges)===__oldEdges && document.getElementById('mmDlgBody').textContent.includes('极限与连续') && !Mindmap.state().cur.structures"));
 check('Review submits current summaries and catalog without attachments, keys or other conversations',received[0].model==='fake-review' && received[0].messages.length===2 && JSON.parse(received[0].messages[1].content).catalog.length===1 && !received[0].messages[1].content.includes('image_url'));
 await clickSel('#mmStructureApply');await wait('!document.getElementById("mmDlg").open');
 check('Applying preserves every formula, citation and node while merging eight old topics into four groups',await ev("Mindmap.state().cur.topicGroups.length===4 && Mindmap.state().cur.groups.length===4 && JSON.stringify(Mindmap.state().cur.nodes.map(n=>[n.id,n.text,n.citations]))===JSON.stringify(JSON.parse(__original).map(n=>[n.id,n.text,n.citations]))"));
 await undo();check('One undo restores original topics and edges',await ev("JSON.stringify(Mindmap.state().cur.nodes)===__original && JSON.stringify(Mindmap.state().cur.edges)===__oldEdges"));await clickSel('#mmRedo');
 await ev('MMFiles.save()');await ev("Mindmap.open('structure-manual-test')");check('Saved map restores reviewed structure and audit',await ev("Object.keys(Mindmap.state().cur.structures).length===1 && Mindmap.state().cur.outlineSources.at(-1).applied && Mindmap.state().cur.outlineSources.at(-1).structureReview.status==='completed'"));
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await clickSel('#mmOverviewView');
 check('Actual overview has four second-level modules and four third-level subtopics',await ev("document.querySelectorAll('[data-overview-level=\"2\"]').length===4 && document.querySelectorAll('[data-overview-level=\"3\"]').length===4 && document.querySelectorAll('.mm-overview-links path').length===8 && !document.querySelector('.mm-structure-overview .katex')"));

 check('Reviewed module numbers and left-column-then-right-column ordering agree in the overview',await ev("(()=>{const a=[...document.querySelectorAll('.mm-overview-card[data-module-order]')].sort((a,b)=>+a.dataset.moduleOrder-+b.dataset.moduleOrder),r=a.map(e=>e.getBoundingClientRect());return a.length===4 && a.every((e,i)=>e.querySelector('strong').textContent.startsWith(String(i+1).padStart(2,'0')+' · ')) && r[0].left===r[1].left && r[0].top<r[1].top && r[2].left===r[3].left && r[2].top<r[3].top && r[0].left<r[2].left})()"));
 check('Each main module starts with five unchecked lecture-specific steps and a whole-lecture summary',await ev("document.querySelectorAll('[data-module-learning]').length===4 && document.querySelectorAll('[data-module-step]').length===20 && !document.querySelector('[data-module-step]:checked') && document.querySelector('[data-module-summary]').textContent.includes('0/4') && document.querySelector('[data-module-summary]').textContent.includes('0/20') && [...document.querySelector('[data-module-learning]').querySelectorAll('label span')].map(e=>e.textContent).join(',')==='通览结构,精读提炼,串联关系,主动复现,应用自检'"));
 await clickSel('[data-module-learning] [data-module-step="0"]');
 check('A real checkbox changes only its module and does not select hidden nodes or enter detail',await ev("MMTopicUI.mode==='overview' && document.querySelectorAll('[data-module-step]:checked').length===1 && document.querySelector('[data-module-summary]').textContent.includes('1/20') && Mindmap.state().cur.moduleLearning.records.length===1 && !Mindmap.state().cur.aiMemory?.turns?.length"));
 for(let i=1;i<5;i++)await clickSel('[data-module-learning] [data-module-step="'+i+'"]');
 check('Completing one module updates the whole lecture without marking other modules complete',await ev("document.querySelector('[data-module-summary]').textContent.includes('1/4') && document.querySelector('[data-module-summary]').textContent.includes('5/20') && document.querySelectorAll('[data-module-step]:checked').length===5"));
 await clickSel('[data-module-learning] .mm-module-toggle');check('Lecture checklist folds with progress and restores checked state when reopened',await ev("document.querySelector('[data-module-learning] .mm-module-toggle').getAttribute('aria-expanded')==='false' && document.querySelector('[data-module-learning] .mm-module-toggle').textContent.includes('5/5') && document.querySelectorAll('[data-module-step]').length===15"));await clickSel('[data-module-learning] .mm-module-toggle');
 await clickSel('[data-module-learning] [data-module-step="4"]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
 check('Checkbox keyboard controls work after redraw without changing the overview mode',await ev("document.querySelectorAll('[data-module-step]:checked').length===5 && MMTopicUI.mode==='overview'"));
 await clickSel('#mmDetailView');check('Detailed representatives and group frames display the same module numbers',await ev("document.querySelectorAll('[data-module-heading]').length===4 && [...document.querySelectorAll('.mm-group-label')].filter(e=>/^0[1-4] · /.test(e.textContent)).length===4"));
 await ev('Mindmap.organize("all")');await undo();await clickSel('#mmOverviewView');check('Canvas layout undo preserves manually checked lecture learning progress',await ev("document.querySelectorAll('[data-module-step]:checked').length===5"));
 await ev('MMFiles.save()');await ev("Mindmap.open('structure-manual-test')");await clickSel('#mmOverviewView');check('Saved and reopened map retains all module checks and order',await ev("document.querySelectorAll('[data-module-step]:checked').length===5 && document.querySelector('[data-module-summary]').textContent.includes('1/4') && document.querySelectorAll('.mm-overview-card[data-module-order]').length===4"));
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'ordered-module-learning-preview.png'),Buffer.from(shot.data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(200);check('Mobile main modules remain in numerical reading order',await ev("[...document.querySelectorAll('.mm-overview-card[data-module-order]')].map(e=>e.dataset.moduleOrder).join(',')==='1,2,3,4'"));
 check('Third-level overview remains readable on a phone',await ev("[...document.querySelectorAll('[data-overview-level=\"3\"]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && parseFloat(getComputedStyle(e).fontSize)>=14})"));
 await clickSel('#mmDetailView');await send('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});await start();await wait("!!document.getElementById('mmStructureApply')");await ev("Mindmap.editMap(()=>Mindmap.findNode('n0').n.text+='\\n用户补充')");await clickSel('#mmStructureApply');check('Editing after preview blocks application of the stale plan',await ev("document.getElementById('mmStructureApply').disabled && document.getElementById('mmDlgBody').textContent.includes('请重新复核') && Mindmap.findNode('n0').n.text.includes('用户补充')"));await ev("document.getElementById('mmDlg').close()");
 responseMode='bad';await ev("window.__protected=JSON.stringify({nodes:Mindmap.state().cur.nodes,edges:Mindmap.state().cur.edges,structures:Mindmap.state().cur.structures})");await start();await wait("!MMAIStructureReview.running && document.getElementById('mmDlgBody').textContent.includes('遗漏')");check('Invalid review leaves detailed content and existing hierarchy untouched with a visible reason',await ev("!document.getElementById('mmStructureApply') && JSON.stringify({nodes:Mindmap.state().cur.nodes,edges:Mindmap.state().cur.edges,structures:Mindmap.state().cur.structures})===__protected"));await ev("document.getElementById('mmDlg').close()");
 responseMode='slow';const beforeCalls=received.length;await start();for(let i=0;i<100 && received.length===beforeCalls;i++)await sleep(30);await clickSel('#mmStructureStop');await wait('!MMAIStructureReview.running');await sleep(300);check('Stop cancels actual review transport and keeps the old map',upstreamAborted && await ev("!document.getElementById('mmStructureApply') && JSON.stringify({nodes:Mindmap.state().cur.nodes,edges:Mindmap.state().cur.edges,structures:Mindmap.state().cur.structures})===__protected"));await ev("document.getElementById('mmDlg').close()");
 const record=await ev('Mindmap.state().cur.outlineSources[0].id');await ev('MMAIInspector.openRecord('+JSON.stringify(record)+')');check('Inspector exposes actual review prompt, validated output and reasons',await ev("[...document.querySelectorAll('#mmDlgBody textarea')].some(e=>e.value.includes('你是整图结构复核员')) && [...document.querySelectorAll('#mmDlgBody textarea')].some(e=>e.value.includes('极限与连续'))"));
 check('No uncaught browser exceptions or rejections',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const bad=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-bad.length} passed / ${bad.length} failed`);code=bad.length?1:0;
}catch(error){console.error(error);try{console.log(await ev('document.getElementById("mmDlgBody").textContent'));console.log(await ev('__uiErrors'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(300);try{child?.kill();}catch{}for(const s of sockets)s.destroy();mock.close();if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('structure-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
