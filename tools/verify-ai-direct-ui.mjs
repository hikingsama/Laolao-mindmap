#!/usr/bin/env node
/* 直接生成导图专项浏览器验证。使用8893端口、随机临时导图与假API配置、临时浏览器资料；
 * 不读取个人导图或真实密钥。需要本机Edge/Chrome与Node>=22。
 * node tools/verify-ai-direct-ui.mjs --port 8893 --project <AI副本路径>
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
const project=argOf('project',process.cwd()),require=createRequire(path.join(project,'package.json'));
const base=path.join(project,'tmp');fs.mkdirSync(base,{recursive:true});const temp=fs.mkdtempSync(path.join(base,'ai-direct-browser-'));
const received=[],planned=[],sockets=new Set();let upstreamStopped=0;
const derivative={edges:[{from:'n1',to:'n2',kind:'mainline'},{from:'n2',to:'n3',kind:'progression'},{from:'n1',to:'n4',kind:'parallel'},{from:'n2',to:'n5',kind:'supplement'}],nodes:[
 {id:'n1',title:'理解函数变化',text:'把函数看作输入和输出的对应关系，先关注变化率。'},
 {id:'n2',title:'导数的定义',blocks:[{type:'text',text:'先计算平均变化率，再取极限：'},{type:'math',latex:"f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}"},{type:'text',text:'代入平方函数得到：'},{type:'math',latex:"f'(x)=2x"}]},
 {id:'n3',title:'局部线性近似',text:"使用切线估算函数值：$f(x+h)\\approx f(x)+f'(x)h$。"},
 {id:'n4',title:'几何含义',text:'导数表示曲线的切线斜率。'},
 {id:'n5',title:'可导条件',text:'可导必定连续，连续未必可导。'}]};
const travel={edges:[{from:'t1',to:'t2',kind:'parallel'}],nodes:[{id:'t1',title:'杭州',text:'西湖步行游览。'},{id:'t2',title:'苏州',text:'参观园林。'}]};
const streamNoise=(res,n)=>{for(let i=0;i<n;i++)res.write('data: '+JSON.stringify({metadata:'x'.repeat(1600),choices:[{delta:{reasoning_content:'fake private reasoning'}}]})+'\n\n');};
const mock=http.createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const data=JSON.parse(raw);
 if(data.messages?.[0]?.content.includes('内容关联员')){
   planned.push(data);const request=JSON.parse(data.messages.at(-1).content);
   if(request.question.includes('PLANWAIT')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'{"direction":"'}}]})+'\n\n');res.on('close',()=>upstreamStopped++);return;}
   if(request.question.includes('PLANFAIL')){res.writeHead(503);res.end('{}');return;}
   if(request.question.includes('PLANHUGE')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(256*1024+1)}}]})+'\n\ndata: [DONE]\n\n');return;}
   const content=JSON.stringify({direction:request.direction || '解释当前问题的依据，沿用本条推导中的符号与假设。',relation:request.question.includes('旅行')?'new':'continue',sourceIds:request.sources.slice(0,6).map(s=>s.id),note:'已选取发问节点和当前推导路径，相关树资料仅作补充。'});
   res.writeHead(200,{'Content-Type':'text/event-stream'});if(request.question.includes('PLANWIRE'))streamNoise(res,200);for(let i=0;i<content.length;i+=40){if(res.destroyed)return;res.write('data: '+JSON.stringify({choices:[{delta:{content:content.slice(i,i+40)}}]})+'\n\n');await sleep(80);}res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
 }
 received.push(data);
 if(!req.url.endsWith('/chat/completions')){res.writeHead(500);res.end('unexpected endpoint');return;}
 const question=JSON.stringify(data.messages.at(-1).content),plan=question.includes('旅行')?travel:derivative;
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 if(question.includes('ANSWERWIRE'))streamNoise(res,4000);
 const sendText=content=>res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
 if(question.includes('WAIT')){sendText('{"edges":'+JSON.stringify(plan.edges)+',"nodes":['+JSON.stringify(plan.nodes[0])+',');res.on('close',()=>upstreamStopped++);return;}
 const content=question.includes('INVALID')?'{"nodes":['+JSON.stringify(plan.nodes[0])+'],"edges":[{"from":"n1","to":"missing","kind":"mainline"}]}':JSON.stringify(plan);
 for(let i=0;i<content.length;i+=75){if(res.destroyed)return;sendText(content.slice(i,i+75));await sleep(110);}
 res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');
const profiles=Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]));profiles.custom={baseURL:'http://127.0.0.1:'+mock.address().port+'/v1',model:'fake-vision',apiKey:'fake-browser-secret'};profiles.glm={...profiles.custom};
const privateConfig={version:1,activeProvider:'custom',profiles,drawing:{enabled:true,model:'glm-image',size:'1280x1280'}};fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,JSON.stringify(privateConfig));
const wait=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await sleep(80);}throw new Error('UI timeout: '+expression);};
const ask=async text=>{await ev(`document.getElementById('mmAIInput').value=${JSON.stringify(text)};document.getElementById('mmAIForm').requestSubmit()`);};
const complete=async text=>{await ask(text);await wait("!document.getElementById('mmAISend').disabled");};
// Canvas controls move through the view transform, never native scrollIntoView.
const clickLearning=async selector=>{
 await ev(`(()=>{document.getElementById('mmStage').style.setProperty('transition','none','important');document.getElementById('mmStage').classList.remove('anim');Mindmap.resetScroll?.();const m=Mindmap.state().cur,card=document.querySelector(${JSON.stringify(selector)}).closest('.mm-ai-learning'),r=m.aiMemory.turns.find(t=>t.id===card.dataset.aiLearning),n=m.nodes.find(n=>n.aiEntry && n.aiTurnId===r.id);Mindmap.revealBox(MMAILearning.box(Mindmap.state().L.nodes.get(n.id),r))})()`);
 const p=await rectOf(selector);await clickAt(p.x,p.y);
};
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
const redo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'y',code:'KeyY',windowsVirtualKeyCode:89,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'y',code:'KeyY',windowsVirtualKeyCode:89,modifiers:2});};
const fixture=id=>`Mindmap.openDocument({id:${JSON.stringify(id)},title:'直接生成检查',v:3,flat:true,theme:'fresh',nodes:[{id:'a',text:'问题 $x^2$',children:[]},{id:'b',text:'相邻定义',children:[]}],pos:{a:{x:0,y:0},b:{x:350,y:0}},size:{a:{w:180,h:80},b:{w:180,h:80}},edges:[]})`;
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMAI && !!window.MMFiles');
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 check('Paper home and blank creation survive the workflow change',await ev("!!document.querySelector('.mm-home-hero') && !!document.querySelector('[data-tpl=blank]') && !document.querySelector('[data-tpl=course]')"));
 await clickSel('#mmAPISettingsButton');await wait("!document.getElementById('mmAPISave').disabled");
 check('Settings retain all chat providers and remove image-generation controls',await ev("document.querySelectorAll('#mmAPIProvider option').length===4 && !document.getElementById('mmAPIDrawingEnabled') && !document.querySelector('.mm-api-drawing')"));
 await ev("document.getElementById('mmAPISettingsForm').requestSubmit()");await wait("document.getElementById('mmAPIResult').dataset.kind==='success'");
 check('Saving settings preserves existing keys and legacy private data',JSON.stringify(JSON.parse(fs.readFileSync(process.env.MM_AI_CONFIG_FILE,'utf8')))==JSON.stringify(privateConfig));
 const removed=await fetch(`http://127.0.0.1:${PORT}/api/ai/images`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'retired'})});
 check('Image-generation API is unavailable even when old configuration enabled it',removed.status===404 && received.length===0);
 await ev("document.getElementById('mmAPISettingsDialog').close()");await ev(fixture('direct-map'));await ev("MMAI.open('a')");await wait("document.getElementById('mmAIStatus').textContent.includes('fake-vision')");
 const width=await ev("document.getElementById('mmAI').getBoundingClientRect().width"),handle=await rectOf('.mm-ai-resizer');
 await mouse('mousePressed',handle.x,handle.y,1,1);await mouse('mouseMoved',handle.x-140,handle.y,0,1);await sleep(70);check('Sidebar width updates before mouse release',await ev(`Math.abs(document.getElementById('mmAI').getBoundingClientRect().width-${width+140})<3`));await mouse('mouseReleased',handle.x-140,handle.y,1,0);
 check('Dragging left boundary widens sidebar and reserves matching canvas space',await ev(`Math.abs(document.getElementById('mmAI').getBoundingClientRect().width-${width+140})<3 && Math.abs(parseFloat(getComputedStyle(document.getElementById('mmBox')).marginRight)-${width+170})<3`));
 check('Top bar shares the resized canvas boundary and wraps its controls inside it',await ev("(()=>{const h=document.querySelector('.mm-head'),r=h.getBoundingClientRect(),a=document.getElementById('mmAI').getBoundingClientRect();return Math.abs(a.left-r.right-14)<3 && [...h.children].filter(e=>e.getBoundingClientRect().width>0).every(e=>e.getBoundingClientRect().right<=r.right+1)})()"));
 await ev('MMAI.close()');check('Closing the sidebar restores the full top bar width',await ev("Math.abs(innerWidth-document.querySelector('.mm-head').getBoundingClientRect().right-22)<2"));await ev("MMAI.open('a')");
 check('Question heading is compact and attachment controls are removed',await ev("Math.abs(document.querySelector('.mm-ai-heading').getBoundingClientRect().height-44)<2 && !document.getElementById('mmAIMedia') && !document.getElementById('mmAIAttach') && !document.getElementById('mmAIPDFPages')"));
 check('Desktop sidebar fills the previously empty space beside the header',await ev("(()=>{const a=document.getElementById('mmAI').getBoundingClientRect(),h=document.querySelector('.mm-head').getBoundingClientRect();return Math.abs(a.top-h.top)<2 && Math.abs(innerHeight-a.bottom-16)<2})()"));
 await ev("MMAI.close();MMAI.open('a')");check('Closing and reopening keeps the preferred width',await ev(`Math.abs(document.getElementById('mmAI').getBoundingClientRect().width-${width+140})<3 && Number(localStorage.getItem('mm_ai_sidebar_width'))>500`));
 await ev("document.querySelector('.mm-ai-resizer').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
 check('Keyboard adjusts accessible separator width',await ev(`Math.abs(document.getElementById('mmAI').getBoundingClientRect().width-${width+120})<3 && !!document.querySelector('.mm-ai-resizer[aria-valuenow]')`));
 await send('Emulation.setDeviceMetricsOverride',{width:800,height:800,deviceScaleFactor:1,mobile:false});await sleep(150);
 check('Narrow window overlays sidebar and preserves usable canvas width',await ev("document.getElementById('mmAI').getBoundingClientRect().width<=innerWidth-32 && parseFloat(getComputedStyle(document.getElementById('mmBox')).marginRight)===14"));
 check('Narrow sidebar keeps header controls accessible above its overlay',await ev("document.getElementById('mmAI').getBoundingClientRect().top>=document.querySelector('.mm-head').getBoundingClientRect().bottom+7"));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});await sleep(150);
 check('Phone-width sidebar fits screen without an offscreen resize handle',await ev("document.getElementById('mmAI').getBoundingClientRect().width<=innerWidth && getComputedStyle(document.querySelector('.mm-ai-resizer')).display==='none'"));
 check('Phone top bar keeps its full available width',await ev("Math.abs(innerWidth-document.querySelector('.mm-head').getBoundingClientRect().right-8)<2"));
 await send('Emulation.clearDeviceMetricsOverride');await sleep(150);
 await ev("document.querySelector('.mm-ai-resizer').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));window.__originalPos=JSON.stringify(Mindmap.state().cur.pos)");
 const zoom=await ev('Mindmap.view().k'),header=await rectOf('#mmAPISettingsButton');await send('Input.dispatchMouseEvent',{type:'mouseWheel',...header,deltaX:0,deltaY:-140,modifiers:2});
 check('Header still blocks page zoom and canvas zoom',await ev('Mindmap.view().k')===zoom);
 await ask('解释导数的定义');await wait("!!document.querySelector('.mm-wf-stage.running')");
 check('Sidebar shows the real planning stage before any answer node exists',await ev("!!document.querySelector('.mm-wf-stage.running') && document.querySelector('.mm-ai-workflow').textContent.includes('关联与定向') && Mindmap.state().cur.nodes.length===2") && planned.length===1);
 await wait("Mindmap.state().cur.nodes.length>2 && document.getElementById('mmAISend').disabled");
 check('Complete nodes appear on main canvas while model is still streaming',await ev("Mindmap.state().cur.nodes.length>=4 && !document.querySelector('.mm-ai-graph') && !document.querySelector('[data-ai=modify],[data-ai=push]') && !window.MMAIGraphPreview"));
 check('Learning starts expanded and separate from generation progress',await ev("document.querySelectorAll('.mm-ai-learning').length===1 && document.querySelector('.mm-learn-toggle').textContent.includes('0/4') && document.querySelector('.mm-learn-toggle').getAttribute('aria-expanded')==='true' && document.querySelectorAll('.mm-learn-items input').length===4"));
 await ev("(()=>{window.__learnTurn=Mindmap.state().cur.aiMemory.turns[0].id;const n=Mindmap.state().cur.nodes.find(n=>n.aiEntry),b=MMAILearning.box(Mindmap.state().L.nodes.get(n.id),Mindmap.state().cur.aiMemory.turns[0]);Mindmap.revealBox(b)})()");
 await clickLearning('.mm-ai-learning [data-ai-learn-index="0"]');
 check('Real checkbox clicks during streaming update only this question learning state',await ev("Mindmap.state().cur.aiMemory.turns[0].learning.checked[0]===true && document.querySelectorAll('.mm-ai-learning input').length===4 && !Mindmap.state().cur.nodes.find(n=>n.aiEntry).text.includes('阅览')"));
 await wait("!document.getElementById('mmAISend').disabled");
 check('One question uses two real roles and one question entry with typed relations',received.length===1 && planned.length===1 && received[0].stream===true && await ev("Mindmap.state().cur.nodes.length===8 && Mindmap.state().cur.nodes.filter(n=>n.text.startsWith('# 第1次提问')).length===1 && ['主线','递进','并列','补充说明'].every(k=>Mindmap.state().cur.edges.some(e=>e.label===k))"));
 check('Completed workflow folds to a compact summary with real selected sources',await ev("!!document.querySelector('.mm-wf-completed:not([open])') && Mindmap.state().cur.aiMemory.turns[0].workflow.planningStatus==='completed' && Mindmap.state().cur.aiMemory.turns[0].workflow.sources.length>0"));
 check('Generation completion preserves manual checks without completing the other learning steps',await ev("MMAILearning.progress(Mindmap.state().cur.aiMemory.turns[0].learning)===1 && document.querySelector('.mm-ai-learning input').checked && document.querySelectorAll('.mm-ai-learning').length===1"));
 check('Expanded checklist has exactly four labels and the final item contains only the requested six characters',await ev("JSON.stringify([...document.querySelectorAll('.mm-learn-items label span')].map(e=>e.textContent))===JSON.stringify(['阅览','提炼','亲笔推导','对比权威答案'])"));
 await clickLearning('.mm-learn-toggle');
 check('Folding keeps the manual count and removes expanded controls',await ev("document.querySelector('.mm-learn-toggle').textContent.includes('1/4') && !document.querySelector('.mm-learn-items')"));
 check('Question and answer cards have visibly opposite alignment and preserve formula width',await ev("(()=>{const u=document.querySelector('.mm-ai-message.user').getBoundingClientRect(),a=document.querySelector('.mm-ai-message.assistant').getBoundingClientRect();return u.left>a.left+30 && u.right>a.right+20 && a.width>u.width})()"));
 check('Main entry has a saved task badge and branch color distinct from its parent',await ev("(()=>{const m=Mindmap.state().cur,e=m.nodes.find(n=>n.aiEntry);return !!document.querySelector('[data-ai-turn]') && e.color!==Mindmap.state().L.nodes.get('a').color && m.nodes.filter(n=>n.aiTurnId===e.aiTurnId).every(n=>n.color===e.color) && m.edges.some(l=>l.label==='提问' && l.from.node==='a' && l.to.node===e.id && l.color===e.color)})()"));
 check('Original nodes retain their positions',await ev("(()=>{const p=JSON.parse(__originalPos);return ['a','b'].every(id=>JSON.stringify(Mindmap.state().cur.pos[id])===JSON.stringify(p[id]))})()"));
 await ev("window.__formulaID=Mindmap.state().cur.nodes.find(n=>n.text.startsWith('# 导数的定义')).id;Mindmap.selectNodes([__formulaID]);Mindmap.revealBox(Mindmap.state().L.nodes.get(__formulaID))");
 check('Main nodes keep separate display formulas and complete measured height',await ev("(()=>{const n=document.querySelector('.mm-node[data-id=\"'+__formulaID+'\"]');return n.querySelectorAll('.katex-display').length===2 && n.querySelector('.mm-rich').scrollHeight<=n.querySelector('.mm-rich').clientHeight+2})()"));
 const firstIDs=await ev('Mindmap.state().cur.nodes.map(n=>n.id)');await complete('换个问题，旅行去杭州和苏州怎么安排？');
 check('Unrelated second question adds only its own entry and content',received.length===2 && await ev("Mindmap.state().cur.nodes.length===11 && Mindmap.state().cur.nodes.filter(n=>n.text.startsWith('# 第2次提问')).length===1 && Mindmap.state().cur.nodes.filter(n=>n.text.startsWith('# 导数的定义')).length===1 && Mindmap.state().cur.nodes.filter(n=>n.text.startsWith('# 杭州')).length===1"));
 check('New questions have their own unchecked learning list',await ev("document.querySelectorAll('.mm-ai-learning').length===2 && MMAILearning.progress(Mindmap.state().cur.aiMemory.turns[1].learning)===0 && MMAILearning.progress(Mindmap.state().cur.aiMemory.turns[0].learning)===1"));
 check('Followup context is retained but output prompt explicitly scopes this turn',received[1].messages.some(m=>m.role==='assistant' && m.content.includes('导数')) && received[1].messages[0].content.includes('不得将此前回答重新总结'));
 const finished=await ev('JSON.stringify(Mindmap.state().cur)');await undo();
 check('One undo removes only second question batch',JSON.stringify(await ev('Mindmap.state().cur.nodes.map(n=>n.id)'))===JSON.stringify(firstIDs));await undo();
 check('Earlier streamed batch also undoes in one step',await ev('Mindmap.state().cur.nodes.length===2 && Mindmap.state().cur.edges.length===0'));await redo();await redo();
 check('Redo restores both complete batches',await ev('JSON.stringify(Mindmap.state().cur)')===finished);
 await ev('MMFiles.save()');
 check('Explicit save persists generated nodes and links',await ev("(async()=>{const m=await(await fetch('/api/maps/direct-map')).json();return m.nodes.length===11 && m.edges.some(e=>e.label==='递进')})()"));
 await ev("MMAI.close();MMAI.open('a')");await sleep(300);
 check('Reopening conversation does not regenerate stored answers',received.length===2 && await ev('Mindmap.state().cur.nodes.length===11'));
 check('Saved map JSON includes the manually checked learning state',await ev("(async()=>{const m=await(await fetch('/api/maps/direct-map')).json();return m.aiMemory.turns[0].learning.checked[0]===true && m.aiMemory.turns[0].learning.expanded===false})()"));
 await ev("MMAI.open(__formulaID)");
 check('Switching nodes in one tree displays its shared history',await ev("document.querySelectorAll('.mm-ai-message.user').length===2 && document.getElementById('mmAIContext').textContent.includes('同树 2 次')"));
 await complete('接着这条导数推导，解释为什么要取极限');
 check('Cross-node followup inherits its parent answer and uses a tree-wide question number',received.at(-1).messages.some(m=>m.role==='assistant' && m.content.includes('导数的定义')) && !received.at(-1).messages.some(m=>m.role==='assistant' && m.content.includes('西湖')) && await ev("Mindmap.state().cur.aiMemory.turns.length===3 && Mindmap.state().cur.aiMemory.turns[2].number===3 && Mindmap.state().cur.aiMemory.turns[2].parentTurnId===Mindmap.state().cur.aiMemory.turns[0].id"));
 await ev("MMAI.openTurn(Mindmap.state().cur.aiMemory.turns[0].id)");await sleep(80);
 check('Clicking a task entry reopens its direction and source details',await ev("[...document.querySelectorAll('.assistant')].some(el=>el.dataset.turnId===Mindmap.state().cur.aiMemory.turns[0].id && el.querySelector('[data-wf-details][open]')) && document.querySelectorAll('.mm-wf-source').length>0"));
 await ev("document.querySelector('.assistant [data-wf-source]').click()");
 check('Source links navigate to actual nodes without creating extra questions',await ev("Mindmap.state().sel===Mindmap.state().cur.aiMemory.turns[0].workflow.sources[0].nodeId && Mindmap.state().cur.aiMemory.turns.length===3"));
 await ev("Mindmap.editMap(()=>Mindmap.state().cur.nodes.find(n=>n.id==='a').text+=' · 已编辑');MMAI.open('a')");
 check('Changed sources retain original snapshots and show the edit marker',await ev("document.getElementById('mmAIMessages').textContent.includes('来源已编辑') && Mindmap.state().cur.aiMemory.turns[0].workflow.sources[0].text==='问题 $x^2$'"));
 await ev("MMFiles.save();");await ev("Mindmap.open('direct-map')");await ev("MMAI.open(__formulaID)");
 check('Tree history, role results and ownership survive saving and reopening',await ev("Mindmap.state().cur.aiMemory.turns.length===3 && document.querySelectorAll('.mm-ai-message.user').length===3 && Mindmap.state().cur.aiMemory.membership[__formulaID]===Mindmap.state().cur.aiMemory.membership.a"));
 await ev("(()=>{const r=Mindmap.state().cur.aiMemory.turns[0],n=Mindmap.state().cur.nodes.find(n=>n.aiEntry && n.aiTurnId===r.id);Mindmap.revealBox(MMAILearning.box(Mindmap.state().L.nodes.get(n.id),r))})()");
 const firstCard='[data-ai-learning="'+await ev('Mindmap.state().cur.aiMemory.turns[0].id')+'"]';
 await clickLearning(firstCard+' .mm-learn-toggle');
 check('Reopened checklist restores checks and all redraws retain exactly one card per question',await ev("document.querySelector('[data-ai-learning=\"'+__learnTurn+'\"] input').checked && document.querySelectorAll('.mm-ai-learning').length===3"));
 await ev("document.querySelector('[data-ai-learning=\"'+__learnTurn+'\"] [data-ai-learn-index=\"1\"]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await clickLearning(firstCard+' [data-ai-learn-index="2"]');await clickLearning(firstCard+' [data-ai-learn-index="3"]');
 check('Keyboard and mouse can complete all four steps without changing AI generation status',await ev("MMAILearning.progress(Mindmap.state().cur.aiMemory.turns[0].learning)===4 && document.querySelector('[data-ai-learning=\"'+__learnTurn+'\"] .mm-learn-toggle').textContent.includes('本轮学习完成') && Mindmap.state().cur.aiMemory.turns[0].status==='completed'"));
 await clickLearning(firstCard+' .mm-learn-toggle');
 const learningShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(project,'tmp','learning-preview.png'),Buffer.from(learningShot.data,'base64'));
 await ev(fixture('stop-map'));await ev("MMAI.open('a')");await ask('WAIT 停止测试');await wait("Mindmap.state().cur.nodes.length===4");await ev("document.getElementById('mmAIStop').click()");await sleep(300);
 check('Stopping preserves finished nodes and restores the question draft',await ev("Mindmap.state().cur.nodes.length===4 && !document.getElementById('mmAISend').disabled && document.getElementById('mmAIInput').value.includes('WAIT') && document.getElementById('mmAIMessages').textContent.includes('生成未完成')") && upstreamStopped>0);
 await undo();check('Stopped partial batch undoes once without leaving an entry',await ev('Mindmap.state().cur.nodes.length===2 && Mindmap.state().cur.edges.length===0'));
 await ask('WAIT 撤销进行中的生成');await wait('Mindmap.state().cur.nodes.length===4');await undo();await sleep(350);
 check('Undo during generation cancels request and prevents late node resurrection',await ev("Mindmap.state().cur.nodes.length===2 && !document.getElementById('mmAISend').disabled"));
 await ask('WAIT 切换提问节点');await wait('Mindmap.state().cur.nodes.length===4');await ev("MMAI.open('b')");await sleep(300);
 check('Switching question target cancels prior generation and keeps conversations separate',await ev("!document.getElementById('mmAISend').disabled && document.getElementById('mmAIMessages').textContent.includes('每次提问单独形成一组')"));
 await ev(fixture('invalid-map'));await ev("MMAI.open('a')");await complete('INVALID 最终结构错误');
 check('Invalid final graph reports failure while retaining completed valid nodes',await ev("Mindmap.state().cur.nodes.length===4 && document.getElementById('mmAIMessages').textContent.includes('生成未完成') && document.getElementById('mmAIStatus').textContent.includes('无效节点')"));
 await ev(fixture('switch-map'));await ev("MMAI.open('a')");await ask('WAIT 切换导图');await wait('Mindmap.state().cur.nodes.length===4');await ev(fixture('new-map'));await sleep(350);
 check('Switching maps cannot leak pending nodes into the new map',await ev("Mindmap.state().cur.id==='new-map' && Mindmap.state().cur.nodes.length===2 && !document.getElementById('mmAISend').disabled"));
 await ev("MMAI.open('a')");await ask('WAIT 保存部分结果');await wait('Mindmap.state().cur.nodes.length===4');await ev('MMFiles.save()');await sleep(250);
 check('Saving during generation stops it and persists the finished portion',await ev("(async()=>{const m=await(await fetch('/api/maps/new-map')).json();return m.nodes.length===4 && !document.getElementById('mmAISend').disabled})()"));
 await ev(fixture('attachment-map'));await ev(`(async()=>{const c=document.createElement('canvas');c.width=80;c.height=60;const ctx=c.getContext('2d');ctx.fillStyle='#88aa66';ctx.fillRect(0,0,80,60);const blob=await new Promise(r=>c.toBlob(r,'image/png'));await MMFiles.insertFiles([new File([blob],'保留的图片.png',{type:'image/png'})],{x:0,y:300});})()`);
 await ev("MMAI.open(Mindmap.state().cur.nodes.find(n=>n.image).id)");await complete('解释附带的图片');
 check('Image input still transmits actual image data and keeps existing image nodes',received.at(-1).messages.at(-1).content.some(p=>p.type==='image_url' && p.image_url.url.startsWith('data:image/')) && await ev('Mindmap.state().cur.nodes.filter(n=>n.image).length===1'));
 check('No image-generation requests are sent',received.every(r=>!r.prompt && r.model==='fake-vision'));
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(project,'tmp','direct-canvas-preview.png'),Buffer.from(shot.data,'base64'));
 await ev('Mindmap.openDocument('+JSON.stringify({id:'workflow-view',title:'提问链与角色协作',v:3,flat:true,theme:'fresh',nodes:[{id:'a',text:'# 导数与极限\n\n从平均变化率理解瞬时变化率。',children:[]},{id:'b',text:'# 极限定义\n\n使用极限计算导数，解释变化率的意义。',children:[]},{id:'physics',text:'# 物理速度\n\n导数与极限定义：瞬时速度是位移对时间的导数。',children:[]}],pos:{a:{x:0,y:0},b:{x:440,y:0},physics:{x:0,y:520}},edges:[{id:'mother-edge',from:{node:'a',side:'e'},to:{node:'b',side:'w'},dir:'fwd'}]})+')');await ev("MMAI.open('a')");await complete('物理速度和导数的极限定义有什么关联？');
 check('Association role selects related sources from another tree without merging ownership',planned.at(-1).messages.at(-1).content.includes('physics') && await ev("Mindmap.state().cur.aiMemory.turns[0].workflow.sources.some(s=>s.nodeId==='physics' && s.kind==='related') && Mindmap.state().cur.aiMemory.membership.a!==Mindmap.state().cur.aiMemory.membership.physics"));
 check('New subchain uses a free source magnet while its mother edge stays fixed',await ev("(()=>{const m=Mindmap.state().cur,e=m.edges.find(e=>e.label==='提问');return e.from.node==='a' && e.from.side==='s' && m.edges.find(e=>e.id==='mother-edge').from.side==='e'})()"));
 await ev("MMAI.openTurn(Mindmap.state().cur.aiMemory.turns[0].id)");await sleep(70);
 await send('Emulation.setDeviceMetricsOverride',{width:1520,height:980,deviceScaleFactor:1,mobile:false});
 await ev("if(document.getElementById('mmMediaToggle')?.getAttribute('aria-expanded')==='true')document.getElementById('mmMediaToggle').click();const hnd=document.querySelector('.mm-ai-resizer');hnd.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));for(let i=0;i<10;i++)hnd.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));const all=[...Mindmap.state().L.nodes.values()],x=Math.min(...all.map(n=>n.x)),y=Math.min(...all.map(n=>n.y)),w=Math.max(...all.map(n=>n.x+n.w))-x,h=Math.max(...all.map(n=>n.y+n.h))-y,v=document.getElementById('mmView').getBoundingClientRect();Mindmap.zoom(Math.min(.8,(v.width-100)/w,(v.height-130)/h));Mindmap.revealBox({x,y,w,h});MMAI.openTurn(Mindmap.state().cur.aiMemory.turns[0].id);");await sleep(100);
 const workflowShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(project,'tmp','workflow-preview.png'),Buffer.from(workflowShot.data,'base64'));
 await send('Emulation.clearDeviceMetricsOverride');
 await ev("document.getElementById('mmAIDirection').value='只给直观解释，保留当前符号';document.getElementById('mmAIReferenceScope').value='tree'");await complete('解释导数与极限定义');
 const scoped=JSON.parse(planned.at(-1).messages.at(-1).content);
 check('Direction override and current-tree scope affect the actual role request',scoped.direction==='只给直观解释，保留当前符号' && scoped.scope==='tree' && scoped.sources.every(s=>s.id!=='physics') && received.at(-1).messages.at(-2).content.includes('只给直观解释'));
 const beforePlanStop=received.length;await ask('PLANWAIT 在关联阶段停止');await wait("document.querySelector('.mm-ai-workflow.is-running .mm-wf-stage.running')?.textContent.includes('关联与定向')");await ev("document.getElementById('mmAIStop').click()");await sleep(150);
 check('Stopping during association never starts the answer role and stops all stage animation',received.length===beforePlanStop && await ev("!document.getElementById('mmAISend').disabled && !document.querySelector('.mm-ai-workflow.is-running') && [...document.querySelectorAll('.assistant')].at(-1).textContent.includes('关联已停止')"));
 await complete('PLANFAIL 关联不可用时继续');
 check('Planning failure shows an explicit fallback while preserving a usable answer',await ev("Mindmap.state().cur.aiMemory.turns.at(-1).workflow.planningStatus==='fallback' && [...document.querySelectorAll('.assistant')].at(-1).textContent.includes('关联分析暂不可用') && Mindmap.state().cur.aiMemory.turns.at(-1).status==='completed'"));
 await ev(fixture('limit-map'));await ev("MMAI.open('a')");await complete('PLANWIRE 关联包装较大');
 check('Large planner envelopes do not stop a short plan or its canvas answer',await ev("(()=>{const t=Mindmap.state().cur.aiMemory.turns.at(-1);return t.status==='completed' && t.workflow.planningStatus==='completed' && t.transfer.planning.transportBytes>256*1024 && t.transfer.planning.answerBytes<5000 && t.generatedIds.length>0})()"));
 const limitCalls={planning:planned.length,answer:received.length};await complete('PLANHUGE 关联正文异常时沿当前路径回答');
 check('Oversized planner body shows fallback and answers once without a stopped warning',planned.length===limitCalls.planning+1 && received.length===limitCalls.answer+1 && await ev("(()=>{const t=Mindmap.state().cur.aiMemory.turns.at(-1),el=[...document.querySelectorAll('.assistant')].at(-1);return t.status==='completed' && t.workflow.planningStatus==='fallback' && t.workflow.sources.every(s=>['current','ancestor'].includes(s.kind)) && el.textContent.includes('关联分析暂不可用') && !el.textContent.includes('已停止')})()"));
 await complete('ANSWERWIRE 回答流式包装较大');
 check('Large answer envelopes render complete nodes and store separate byte counts',await ev("(()=>{const t=Mindmap.state().cur.aiMemory.turns.at(-1);return t.status==='completed' && t.nodeCount===5 && t.transfer.answer.transportBytes>6*1024*1024 && t.transfer.answer.answerBytes<10000})()"));
 await ev("MMFiles.save()");await ev("Mindmap.open('limit-map')");await ev("MMAI.open('a')");
 check('Numeric diagnostics survive save and reopen without saving reasoning text',await ev("(()=>{const m=Mindmap.state().cur,t=m.aiMemory.turns.at(-1);return t.transfer.answer.transportBytes>6*1024*1024 && Object.values(t.transfer).every(s=>Object.values(s).every(Number.isFinite)) && !JSON.stringify(m).includes('fake private reasoning')})()"));
 await ev(`(async()=>{await Mindmap.openDocument({id:'legacy-history',title:'旧历史迁移',v:3,flat:true,nodes:[{id:'old1',text:'旧节点一',children:[]},{id:'old2',text:'旧节点二',children:[]}],pos:{old1:{x:0,y:0},old2:{x:400,y:0}},edges:[{id:'old-edge',from:{node:'old1',side:'e'},to:{node:'old2',side:'w'},dir:'fwd'}]});localStorage.setItem('mm_ai_v1_legacy-history_old1',JSON.stringify([{role:'user',content:'旧问题一'},{role:'assistant',content:'旧回答一',turn:1}]));localStorage.setItem('mm_ai_v1_legacy-history_old2',JSON.stringify([{role:'user',content:'旧问题二'},{role:'assistant',content:'旧回答二',turn:1}]));MMAI.open('old1');})()`);
 check('Legacy node histories migrate into one portable tree record without deleting originals',await ev("Mindmap.state().cur.aiMemory.turns.length===2 && document.querySelectorAll('.mm-ai-message.user').length===2 && !!localStorage.getItem('mm_ai_v1_legacy-history_old2')"));
 await ev("MMAI.open('old2');MMFiles.save()");
 check('Reopening cannot duplicate migrated records and saved files contain the merged history',await ev("(async()=>{const m=await(await fetch('/api/maps/legacy-history')).json();return m.aiMemory.turns.length===2 && m.aiMemory.turns.every(t=>t.legacy)})()"));
 const pdfTest=await import('./verify-pdf-titlebar.mjs');await pdfTest.run({ev,send,sleep,mouse,check,writeFileSync,project});
 await ev("MMAI.open(__pdfID)");await complete('只看第1、3页，解释这些页面');
 const parts=received.at(-1).messages.at(-1).content;
 check('PDF questions still send selected page images and page labels',Array.isArray(parts) && parts.filter(p=>p.type==='image_url').length===2 && parts.some(p=>p.type==='text' && p.text.includes('PDF第3页')));
 await complete('只看第7页到第8页，解释这些页面');
 check('Explicit natural-language ranges can include pages beyond six',received.at(-1).messages.at(-1).content.filter(p=>p.type==='image_url').length===2 && received.at(-1).messages.at(-1).content.some(p=>p.text==='以下图片为PDF第8页。'));
 const beforeInvalid=received.length;await complete('只看第9页');
 check('Out-of-range page instructions report the error without calling the model',received.length===beforeInvalid && await ev("document.getElementById('mmAIStatus').textContent.includes('页码超出范围')"));
 const preparationStopped=await ev("(async()=>{const m=Mindmap.state().cur,n=m.nodes.find(n=>n.id===__pdfID),c=new AbortController();try{await MMAIMedia.prepare({kind:'pdf',mapId:m.id,id:n.pdf,name:'test.pdf'},c.signal,t=>{if(t.includes('2/8'))c.abort()});return false}catch(e){return c.signal.aborted && e.name==='AbortError'}})()");
 check('Reading a whole PDF can be cancelled before starting a model request',preparationStopped && received.length===beforeInvalid);
 await complete('为第五题解答写出详细步骤');
 const allParts=received.at(-1).messages.at(-1).content;
 check('Default PDF question reads all eight real pages and keeps problem numbers separate',allParts.filter(p=>p.type==='image_url').length===8 && allParts.some(p=>p.text==='以下图片为PDF第8页。') && allParts[0].text.includes('第8页：') && await ev("Mindmap.state().cur.aiMemory.turns.at(-1).attachment.includes('全部 8 页') && Mindmap.state().cur.aiMemory.turns.at(-1).status==='completed'"));
 await send('Emulation.setDeviceMetricsOverride',{width:1520,height:980,deviceScaleFactor:1,mobile:false});await sleep(100);
 const attachmentShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(project,'tmp','attachment-layout-preview.png'),Buffer.from(attachmentShot.data,'base64'));
 check('No uncaught browser errors',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const bad=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-bad.length} passed / ${bad.length} failed`);code=bad.length?1:0;
}catch(e){console.error(e);try{console.log(await ev("document.getElementById('mmAIStatus').textContent"));console.log(await ev('__uiErrors'));}catch{}}
finally{
 try{if(ws)await send('Browser.close');}catch{}await sleep(300);try{child?.kill();}catch{}
 for(const s of sockets)s.destroy();mock.close();
 if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
 const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('ai-direct-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}
}
process.exit(code);

