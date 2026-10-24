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
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await wait('!!window.MMAI && !!window.MMAIUsage && !!window.MMWorkspace');
 await ev("window.__usageErrors=[];addEventListener('error',e=>__usageErrors.push(e.message));addEventListener('unhandledrejection',e=>__usageErrors.push(String(e.reason)))");
 await ev("MMWorkspace.open('browser-a')");await wait("Mindmap.state().cur?.id==='browser-a'");
 await ev(`(()=>{
   const original=window.fetch.bind(window),jobs=new Map();window.__usageRequests=[];
   const reply=x=>Promise.resolve(new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}}));
   window.fetch=(url,opts={})=>{
     if(url==='/api/ai/status')return reply({available:true,model:'模拟验收模型',maxOutputTokens:32768});
     if(url==='/api/ai/chat'&&opts.method==='POST'){const payload=JSON.parse(opts.body);jobs.set(payload.requestId,{payload,began:Date.now()});__usageRequests.push(payload);return reply({job:payload.requestId,status:'running',stage:'准备生成'});}
     const match=typeof url==='string'&&new RegExp('^/api/ai/jobs/([A-Za-z0-9_-]+)$').exec(url);
     if(match){if(opts.method==='DELETE')return reply({status:'cancelled'});const j=jobs.get(match[1]);if(!j)return reply({status:'failed',error:'unknown mock'});const id=match[1],age=Date.now()-j.began,finished=age>1300;
       const stat=(suffix,prompt,hit,out)=>({callId:id+suffix,startedAt:j.began+(suffix==='answer'?1:0),updatedAt:Date.now(),answerBytes:finished?1600:200,transportBytes:2000,answerLimitBytes:MMCapacity.answerBytes,maxOutputTokens:32768,completionState:finished?'completed':'running',...(finished?{promptTokens:prompt,cacheHitTokens:hit,cacheMissTokens:prompt-hit,completionTokens:out}:{})});
       const a=stat('answer',2400,1800,350),b=stat('planning',600,400,50),calls=j.payload.mode==='graph'?[b,a]:[a];
       if(j.payload.mode==='structure-review'){return reply({job:id,status:finished?'completed':'running',stage:'检查模块顺序',calls,inspection:{structureReview:{status:finished?'failed':'running',note:'模拟复核，不改写正文',stages:[{inspection:{transfer:a}}]}},...(finished?{structureReview:{status:'failed',note:'模拟复核，不改写正文',stages:[{inspection:{transfer:a}}]}}:{})});}
       const doc=j.payload.fileTask?.documents?.[0],graph={nodes:[{id:'n1',title:'核心概念',text:'梳理对象、定义与适用条件，再用例子检查理解。',brief:'明确对象和条件',...(doc?{origin:'source',citations:[{documentId:doc.id,page:1}]}:{})},{id:'n2',title:'联系与应用',text:'比较概念的联系，按条件选择方法，再检查结果。',brief:'联系概念并应用',parentId:'n1',...(doc?{origin:'source',citations:[{documentId:doc.id,page:2}]}:{})}],edges:[{from:'n1',to:'n2',kind:'hierarchy',label:''}]};
       return reply({job:id,status:finished?'completed':'running',stage:'正在整理知识内容',calls,transfer:{answer:a,...(j.payload.mode==='graph'?{planning:b}:{})},inspection:{promptId:'node-graph',model:'模拟验收模型',system:'模拟提示词',input:[],transfer:a},...(age>350?{graph}:{}),...(finished?{summary:graph}:{})});
     }
     return original(url,opts);
   };
 })()`);
 await ev("MMAI.open('browser-a-root');document.getElementById('mmAIInput').value='解释概念之间的联系';document.getElementById('mmAIForm').requestSubmit()");await wait("!!document.querySelector('#mmAIUsage .mm-ai-usage')");
 check('Node question usage starts expanded',await ev("document.querySelector('#mmAIUsage details').open"));
 check('Before the provider reports tokens, counters display waiting rather than invented usage',await ev("document.getElementById('mmAIUsage').textContent.includes('等待平台统计')"));
 await ev("document.querySelector('#mmAIUsage details').open=false");await sleep(300);check('Node question manual collapse survives polling',await ev("!document.querySelector('#mmAIUsage details').open"));
 await ev("document.querySelector('#mmAIUsage details').open=true");await wait("!document.getElementById('mmAISend').disabled");
 check('Question uses exact role totals, input cache metrics and updated capacities',await ev("(()=>{const t=document.getElementById('mmAIUsage').textContent;return t.includes('输入 3,000')&&t.includes('输出 400')&&t.includes('2,200')&&t.includes('32.00 MiB')&&t.includes('512.00 MiB')})()"));
 check('The question records both calls for later inspection',await ev("Mindmap.state().cur.aiMemory.turns.at(-1).calls.length===2"));
 {const r=await ev("(()=>{const r=document.getElementById('mmAI').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");const shot=await send('Page.captureScreenshot',{format:'png',clip:r});fs.writeFileSync(path.join(artifacts,'usage-node-sidebar.png'),Buffer.from(shot.data,'base64'));}
 {const r=await ev("(()=>{const r=document.querySelector('#mmAIUsage details').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");const shot=await send('Page.captureScreenshot',{format:'png',clip:r});fs.writeFileSync(path.join(artifacts,'usage-statistics.png'),Buffer.from(shot.data,'base64'));}
 await ev("MMAI.close();MMAIInspector.openRecord(Mindmap.state().cur.aiMemory.turns.at(-1).id)");
 check('Inspector reconstructs the task totals from its saved call ledger',await ev("document.getElementById('mmDlgBody').textContent.includes('输入 3,000')&&document.querySelector('#mmDlgBody .mm-ai-usage').open"));await ev("document.getElementById('mmDlg').close()");
 await ev("MMPDFSource.metadata=async()=>2;MMPDFSource.batches=async function*(entry){yield{pages:[{page:1,part:1,parts:1,text:'第一部分'},{page:2,part:1,parts:1,text:'第二部分'}],images:[]}};MMAIOutline.open(true,'files')");
 await wait("!!document.getElementById('mmLecturePicker')");await ev("(()=>{const picker=document.getElementById('mmLecturePicker'),dt=new DataTransfer();dt.items.add(new File(['%PDF-fake'],'模拟讲义.pdf',{type:'application/pdf'}));picker.files=dt.files;picker.dispatchEvent(new Event('change'))})()");await wait("!!document.querySelector('[data-lecture-embed]')");
 await ev("document.querySelector('[data-lecture-embed]').checked=false;document.querySelector('[data-lecture-embed]').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('mmOutlineGenerate').click()");await wait("MMAILecture.running && !!document.querySelector('.mm-lecture-progress .mm-ai-usage')");
 check('Lecture generation also starts with expanded usage details',await ev("document.querySelector('.mm-lecture-progress .mm-ai-usage').open"));await wait("!MMAILecture.running");
 check('Lecture totals include extraction and structure review once each',await ev("(()=>{const t=document.querySelector('.mm-lecture-progress .mm-ai-usage').textContent;return t.includes('2 次模型响应')&&t.includes('输入 4,800')&&t.includes('输出 700')&&t.includes('2 / 2 页已整理')})()"));
 check('Lecture saves its call ledger and complete page coverage',await ev("(()=>{const r=Mindmap.state().cur.outlineSources.at(-1);return r.mode==='lecture'&&r.runs[0].calls.length===1&&r.documents[0].processedPages.length===2})()"));
 {const clip=await ev("(()=>{const r=document.querySelector('.mm-lecture-progress').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");const shot=await send('Page.captureScreenshot',{format:'png',clip});fs.writeFileSync(path.join(artifacts,'usage-lecture-panel.png'),Buffer.from(shot.data,'base64'));}
 check('No browser errors occurred in either complete generation workflow',await ev('__usageErrors.length===0'));
 const failures=RESULTS.filter(r=>!r.ok);console.log(RESULTS.length-failures.length+' usage browser checks passed / '+failures.length+' failed');code=failures.length?1:0;
}catch(e){console.error(e);try{console.log(await ev('__usageErrors'));}catch{}}
finally{try{if(ws)await send('Browser.close');}catch{}await sleep(200);try{child?.kill();}catch{}if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}const p=path.resolve(testdir);if(path.dirname(p)===path.resolve(tmpdir())&&path.basename(p).startsWith('mm-workspace-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
process.exit(code);
