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


const fs=await import('node:fs'),path=await import('node:path');
const {pathToFileURL}=await import('node:url');
const project=path.resolve(argOf('project',process.cwd())),artifacts=path.resolve(argOf('artifacts',path.join(project,'tmp','workspace-ui')));fs.mkdirSync(artifacts,{recursive:true});
const testdir=fs.mkdtempSync(path.join(tmpdir(),'mm-workspace-browser-'));
process.env.MM_STORAGE_DIR=path.join(testdir,'maps');process.env.MM_AI_CONFIG_FILE=path.join(testdir,'fake-ai.json');process.env.MM_PORT=PORT;
fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify({version:1,activeProvider:'custom',profiles:Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]))}));
const fixtures=[['browser-a','高等数学 · 向量值函数'],['browser-b','线性代数 · 矩阵与映射'],['browser-c','共同概念 · 本章总结']].map(([id,title])=>({id,title,v:3,flat:true,theme:'fresh',line:'curve',nodes:[{id:id+'-root',text:'# '+title+'\n\n从概念出发，串联性质、推导与应用。',layoutRole:'overview',brief:'理解主要概念与知识之间的联系。',children:[]},...['基本概念','性质与条件','应用与自检'].map((t,i)=>({id:id+'-'+i,text:'# '+t+'\n\n'+['明确对象、记号与定义，区分输入和输出。','整理适用条件，比较不同表达方式之间的联系。','用具体例子检验理解，再尝试主动复述。'][i],topic:t,brief:t+'的主要学习内容。',children:[]}))],edges:[0,1,2].map(i=>({id:'e-'+id+i,from:{node:id+'-root',side:'e'},to:{node:id+'-'+i,side:'w'},kind:'hierarchy',dir:'fwd',label:''})),pos:Object.fromEntries(['root',0,1,2].map((n,i)=>[id+'-'+n,{x:i?350:0,y:(i-1)*210}])),size:Object.fromEntries(['root',0,1,2].map(n=>[id+'-'+n,{w:270,h:180}]))}));
for(const m of fixtures){const folder=path.join(process.env.MM_STORAGE_DIR,m.id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'map.json'),JSON.stringify(m));}
const {createRequire}=await import('node:module');const moduleRequire=createRequire(import.meta.url);
const folders=requireModule('library-folders.cjs').createStore({root:process.env.MM_STORAGE_DIR});
function requireModule(file){return moduleRequire(path.join(project,'js',file));}
let lib=folders.read();lib=folders.update({op:'createFolder',name:'数学课程',parentId:null,revision:lib.revision},new Set(fixtures.map(m=>m.id)));const folderId=lib.created.id;folders.update({op:'moveMaps',ids:['browser-a','browser-b'],folderId,revision:lib.revision},new Set(fixtures.map(m=>m.id)));
const wait=async expression=>{for(let i=0;i<250;i++){if(await ev(expression))return;await sleep(60);}throw Error('UI timeout: '+expression);};
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});await wait('!!window.MMWorkspace && !!window.MMDocumentCache');await ev('MMDocumentCache.ready');
 await ev("localStorage.setItem('mm_map_legacy-import',JSON.stringify({id:'legacy-import',title:'旧缓存迁移',nodes:[{id:'r',text:'旧正文'}]}));localStorage.setItem('mm_recovery_v1_legacy-import',JSON.stringify({map:{id:'legacy-import',nodes:[{id:'r',text:'未保存草稿'}]},token:'old-token',updated:123}))");
 await ev('window.__reloadSentinel=true');await send('Page.reload');await wait('!window.__reloadSentinel && document.readyState==="complete" && !!window.MMWorkspace && !!window.MMDocumentCache');await ev("MMDocumentCache.ready.then(()=>MMDocumentCache.load(['mm_map_legacy-import','mm_recovery_v1_legacy-import']))");
 check('Legacy document and recovery copies migrate into IndexedDB before localStorage copies are removed',await ev("MMDocumentCache.get('mm_map_legacy-import').nodes[0].text==='旧正文'&&MMDocumentCache.get('mm_recovery_v1_legacy-import').map.nodes[0].text==='未保存草稿'&&localStorage.getItem('mm_map_legacy-import')===null&&localStorage.getItem('mm_recovery_v1_legacy-import')===null"));
 await ev("window.__cacheErrors=[];addEventListener('error',e=>__cacheErrors.push(e.message));window.__oldStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/^(mm_map_|mm_recovery_v1_)/.test(k))throw new DOMException('simulated small-store quota','QuotaExceededError');return __oldStorageSet.call(this,k,v)}");
 await ev("Mindmap.openDocument({id:'capacity-large',title:'大容量恢复验证',v:3,flat:true,nodes:[{id:'root',text:'大容量导图正文',children:[]}],edges:[],pos:{root:{x:0,y:0}},outlineSources:[{id:'record-big',title:'大记录',mode:'local',status:'completed',text:'大'.repeat(4*1024*1024)}]})");await wait("Mindmap.state().cur?.id==='capacity-large'");await ev('MMFiles.flush()');
 check('A document above 8 MiB opens and writes its disk draft despite forced localStorage quota errors',await ev("new TextEncoder().encode(JSON.stringify(Mindmap.state().cur)).length>8*1048576&&MMDocumentCache.warning===''&&document.getElementById('mmSync').textContent.includes('保存')"));
 check('Explicit save persists the larger map through the normal file API',await ev('MMFiles.save()'));check('The persisted map JSON exceeds the old eight MiB limit',fs.statSync(path.join(testdir,'maps','capacity-large','map.json')).size>8*1048576);
 await ev("Mindmap.editMap(()=>{Mindmap.state().cur.nodes[0].text='尚未明确保存的修改'});MMFiles.flush()");await ev('MMDocumentCache.flush()');
 await ev('window.__reloadSentinel=true');await send('Page.reload');await wait('!window.__reloadSentinel && document.readyState==="complete" && !!window.MMWorkspace && !!window.MMDocumentCache');await ev('MMDocumentCache.ready');await ev("window.__reopen=MMWorkspace.open('capacity-large');true");await wait("!!document.querySelector('[data-session-choice=recover]')");await clickSel('[data-session-choice=recover]');await ev('window.__reopen');
 check('Reloading restores the large unsaved draft without changing the last explicit save',await ev("Mindmap.state().cur.nodes[0].text==='尚未明确保存的修改'&&Mindmap.state().cur.outlineSources[0].text.length===4*1024*1024"));check('The saved checkpoint remains separate from recovered draft changes',JSON.parse(fs.readFileSync(path.join(testdir,'maps','capacity-large','map.json'),'utf8')).nodes[0].text==='大容量导图正文');
 await ev("MMWorkspace.open('browser-a',{pane:'primary',split:true})");await wait("MMWorkspace.panes.secondary?.win.Mindmap.state().cur?.id==='browser-a'");check('The second canvas shares the same large-document cache rather than making another localStorage copy',await ev('MMWorkspace.panes.secondary.win.MMDocumentCache===MMDocumentCache'));await ev("MMWorkspace.panes.secondary.win.MMFiles.save()");
 await clickSel('#mmAPISettingsButton');await wait('document.getElementById("mmAPISettingsDialog").open||MMWorkspace.panes.secondary.win.document.getElementById("mmAPISettingsDialog").open');
 await ev("(()=>{const w=MMWorkspace.panes.secondary.win,d=w.document;d.getElementById('mmAPIProvider').value='custom';d.getElementById('mmAPIProvider').dispatchEvent(new w.Event('change'));d.getElementById('mmAPIBaseURL').value='https://example.invalid/v1';d.getElementById('mmAPIModel').value='fake-model';d.getElementById('mmAPIKey').value='fake-not-real';d.getElementById('mmAPIMaxOutput').value='65536';d.getElementById('mmAPISave').click()})()");await wait("MMWorkspace.panes.secondary.win.document.getElementById('mmAPIResult').textContent.includes('配置已保存')");
 check('Existing API settings allow a per-provider output budget without a separate configuration screen',await ev("fetch('/api/ai/config').then(r=>r.json()).then(c=>c.profiles.custom.maxOutputTokens===65536&&!JSON.stringify(c).includes('fake-not-real'))"));
 await ev("(()=>{const w=MMWorkspace.panes.secondary.win,d=w.document;d.getElementById('mmAPISettingsClose').click();w.Mindmap.saveOutlineSource({id:'capacity-diag',title:'截断诊断',mode:'outline',status:'failed',inspection:{promptId:'lecture-merge',model:'fake-model',system:'fake rules',input:[],output:{nodes:[]},limits:{maxOutputTokens:65536,answerBytes:8388608},transfer:{answerBytes:2048,transportBytes:3000,completionTokens:32768,promptTokens:1000,finishReason:'length'}}});w.MMAIInspector.openRecord('capacity-diag')})()");
 check('The generation inspector exposes budget, actual provider usage, byte capacity and end reason',await ev("(()=>{const text=MMWorkspace.panes.secondary.win.document.getElementById('mmDlgBody').textContent;return text.includes('容量、用量与结束原因')&&text.includes('65,536')&&text.includes('32,768')&&text.includes('length')&&text.includes('8.00 MiB')})()"));
 check('No browser exception occurred in the large-document workflow',await ev('!window.__cacheErrors||__cacheErrors.length===0'));const failures=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-failures.length} capacity browser checks passed / ${failures.length} failed`);code=failures.length?1:0;
}catch(e){console.error(e);try{console.log(await ev('__uiErrors'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-error.png'),Buffer.from(shot.data,'base64'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(200);try{child?.kill();}catch{}if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(testdir);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-workspace-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
