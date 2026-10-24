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
const project=argOf('project',process.cwd()),base=path.resolve(argOf('artifacts',path.join(project,'tmp')));fs.mkdirSync(base,{recursive:true});
const temp=fs.mkdtempSync(path.join(base,'topic-browser-'));
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify({version:1,activeProvider:'custom',profiles:Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]))}));
const wait=async expression=>{for(let i=0;i<150;i++){if(await ev(expression))return;await sleep(70);}throw Error('UI timeout: '+expression);};
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
const del=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Delete',code:'Delete',windowsVirtualKeyCode:46});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Delete',code:'Delete',windowsVirtualKeyCode:46});};
const nodes=[{id:'root',text:'# 重积分的应用\n\n按物理主题组织条件、公式与应用。',layoutRole:'overview',brief:'从质量分布出发，理解质心、转动惯量与引力的关系。',children:[]}];
const topics=['质心与形心','转动惯量','引力'];
for(let k=0;k<3;k++)for(let i=0;i<3;i++)nodes.push({id:'n'+k+i,topic:topics[k],brief:topics[k]+'关注对象的物理意义、适用条件与主要应用。',topicScope:'lesson',...(i?{layoutParent:'n'+k+'0'}:{}),text:'# '+topics[k]+(i===0?'：定义与条件':i===1?'：基本性质':'：典型应用')+'\n\n'+(i===0?'先明确对象、密度和适用条件，再选择积分表达。':'保持本主题内的条件和记号一致。')+'\n\n$$\n'+(k===0?'\\bar{x}=\\frac{\\iiint x\\rho\\,dV}{\\iiint\\rho\\,dV}':k===1?'I=\\iiint r^2\\rho\\,dV':'F=G\\frac{m_1m_2}{r^2}')+'\n$$',children:[],citations:[{documentId:'doc',page:k+1}]});
const edges=nodes.filter(n=>n.topic).map(n=>({id:'e'+n.id,from:{node:n.layoutParent || 'root',side:'e'},to:{node:n.id,side:'w'},kind:'hierarchy',label:n.layoutParent?'包含':'',dir:'fwd'}));edges.push({id:'cross',from:{node:'n01',side:'s'},to:{node:'n10',side:'n'},kind:'relation',label:'比较适用条件',dir:'fwd'});
const fixture={id:'topic-layout-test',flat:true,v:3,title:'重积分应用：主题团块',line:'curve',nodes,edges,pos:Object.fromEntries(nodes.map((n,i)=>[n.id,{x:i?500:0,y:i*310}])),size:Object.fromEntries(nodes.map((n,i)=>[n.id,{w:325,h:i?210:160}]))};
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMTopicUI && !!window.MMTopicLayout');await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 await ev('Mindmap.openDocument('+JSON.stringify(fixture)+')');await sleep(150);
 check('Default curve is a real SVG Bezier instead of an ignored preference',await ev("document.querySelectorAll('.mm-edge').length===10 && [...document.querySelectorAll('.mm-edge')].every(e=>/[CQ]/.test(e.getAttribute('d')))"));
 await ev("window.__beforePos=JSON.stringify(Mindmap.state().cur.pos);window.__beforeText=JSON.stringify(Mindmap.state().cur.nodes.map(n=>[n.id,n.text,n.citations]));document.getElementById('mmOrganizeScope').value='all'");await clickSel('#mmOrganizeButton');await sleep(300);
 check('One toolbar command balances three topic trees on both sides without decorative frames',await ev("Mindmap.state().cur.topicGroups.length===3 && document.querySelectorAll('.mm-topic-frame,.mm-topic-title').length===0 && new Set(Mindmap.state().cur.topicGroups.map(g=>g.color)).size===3 && Mindmap.state().cur.topicGroups.some(g=>Mindmap.state().cur.pos[g.centerId].x<Mindmap.state().cur.pos.root.x) && Mindmap.state().cur.topicGroups.some(g=>Mindmap.state().cur.pos[g.centerId].x>Mindmap.state().cur.pos.root.x)"));
 check('Hierarchy changes fill shade within one hue and preserves original content and citations',await ev("(()=>{const m=Mindmap.state().cur,a=document.querySelector('.mm-node[data-id=n00]'),b=document.querySelector('.mm-node[data-id=n01]');return m.nodes.find(n=>n.id==='n00').color===m.nodes.find(n=>n.id==='n01').color && getComputedStyle(a).backgroundColor!==getComputedStyle(b).backgroundColor && JSON.stringify(m.nodes.map(n=>[n.id,n.text,n.citations]))===__beforeText})()"));
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await sleep(200);await ev('Mindmap.fitView()');await sleep(300);const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'topic-islands-preview.png'),Buffer.from(shot.data,'base64'));
 await undo();check('Organization undoes all positions, theme membership and colors in one step',await ev("JSON.stringify(Mindmap.state().cur.pos)===__beforePos && !Mindmap.state().cur.topicGroups && !document.querySelector('.mm-topic-frame')"));await clickSel('#mmRedo');check('Redo restores topic hierarchy and positions',await ev("Mindmap.state().cur.topicGroups.length===3"));
 check('Topic backgrounds reuse real spatial groups with exactly their own nodes',await ev("Mindmap.state().cur.groups.length===3 && document.querySelectorAll('.mm-group-frame').length===3 && Mindmap.state().cur.groups.every(g=>{const t=Mindmap.state().cur.topicGroups.find(t=>t.key===g.topicKey);return JSON.stringify(MMGroups.members(g).nodes.sort())===JSON.stringify([...t.nodeIds].sort())})"));
 await ev("(()=>{const g=Mindmap.state().cur.groups[0];window.__groupId=g.id;window.__groupBefore=JSON.stringify({g,positions:Mindmap.state().cur.pos,members:MMGroups.members(g).nodes});document.getElementById('mmStage').style.setProperty('transition','none','important');Mindmap.zoom(.65);Mindmap.revealBox({x:g.x,y:g.y-40,w:300,h:180})})()");await sleep(200);
 const gp=await rectOf('[data-group-label="'+await ev('__groupId')+'"]');await mouse('mousePressed',gp.x,gp.y,1,1);for(let i=1;i<=4;i++)await mouse('mouseMoved',gp.x+i*15,gp.y+i*8,0,1);await mouse('mouseReleased',gp.x+60,gp.y+32,1,0);
 check('Dragging a generated group label moves its nodes together while other themes stay fixed',await ev("(()=>{const b=JSON.parse(__groupBefore),m=Mindmap.state().cur,g=m.groups.find(g=>g.id===__groupId),dx=g.x-b.g.x,dy=g.y-b.g.y;return dx>30 && m.nodes.every(n=>Math.abs(m.pos[n.id].x-b.positions[n.id].x-(b.members.includes(n.id)?dx:0))<.1 && Math.abs(m.pos[n.id].y-b.positions[n.id].y-(b.members.includes(n.id)?dy:0))<.1)})()"));await undo();
 await ev("MMGroups.select(__groupId)");await del();check('Deleting a generated bottom frame keeps all knowledge nodes and connections',await ev("Mindmap.state().cur.groups.length===2 && Mindmap.state().cur.nodes.length===10 && Mindmap.state().cur.edges.length===10"));await undo();await ev('Mindmap.fitView()');
 await ev("Mindmap.selectNodes(['n00'])");check('Selecting a node highlights only its direct incoming and outgoing edges without selecting them',await ev("(()=>{const st=Mindmap.state(),want=st.cur.edges.filter(e=>e.from.node==='n00'||e.to.node==='n00').map(e=>e.id).sort(),shown=[...document.querySelectorAll('.mm-edge.linked')].map(e=>e.dataset.id).sort();return JSON.stringify(want)===JSON.stringify(shown) && st.selectedEdge===null && st.selected.length===1 && !document.querySelector('.mm-edge.sel') && document.querySelectorAll('.mm-arrow.linked').length===want.length && document.querySelector('.mm-edge-label.linked')})()"));
 await ev("Mindmap.selectNodes(['n00','n10'])");check('Multi-node highlight is the union of direct links and never expands transitively',await ev("(()=>{const st=Mindmap.state(),want=st.cur.edges.filter(e=>['n00','n10'].includes(e.from.node)||['n00','n10'].includes(e.to.node)).map(e=>e.id).sort();return JSON.stringify(want)===JSON.stringify([...document.querySelectorAll('.mm-edge.linked')].map(e=>e.dataset.id).sort()) && st.selectedEdge===null})()"));
 await ev("Mindmap.selectNodes([])");check('Cross-topic links are quieter until a directly connected node is selected',await ev("parseFloat(getComputedStyle(document.querySelector('.mm-edge[data-id=cross]')).opacity)<.5"));await ev("Mindmap.selectNodes(['n01'])");check('Selecting an endpoint restores full visibility for its cross-topic link',await ev("getComputedStyle(document.querySelector('.mm-edge[data-id=cross]')).opacity==='1' && Mindmap.state().selectedEdge===null"));
 await ev("Mindmap.selectNodes(['n00'])");await del();check('Delete with highlighted connections deletes the node, not unrelated arrows or nodes',await ev("!Mindmap.findNode('n00') && Mindmap.state().cur.nodes.length===9 && Mindmap.state().cur.edges.some(e=>e.id==='en11') && Mindmap.state().selectedEdge===null"));await undo();
 await ev("Mindmap.selectNodes([]);Mindmap.zoom(.7);const a=Mindmap.state().L.nodes.get('n10'),b=Mindmap.state().L.nodes.get('n11');Mindmap.revealBox({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)})");await sleep(200);
 const point=await ev("(()=>{const st=Mindmap.state(),e=st.cur.edges.find(e=>e.id==='en11'),r=MMEdgeRouter.route(st.L.nodes.get(e.from.node),st.L.nodes.get(e.to.node),{...e,style:st.cur.line},[...st.L.nodes.values()]),p=r.points[Math.floor(r.points.length*.22)],v=Mindmap.view(),b=document.getElementById('mmView').getBoundingClientRect();return{x:b.left+v.x+p.x*v.k,y:b.top+v.y+p.y*v.k}})()");await clickAt(point.x,point.y);await wait("Mindmap.state().selectedEdge==='en11'");
 check('Clicking the actual curved path selects the arrow independently from node highlighting',await ev("Mindmap.state().selected.length===0 && !!document.querySelector('.mm-edge.sel[data-id=en11]') && document.getElementById('mmConnectionStyle').querySelector('option[value=inherit]')"));
 await ev("document.getElementById('mmConnectionStyle').value='elbow';document.getElementById('mmConnectionStyle').dispatchEvent(new Event('change',{bubbles:true}))");check('Selected-edge style overrides only that edge and retains map default',await ev("Mindmap.state().cur.line==='curve' && Mindmap.state().cur.edges.find(e=>e.id==='en11').style==='elbow' && !/[CQ]/.test(document.querySelector('.mm-edge[data-id=en11]').getAttribute('d')) && [...document.querySelectorAll('.mm-edge:not([data-id=en11])')].some(e=>/[CQ]/.test(e.getAttribute('d')))"));
 await ev("Mindmap.selectNodes(['n10'])");check('Selecting a node clears actual arrow selection and updates the style target',await ev("Mindmap.state().selectedEdge===null && !document.querySelector('.mm-edge.sel') && !document.querySelector('.mm-edge-label.edge-selected') && !document.querySelector('#mmConnectionStyle option[value=inherit]')"));
 await ev("Mindmap.selectNodes([])");check('Clearing node selection removes every linked highlight and restores native arrow hues',await ev("!document.querySelector('.mm-edge.linked,.mm-arrow.linked,.mm-edge-label.linked') && [...document.querySelectorAll('.mm-edge')].every(p=>p.getAttribute('stroke')===(Mindmap.state().cur.edges.find(e=>e.id===p.dataset.id).color || '#8b957f'))"));
 const nextPoint=await ev("(()=>{const e=document.querySelector('.mm-edge[data-id=en11]'),p=e.getPointAtLength(e.getTotalLength()*.22),v=Mindmap.view(),b=document.getElementById('mmView').getBoundingClientRect();return{x:b.left+v.x+p.x*v.k,y:b.top+v.y+p.y*v.k}})()");await clickAt(nextPoint.x,nextPoint.y);await wait("Mindmap.state().selectedEdge==='en11'");
 await undo();await del();check('Delete on a selected arrow removes only the arrow and keeps both endpoint nodes',await ev("Mindmap.state().cur.nodes.length===10 && !Mindmap.state().cur.edges.some(e=>e.id==='en11') && !!Mindmap.findNode('n10') && !!Mindmap.findNode('n11')"));await undo();
 await ev("Mindmap.selectNodes([]);document.getElementById('mmConnectionStyle').value='straight';document.getElementById('mmConnectionStyle').dispatchEvent(new Event('change',{bubbles:true}))");check('Map-level line setting applies to all inherited arrows and is undoable',await ev("Mindmap.state().cur.line==='straight' && [...document.querySelectorAll('.mm-edge')].every(e=>!/[CQ]/.test(e.getAttribute('d')))"));await undo();
 await ev("Mindmap.selectNodes(['n00']);window.__outsidePos=JSON.stringify(Object.fromEntries(Object.entries(Mindmap.state().cur.pos).filter(([id])=>!['n00','n01','n02'].includes(id))));document.getElementById('mmOrganizeScope').value='branch'");await clickSel('#mmOrganizeButton');check('Branch organization leaves every other topic and overview position unchanged',await ev("JSON.stringify(Object.fromEntries(Object.entries(Mindmap.state().cur.pos).filter(([id])=>!['n00','n01','n02'].includes(id))))===__outsidePos"));await undo();
 await ev('MMFiles.save()');await ev("Mindmap.open('topic-layout-test')");check('Saving and reopening preserve theme membership, depth colors and curve setting',await ev("Mindmap.state().cur.topicGroups.length===3 && Mindmap.state().cur.topicLevels.n01===1 && Mindmap.state().cur.line==='curve' && document.querySelectorAll('.mm-topic-frame,.mm-topic-title').length===0"));
 await ev("document.querySelector('[data-mark-tool=line]').click();window.__detailData=JSON.stringify(Mindmap.state().cur)");await clickSel('#mmOverviewView');
 check('Overview is a smaller text-first graph with AI briefs and no duplicate canvas nodes',await ev("MMTopicUI.mode==='overview' && document.querySelectorAll('.mm-overview-card').length===4 && document.querySelector('.mm-structure-overview').textContent.includes('物理意义') && !document.querySelector('.mm-structure-overview .katex') && JSON.stringify(Mindmap.state().cur)===__detailData"));

 await ev("window.__detailCamera=JSON.stringify(Mindmap.view());window.__overviewBefore={...MMTopicUI.viewport};window.__pageBefore={width:innerWidth,scale:visualViewport.scale};window.__overviewRect=document.querySelector('.mm-structure-overview').getBoundingClientRect().toJSON()");
 const wheelPoint=await ev("({x:Math.floor(__overviewRect.left+__overviewRect.width*.6),y:Math.floor(__overviewRect.top+__overviewRect.height*.5)})");
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaX:0,deltaY:-140,modifiers:2});await sleep(80);
 check('Trackpad-style Ctrl wheel zooms only the overview and keeps the cursor world point fixed',await ev(`(()=>{const a=__overviewBefore,b=MMTopicUI.viewport,x=${wheelPoint.x}-__overviewRect.left,y=${wheelPoint.y}-__overviewRect.top;return b.k>a.k&&Math.abs((x-a.x)/a.k-(x-b.x)/b.k)<.01&&Math.abs((y-a.y)/a.k-(y-b.y)/b.k)<.01&&JSON.stringify(Mindmap.view())===__detailCamera&&innerWidth===__pageBefore.width&&visualViewport.scale===__pageBefore.scale})()`));
 check('Overview cancels the browser pinch default rather than only stopping propagation',await ev("(()=>{const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:10});document.querySelector('.mm-overview-card').dispatchEvent(e);return e.defaultPrevented})()"));
 await ev("window.__beforePan={...MMTopicUI.viewport}");await send('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaX:35,deltaY:45});await sleep(70);
 check('Unmodified two-finger wheel pans the overview horizontally and vertically',await ev("Math.abs(MMTopicUI.viewport.x-__beforePan.x+35)<.1&&Math.abs(MMTopicUI.viewport.y-__beforePan.y+45)<.1&&MMTopicUI.viewport.k===__beforePan.k"));
 const blank=await ev("(()=>{const r=document.querySelector('.mm-structure-overview').getBoundingClientRect();window.__beforeDrag={...MMTopicUI.viewport};return{x:r.left+6,y:r.top+100}})()");await mouse('mousePressed',blank.x,blank.y,1,1);await mouse('mouseMoved',blank.x+38,blank.y+27,0,1);await mouse('mouseReleased',blank.x+38,blank.y+27,1,0);await sleep(70);
 check('Overview dragging cannot activate the hidden line tool or alter detailed nodes',await ev("MMTopicUI.mode==='overview'&&Math.abs(MMTopicUI.viewport.x-__beforeDrag.x-38)<1&&Math.abs(MMTopicUI.viewport.y-__beforeDrag.y-27)<1&&JSON.stringify(Mindmap.state().cur)===__detailData"));await sleep(380);
 await ev("window.__beforeButtons=MMTopicUI.viewport.k");await clickSel('[data-overview-action=in]');check('The visible overview zoom controls update their own scale readout',await ev("MMTopicUI.viewport.k>__beforeButtons&&document.querySelector('[data-overview-zoom]').textContent===Math.round(MMTopicUI.viewport.k*100)+'%'&&JSON.stringify(Mindmap.view())===__detailCamera"));
 await ev("document.querySelector('.mm-structure-overview').focus();window.__beforeKey=MMTopicUI.viewport.k");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus',windowsVirtualKeyCode:189,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'-',code:'Minus',windowsVirtualKeyCode:189,modifiers:2});check('Ctrl-minus targets the overview rather than the hidden detailed canvas',await ev("MMTopicUI.viewport.k<__beforeKey&&JSON.stringify(Mindmap.view())===__detailCamera"));
 await ev("MMTopicUI.zoomBy(1e9);window.__maxOverview=MMTopicUI.viewport.k;MMTopicUI.zoomBy(1e-9)");check('Overview zoom shares the detailed canvas 15–300 percent limits',await ev("__maxOverview===3&&MMTopicUI.viewport.k===.15"));
 await clickSel('[data-overview-action=fit]');await ev("window.__beforeTouch={...MMTopicUI.viewport};(()=>{const el=document.querySelector('.mm-structure-overview'),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;for(const [type,id,dx]of [['pointerdown',31,-40],['pointerdown',32,40],['pointermove',32,90],['pointerup',31,-40],['pointerup',32,90]])el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',button:0,clientX:x+dx,clientY:y}));})()");check('Touchscreen two-pointer pinch also zooms the overview without selecting hidden nodes',await ev("MMTopicUI.viewport.k>__beforeTouch.k&&MMTopicUI.mode==='overview'&&JSON.stringify(Mindmap.state().cur)===__detailData"));await sleep(380);
 await ev("document.querySelector('.mm-structure-overview').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'0',code:'Digit0',windowsVirtualKeyCode:48,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'0',code:'Digit0',windowsVirtualKeyCode:48,modifiers:2});
 check('Ctrl-zero refits the overview and leaves browser and detail scale unchanged',await ev("Math.abs(MMTopicUI.viewport.k-__beforeTouch.k)<.001&&JSON.stringify(Mindmap.view())===__detailCamera&&visualViewport.scale===__pageBefore.scale"));
 const overviewShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'structure-overview-preview.png'),Buffer.from(overviewShot.data,'base64'));
 await del();check('Overview blocks hidden-node deletion and disables layout/style editing',await ev("JSON.stringify(Mindmap.state().cur)===__detailData && document.getElementById('mmOrganizeButton').disabled && document.getElementById('mmConnectionStyle').disabled"));
 await clickSel('[data-overview-node=overview-1]');check('Clicking an overview theme returns to the matching detailed node without changing content',await ev("MMTopicUI.mode==='detail' && Mindmap.state().sel==='n10' && !document.querySelector('.mm-structure-overview') && JSON.stringify(Mindmap.state().cur)===__detailData"));
 await ev("document.querySelector('[data-mark-tool=select]').click()");await clickSel('#mmOverviewView');await clickSel('#mmDetailView');check('View switching preserves manual positions and creates no undoable edit',await ev("JSON.stringify(Mindmap.state().cur)===__detailData"));
 await ev("document.getElementById('mmWorkspace').classList.add('is-collapsed')");await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(200);check('New organization and connection controls fit a phone-width toolbar',await ev("[...document.querySelectorAll('.mm-topic-controls button,.mm-topic-controls select')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})"));
 await ev("MMTopicUI.setMode('overview')");await sleep(150);check('Overview reserves space below the toolbar and removes the editing strip',await ev("document.querySelector('.mm-structure-overview').getBoundingClientRect().top>=document.querySelector('.mm-tools').getBoundingClientRect().bottom && getComputedStyle(document.getElementById('mmMarkTools')).display==='none'"));await clickSel('[data-overview-action=fit]');check('Phone overview retains its graph and working zoom controls without page overflow',await ev("getComputedStyle(document.querySelector('.mm-overview-links')).display!=='none' && getComputedStyle(document.querySelector('.mm-overview-scene')).transform!=='none' && document.querySelector('[data-overview-action=in]') && document.documentElement.scrollWidth<=innerWidth"));
 const phone=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'structure-overview-phone.png'),Buffer.from(phone.data,'base64'));
 await ev("Mindmap.openDocument({id:'another-map',flat:true,v:3,title:'另一个项目',nodes:[{id:'only',text:'另一个项目',children:[]}],edges:[],pos:{only:{x:0,y:0}}})");check('Switching documents closes the old overview and cannot expose stale topic links',await ev("MMTopicUI.mode==='detail' && !document.querySelector('.mm-structure-overview')"));
 check('No uncaught browser errors',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));const failures=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-failures.length} passed / ${failures.length} failed`);code=failures.length?1:0;
}catch(error){console.error(error);try{console.log(await ev('__uiErrors'));const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'topic-ui-error.png'),Buffer.from(s.data,'base64'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(200);try{child?.kill();}catch{}if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('topic-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
