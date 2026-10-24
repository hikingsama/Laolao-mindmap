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
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await wait('!!window.MMWorkspace && document.querySelector("[data-library-folder]")');
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 await clickSel('[data-folder-toggle="'+folderId+'"]');await clickSel('[data-library-map="browser-a"]');await wait("Mindmap.state().cur?.id==='browser-a'");await ev("Mindmap.organize('all');Mindmap.fitView()");
 check('Library, pane title and canvas fit inside the real browser viewport',await ev("(()=>{const a=document.getElementById('mmLibrarySidebar').getBoundingClientRect(),b=document.getElementById('mmView').getBoundingClientRect();return a.width>=180&&b.width>700&&b.height>400&&b.bottom<=innerHeight})()"));
 await ev("MMWorkspace.open('browser-b',{pane:'primary',split:true})");await wait("MMWorkspace.panes.secondary?.win.Mindmap.state().cur?.id==='browser-b'");await ev("const r=MMWorkspace.panes.secondary.win;r.Mindmap.organize('all');r.Mindmap.fitView();r.__uiErrors=[];r.addEventListener('error',e=>r.__uiErrors.push(e.message));r.addEventListener('unhandledrejection',e=>r.__uiErrors.push(String(e.reason)))");
 await ev("Mindmap.fitView();MMWorkspace.panes.secondary.win.Mindmap.fitView()");await sleep(300);
 check('Both real canvases retain usable independent dimensions in split view',await ev("(()=>{const a=document.getElementById('mmView').getBoundingClientRect(),w=MMWorkspace.panes.secondary.win,b=w.document.getElementById('mmView').getBoundingClientRect();return a.width>400&&b.width>400&&a.height>400&&b.height>400&&document.querySelectorAll('iframe').length===1})()"));
 let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-split-desktop.png'),Buffer.from(shot.data,'base64'));
 await clickSel('[data-workspace="select"]');await clickSel('[data-workspace="select-all"]');check('Visible batch controls are grouped in the sidebar with a toggle selection',await ev("MMWorkspace.selection.length===3 && document.querySelector('[data-workspace=select-all]').textContent==='全不选' && !!document.querySelector('[data-workspace=move-selected]') && !!document.querySelector('[data-workspace=delete-selected]')"));shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-batch-controls.png'),Buffer.from(shot.data,'base64'));await clickSel('[data-workspace="select"]');
 await clickSel('#mmPrimaryBar .mm-pane-more summary');check('The left save dropdown is visible inside the canvas and offers explicit home actions',await ev("(()=>{const d=document.querySelector('#mmPrimaryBar .mm-pane-more'),r=d.querySelector('div').getBoundingClientRect(),p=document.getElementById('mmPanePrimary').getBoundingClientRect();return d.open&&r.left>=p.left&&r.right<=p.right&&r.bottom>r.top})()"));shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-save-menu.png'),Buffer.from(shot.data,'base64'));await clickSel('#mmPrimaryBar .mm-pane-more summary');
 await clickSel('#mmSecondaryBar .mm-pane-title');await clickSel('#mmAPISettingsButton');check('The global settings entry follows the active right canvas',await ev("MMWorkspace.panes.secondary.win.document.getElementById('mmAPISettingsDialog').open && !document.getElementById('mmAPISettingsDialog').open"));await ev("MMWorkspace.panes.secondary.win.document.getElementById('mmAPISettingsDialog').close()");

 await ev("MMTopicUI.setMode('overview');MMWorkspace.panes.secondary.win.MMTopicUI.setMode('overview');window.__leftOverview={...MMTopicUI.viewport};window.__rightOverview={...MMWorkspace.panes.secondary.win.MMTopicUI.viewport};window.__leftDetail=JSON.stringify(Mindmap.view());window.__rightDetail=JSON.stringify(MMWorkspace.panes.secondary.win.Mindmap.view())");
 const overviewPoint=await ev("(()=>{const f=document.getElementById('mmSecondaryFrame').getBoundingClientRect(),r=MMWorkspace.panes.secondary.win.document.querySelector('.mm-structure-overview').getBoundingClientRect();return{x:Math.floor(f.left+r.left+r.width/2),y:Math.floor(f.top+r.top+r.height/2)}})()");
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',...overviewPoint,deltaX:0,deltaY:-90,modifiers:2});await sleep(70);
 check('Pinching the right overview changes only that overview, not either detailed canvas or the left overview',await ev("MMWorkspace.panes.secondary.win.MMTopicUI.viewport.k>__rightOverview.k&&JSON.stringify(MMTopicUI.viewport)===JSON.stringify(__leftOverview)&&JSON.stringify(Mindmap.view())===__leftDetail&&JSON.stringify(MMWorkspace.panes.secondary.win.Mindmap.view())===__rightDetail&&visualViewport.scale===1"));
 await ev("MMTopicUI.setMode('detail');MMWorkspace.panes.secondary.win.MMTopicUI.setMode('detail')");
 const drop=await ev("(()=>{const f=document.getElementById('mmSecondaryFrame').getBoundingClientRect(),w=MMWorkspace.panes.secondary.win,r=w.document.getElementById('mmView').getBoundingClientRect(),x=r.left+r.width*.62,y=r.top+r.height*.55;return{x:f.left+x,y:f.top+y,at:w.Mindmap.clientPoint(x,y)}})()");
 const data={items:[{mimeType:'application/x-laolao-library',data:JSON.stringify({kind:'map',id:'browser-c'})}],dragOperationsMask:1};for(const type of ['dragEnter','dragOver','drop'])await send('Input.dispatchDragEvent',{type,x:drop.x,y:drop.y,data});await wait("MMWorkspace.panes.secondary.win.Mindmap.state().cur.nodes.some(n=>n.mapLink?.mapId==='browser-c')");
 check('A browser drag into the right canvas uses the right local coordinates',await ev("(()=>{const m=MMWorkspace.panes.secondary.win.Mindmap.state().cur,n=m.nodes.find(n=>n.mapLink?.mapId==='browser-c'),p=m.pos[n.id];return Math.abs(p.x-("+drop.at.x+"))<2&&Math.abs(p.y-("+drop.at.y+"))<2})()"));
 await ev("MMWorkspace.panes.secondary.win.Mindmap.fitView()");await sleep(200);shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-reference-and-split.png'),Buffer.from(shot.data,'base64'));
 const card=await ev("(()=>{const f=document.getElementById('mmSecondaryFrame').getBoundingClientRect(),w=MMWorkspace.panes.secondary.win,n=w.Mindmap.state().cur.nodes.find(n=>n.mapLink),e=w.document.querySelector('.mm-node[data-id=\"'+n.id+'\"] .mm-map-card-heading').getBoundingClientRect();return{x:f.left+e.left+e.width/2,y:f.top+e.top+e.height/2}})()");await mouse('mousePressed',card.x,card.y,2,1);await mouse('mouseReleased',card.x,card.y,2,0);await wait("MMWorkspace.panes.secondary.win.Mindmap.state().cur?.id==='browser-c'");
 check('A real double-click in the right canvas navigates that pane only',await ev("Mindmap.state().cur.id==='browser-a' && MMWorkspace.panes.secondary.win.Mindmap.state().cur.id==='browser-c'"));
 const splitCenter=await ev("(()=>{const r=document.getElementById('mmView').getBoundingClientRect();return Mindmap.clientPoint(r.left+r.width/2,r.top+r.height/2)})()");const handle=await rectOf('#mmPaneResize');await mouse('mousePressed',handle.x,handle.y,1,1);await mouse('mouseMoved',handle.x+65,handle.y,1,1);await mouse('mouseReleased',handle.x+65,handle.y,1,0);await sleep(180);check('Resizing the split preserves the same world position at the canvas center',await ev("(()=>{const r=document.getElementById('mmView').getBoundingClientRect(),p=Mindmap.clientPoint(r.left+r.width/2,r.top+r.height/2);return Math.abs(p.x-("+splitCenter.x+"))<2&&Math.abs(p.y-("+splitCenter.y+"))<2})()"));
 await clickSel('[data-workspace="collapse"]');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});await sleep(150);await ev('Mindmap.fitView();MMWorkspace.panes.secondary.win.Mindmap.fitView()');await sleep(200);shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-split-compact.png'),Buffer.from(shot.data,'base64'));
 check('Collapsing the sidebar gives the two canvases more room on a compact desktop',await ev("(()=>{const a=document.getElementById('mmView').getBoundingClientRect(),b=MMWorkspace.panes.secondary.win.document.getElementById('mmView').getBoundingClientRect();return document.getElementById('mmWorkspace').classList.contains('is-collapsed')&&a.width>500&&b.width>500&&a.bottom<=innerHeight})()"));
 await ev("document.querySelector('[data-pane-action=single][data-pane-target=primary]').click();true");await wait("!!document.getElementById('mmWorkspaceConfirm')");shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-save-confirm.png'),Buffer.from(shot.data,'base64'));await clickSel('[data-confirm="save"]');await wait("!document.getElementById('mmWorkspaceConfirm')");await wait("!MMWorkspace.panes.secondary && Mindmap.state().cur.id==='browser-c'");check('Clicking End split on the left closes that side and retains the right map at full width',await ev("document.getElementById('mmView').getBoundingClientRect().width>1100 && document.querySelectorAll('iframe').length===0"));
 check('No uncaught errors occurred in either real editor',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const failures=RESULTS.filter(r=>!r.ok);code=failures.length?1:0;console.log(`${RESULTS.length-failures.length} browser checks passed / ${failures.length} failed`);
}catch(e){console.error(e);try{console.log(await ev('__uiErrors'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'workspace-error.png'),Buffer.from(shot.data,'base64'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(200);try{child?.kill();}catch{}if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(testdir);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-workspace-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
