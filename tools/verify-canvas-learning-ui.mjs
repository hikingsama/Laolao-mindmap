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


const fs=await import('node:fs'),path=await import('node:path');const {pathToFileURL}=await import('node:url'),{createRequire}=await import('node:module');
const project=argOf('project',process.cwd()),base=path.resolve(argOf('artifacts',path.join(project,'tmp')));fs.mkdirSync(base,{recursive:true});const temp=fs.mkdtempSync(path.join(base,'canvas-study-browser-'));const require=createRequire(path.join(project,'package.json')),{makePlan}=require('./tools/structure-review-fixture.cjs');
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify({version:1,activeProvider:'custom',profiles:Object.fromEntries(['custom','glm','kimi','deepseek'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]))}));
const wait=async expression=>{for(let i=0;i<180;i++){if(await ev(expression))return;await sleep(60);}throw Error('UI timeout: '+expression);};
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
const input={title:'讲义学习联动',nodes:[{id:'r',title:'课程总览'},...Array.from({length:12},(_,i)=>({id:'n'+i,title:['基本概念','极限连续','一元微分','多元微分'][Math.floor(i/3)]+(i%3?' · 性质与应用':''),brief:'梳理定义与条件，理清知识之间的联系。',topic:['基本概念','极限连续','一元微分','多元微分'][Math.floor(i/3)]}))]},plan=makePlan(input);
const fixture={id:'canvas-study-test',title:input.title,v:3,flat:true,nodes:input.nodes.map(n=>({...n,text:'# '+n.title+'\n\n理解定义、条件与应用。\n\n$$f(x)=x^2$$',children:[],citations:[{documentId:'doc',page:1}]})),edges:[],pos:Object.fromEntries(input.nodes.map((n,i)=>[n.id,{x:(i%4)*290,y:Math.floor(i/4)*150}]))};
const canvas=key=>'#mmStage [data-module-learning="'+key+'"]',overview=key=>'.mm-structure-overview [data-module-learning="'+key+'"]';
async function showCard(key){await ev('(()=>{const c=Mindmap.state().L.moduleCards.find(c=>c.key==='+JSON.stringify(key)+');Mindmap.zoom(1);Mindmap.revealBox(c.box)})()');await sleep(350);}
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMModuleLearningUI');await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1050,deviceScaleFactor:1,mobile:false});
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 await ev('Mindmap.openDocument('+JSON.stringify(fixture)+')');await ev('Mindmap.applyReviewedStructure(MMStructurePlan.validate('+JSON.stringify(plan)+','+JSON.stringify(input.nodes)+'),"study")');
 const key=await ev('MMTopicLayout.describe(Mindmap.state().cur).groups[0].key');
 await ev("(()=>{Mindmap.selectNodes([]);const n=Mindmap.state().L.nodes.get('n0');Mindmap.revealBox(n);Mindmap.zoom(.2);Mindmap.zoom(1)})()");await sleep(350);
 check('Detailed module number remains visible after zoom replaces and remounts node content',await ev("(()=>{const e=document.querySelector('.mm-node[data-id=n0]'),h=e.querySelector('h1,h2,h3');return e.dataset.moduleOrder==='01' && h?.dataset.moduleOrder==='01' && getComputedStyle(h,'::before').content.includes('01')})()"));
 check('Exported full node content retains the same displayed module number',await ev("(()=>{const clone=document.getElementById('mmStage').cloneNode(true);MMScene.exportContent(clone);return clone.querySelector('.mm-node[data-id=n0] [data-module-heading]')?.dataset.moduleOrder==='01'})()"));

 check('Detailed canvas has four default-expanded five-step checklists and a whole-lecture summary',await ev("MMTopicUI.mode==='detail' && document.querySelectorAll('#mmStage [data-module-learning]').length===4 && document.querySelectorAll('#mmStage [data-module-step]').length===20 && [...document.querySelectorAll('#mmStage .mm-module-toggle')].every(e=>e.getAttribute('aria-expanded')==='true') && document.querySelector('#mmStage [data-module-summary]').textContent.includes('0/20')"));
 check('Checklists add no knowledge nodes, stored positions or rewritten source text',await ev('Mindmap.state().cur.nodes.length===13 && Object.keys(Mindmap.state().cur.pos).length===13 && JSON.stringify(Mindmap.state().cur.nodes.map(n=>[n.id,n.text,n.citations]))==='+JSON.stringify(JSON.stringify(fixture.nodes.map(n=>[n.id,n.text,n.citations])))));
 check('Expanded canvas checklists avoid nodes, citations and other checklists after organization',await ev("(()=>{const L=Mindmap.state().L,hit=(a,b)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;return L.moduleCards.every((c,i)=>[...L.nodes.values()].every(b=>!hit(c.box,{...b,h:b.h+28})) && L.moduleCards.every((d,j)=>j===i||!hit(c.box,d.box)))})()"));
 check('Organization reserves the default space directly under each representative',await ev("(()=>{const L=Mindmap.state().L;return L.moduleCards.filter(c=>c.kind==='module').every(c=>Math.abs(c.box.y-L.nodes.get(c.anchorId).y-L.nodes.get(c.anchorId).h-36)<.1)})()"));
 check('Fit bounds include every attached learning card',await ev("(()=>{const L=Mindmap.state().L;return L.moduleCards.every(c=>c.box.x>=L.bounds.x0 && c.box.y>=L.bounds.y0 && c.box.x+c.box.w<=L.bounds.x1 && c.box.y+c.box.h<=L.bounds.y1)})()"));
 await showCard(key);await ev("Mindmap.selectNodes(['n2']);window.__protectedNodes=JSON.stringify(Mindmap.state().cur.nodes);window.__protectedPos=JSON.stringify(Mindmap.state().cur.pos);window.__protectedEdges=JSON.stringify(Mindmap.state().cur.edges)");await clickSel(canvas(key)+' [data-module-step="0"]');
 check('Canvas checkbox updates one module without dragging, selecting nodes or changing relationships',await ev("Mindmap.state().sel==='n2' && JSON.stringify(Mindmap.state().cur.nodes)===__protectedNodes && JSON.stringify(Mindmap.state().cur.pos)===__protectedPos && JSON.stringify(Mindmap.state().cur.edges)===__protectedEdges && document.querySelectorAll('#mmStage [data-module-step]:checked').length===1 && document.querySelector('#mmStage [data-module-summary]').textContent.includes('1/20')"));
 await clickSel(canvas(key)+' .mm-module-toggle');check('User folding is preserved while untouched modules remain expanded',await ev("document.querySelectorAll('#mmStage [data-module-step]').length===15 && document.querySelectorAll('#mmStage .mm-module-toggle[aria-expanded=false]').length===1"));
 await clickSel(canvas(key)+' .mm-module-view');await wait("MMTopicUI.mode==='overview'");
 check('Canvas-to-overview link highlights its module and shares checked and fold states',await ev('(()=>{const e=[...document.querySelectorAll(".mm-structure-overview [data-module-learning]")].find(e=>e.dataset.moduleLearning==='+JSON.stringify(key)+');return document.querySelectorAll("#mmStage [data-module-learning]").length===0 && e.querySelector(".mm-module-toggle").getAttribute("aria-expanded")==="false" && e.querySelector(".mm-module-toggle").textContent.includes("1/5") && e.closest(".mm-overview-card").classList.contains("is-current")})()'));
 await clickSel(overview(key)+' .mm-module-toggle');await ev("window.__learningCamera=JSON.stringify(MMTopicUI.viewport)");await clickSel(overview(key)+' [data-module-step="1"]');check('Updating overview learning progress retains its camera instead of resetting zoom',await ev("JSON.stringify(MMTopicUI.viewport)===__learningCamera"));await clickSel('#mmDetailView');await showCard(key);
 check('Overview changes immediately appear in the detailed canvas with no duplicate cards',await ev("document.querySelectorAll('#mmStage [data-module-learning]').length===4 && document.querySelectorAll('#mmStage [data-module-step]:checked').length===2 && document.querySelectorAll('#mmStage .mm-module-toggle[aria-expanded=true]').length===4 && document.querySelector('#mmStage [data-module-summary]').textContent.includes('2/20')"));
 await clickSel(canvas(key)+' [data-module-step="2"]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});check('Keyboard checkbox behavior works in the canvas after redraw',await ev("document.querySelectorAll('#mmStage [data-module-step]:checked').length===2 && MMTopicUI.mode==='detail'"));
 await ev("Mindmap.selectNodes(['n2'])");await clickSel('#mmOverviewView');check('Selecting a detailed descendant locates its third-level overview card',await ev("document.querySelector('.mm-overview-card.is-current')?.dataset.overviewLevel==='3' && document.querySelector('.mm-overview-card.is-current .mm-overview-open').getAttribute('aria-current')==='true'"));
 await clickSel('.mm-overview-card.is-current .mm-overview-open');check('Clicking that overview subtopic returns to its actual detailed representative',await ev("MMTopicUI.mode==='detail' && Mindmap.state().sel==='n1' && document.querySelectorAll('#mmStage [data-module-learning]').length===4"));
 await showCard(key);await ev("window.__view=JSON.stringify(Mindmap.view());window.__positions=JSON.stringify(Mindmap.state().cur.pos)");await clickSel('#mmOverviewView');await clickSel('#mmDetailView');check('Toolbar view roundtrip preserves detail viewport and manual node positions',await ev("JSON.stringify(Mindmap.view())===__view && JSON.stringify(Mindmap.state().cur.pos)===__positions"));
 await ev("(()=>{const n=Mindmap.state().L.nodes.get('n0');Mindmap.zoom(1);Mindmap.revealBox(n);window.__dragBefore={pos:{...Mindmap.state().cur.pos.n0},box:{...Mindmap.state().L.moduleCards.find(c=>c.anchorId==='n0').box}}})()");await sleep(350);
 const p=await rectOf('.mm-node[data-id="n0"]');await mouse('mouseMoved',p.x,p.y,0,0);await mouse('mousePressed',p.x,p.y,1,1);for(let i=1;i<=5;i++)await mouse('mouseMoved',p.x+i*20,p.y+i*12,0,1);await mouse('mouseReleased',p.x+100,p.y+60,1,0);await sleep(100);
 check('Real node dragging moves its attached checklist without leaving a trail',await ev("(()=>{const a=__dragBefore,m=Mindmap.state().cur,L=Mindmap.state().L,c=L.moduleCards.find(c=>c.anchorId==='n0').box;return Math.abs(m.pos.n0.x-a.pos.x-100)<2 && Math.abs(m.pos.n0.y-a.pos.y-60)<2 && Math.abs(c.x-a.box.x-100)<2 && Math.abs(c.y-a.box.y-60)<2 && document.querySelectorAll('#mmStage [data-module-learning]').length===4})()"));
 await undo();check('Dragging undoes once while retaining shared learning progress',await ev("JSON.stringify(Mindmap.state().cur.pos.n0)===JSON.stringify(__dragBefore.pos) && document.querySelectorAll('#mmStage [data-module-step]:checked').length===2"));
 await ev('MMFiles.save()');await ev("Mindmap.open('canvas-study-test')");check('Saving and reopening restores visible expanded canvas cards and learning state',await ev("MMTopicUI.mode==='detail' && document.querySelectorAll('#mmStage [data-module-learning]').length===4 && document.querySelectorAll('#mmStage [data-module-step]:checked').length===2"));
 await ev('Mindmap.fitView()');await sleep(150);const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'canvas-module-learning-preview.png'),Buffer.from(shot.data,'base64'));
 await ev("document.getElementById('mmWorkspace').classList.add('is-collapsed')");await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await showCard(key);await clickSel(canvas(key)+' .mm-module-view');await wait("MMTopicUI.mode==='overview'");
 check('Mobile overview link brings the active module into the visible scroll area',await ev("(()=>{const a=document.querySelector('.mm-overview-card.is-current')?.getBoundingClientRect(),b=document.querySelector('.mm-structure-overview').getBoundingClientRect();return a && a.top>=b.top-2 && a.top<b.bottom && a.left>=0 && a.right<=innerWidth})()"));
 await clickSel('.mm-overview-card.is-current .mm-overview-open');check('Mobile returns to the same detailed module with its checklist',await ev("MMTopicUI.mode==='detail' && Mindmap.state().sel==='n0' && document.querySelectorAll('#mmStage [data-module-learning]').length===4"));
 await ev("Mindmap.openDocument({id:'other-map',title:'其他导图',v:3,flat:true,nodes:[{id:'n0',text:'不同导图的同名ID',children:[]}],edges:[],pos:{n0:{x:0,y:0}}})");check('Switching maps clears old checklists and overview focus even with reused node IDs',await ev("!document.querySelector('[data-module-learning]') && !document.querySelector('.mm-overview-card.is-current') && Mindmap.state().cur.nodes.length===1"));
 check('No uncaught browser exceptions or rejections',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const bad=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-bad.length} passed / ${bad.length} failed`);code=bad.length?1:0;
}catch(error){console.error(error);try{console.log(await ev('__uiErrors'));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'canvas-learning-error.png'),Buffer.from(shot.data,'base64'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(300);try{child?.kill();}catch{}if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('canvas-study-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
