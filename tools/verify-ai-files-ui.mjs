#!/usr/bin/env node
// Current workflow delegates to the semantic PDF suite. --legacy-v1 retains the old page-batch fixture.
if(!process.argv.includes('--legacy-v1')){
  const {spawn:launchSemantic}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),semanticPath=await import('node:path');
  const args=process.argv.slice(2),at=args.indexOf('--project'),inline=args.find(a=>a.startsWith('--project='));
  const project=at>=0?args[at+1]:inline?inline.slice('--project='.length):semanticPath.resolve(semanticPath.dirname(fileURLToPath(import.meta.url)),'..');
  const target=semanticPath.join(project,'tools','verify-lecture-semantics-ui.cjs');
  const child=launchSemantic(process.execPath,[target,...args],{cwd:project,env:process.env,windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});process.exit(code??1);
}
/* 多PDF课件生成导图与提示词调查浏览器验证。使用独立端口、随机临时导图与假API配置、临时浏览器资料；
 * 不读取个人导图或真实密钥。需要本机Edge/Chrome与Node>=22。
 * node tools/verify-ai-files-ui.mjs --port 8897 --project <项目路径>
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
const project=argOf('project',process.cwd()),require=createRequire(path.join(project,'package.json')),base=path.resolve(argOf('artifacts',path.join(project,'tmp')));fs.mkdirSync(base,{recursive:true});
const temp=fs.mkdtempSync(path.join(base,'file-browser-')),received=[],sockets=new Set();let slow=false,badNext=false,mathMode=null;const mathCalls=[];
const {makePlan}=require('./tools/structure-review-fixture.cjs');const structureCalls=[];
const {createPDF}=require('./tools/pdf-fixture.cjs');fs.mkdirSync(path.join(temp,'one'));fs.mkdirSync(path.join(temp,'two'));
const one=path.join(temp,'one','同名讲义.pdf'),two=path.join(temp,'two','同名讲义.pdf'),scan=path.join(temp,'扫描讲义.pdf');fs.writeFileSync(one,createPDF(10));fs.writeFileSync(two,createPDF(3));fs.writeFileSync(scan,createPDF(1).toString().replace(/stream\n([\s\S]*?)\nendstream/g,(_,s)=>'stream\n'+' '.repeat(s.length)+'\nendstream'));
const mock=http.createServer(async(req,res)=>{
 let body='';for await(const b of req)body+=b;const data=JSON.parse(body);
 if(data.messages[0].content.includes('你是整图结构复核员')){structureCalls.push(data);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(makePlan(JSON.parse(data.messages.at(-1).content)))},finish_reason:'stop'}]}));return;}
 if(data.messages[0].content.includes('你是数学排版复核员')){
   mathCalls.push(data);if(mathMode==='failure'){res.writeHead(503);res.end('{}');return;}
   const patches=['(x_k,y_k,z_k)','m_k','k=1,2,\\cdots,n','\\sum x_k m_k','n'].map(expression=>({nodeId:'n1',field:'text',expression,display:false,reason:'补充行内公式定界'}));
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({patches})},finish_reason:'stop'}]}));return;
 }
 const last=data.messages.at(-1).content,text=Array.isArray(last)?last[0].text:last,input=JSON.parse(text.split('\n\n附带')[0]);received.push({data,input});
 const refs=input.stage==='extract'?input.pages.map(p=>({documentId:p.documentId,page:p.page})):input.fragments.flatMap(f=>f.nodes.flatMap(n=>n.citations));const citations=[...new Map(refs.map(r=>[r.documentId+':'+r.page,r])).values()];
 const graph={edges:[{from:'n1',to:'n2',kind:'relation',label:'适用条件'}],nodes:[{id:'n1',title:input.stage==='extract'?'章节主题':'跨讲义共同主题',origin:'source',citations:[citations[0]],blocks:[{type:'text',text:'从本批资料理解定义与条件。'},{type:'math',latex:'f(x)=x^2'}]},{id:'n2',title:'条件与应用',text:'保留各讲义中的适用条件与差异。',origin:'source',citations:[citations.at(-1)]}]};
 if(input.stage==='extract')for(let i=3;i<=12;i++){graph.nodes.push({id:'n'+i,title:'章节知识点'+i,text:'保留本批讲义中的知识条件与学习要点。',origin:'source',citations:[citations[(i-1)%citations.length]]});graph.edges.push({from:'n1',to:'n'+i,kind:'hierarchy',label:''});}
 for(const n of graph.nodes)n.brief='理解本主题的定义、条件及其应用关系。';
 for(const n of graph.nodes.slice(1)){const i=Number(n.id.slice(1));n.topic=['基础概念','适用条件','典型应用'][i%3];n.parentId=i===6?'n3':'n1';}
 if(mathMode)graph.nodes[0].blocks[0].text='设有 n 个质点，坐标为 (x_k,y_k,z_k)，质量为 m_k，指标 k=1,2,\\cdots,n。分子 \\sum x_k m_k 是静矩。';
 if(badNext){badNext=false;graph.nodes[1].citations=[{documentId:'invented-doc',page:999}];}
 const content=JSON.stringify(graph);res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(let i=0;i<content.length;i+=100){if(res.destroyed)return;res.write('data: '+JSON.stringify({choices:[{delta:{content:content.slice(i,i+100)}}]})+'\n\n');await sleep(slow?300:30);}
 res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
process.env.MM_PORT=PORT;process.env.MM_STORAGE_DIR=path.join(temp,'maps');process.env.MM_AI_CONFIG_FILE=path.join(temp,'ai.json');
const profiles=Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'',model:'',apiKey:''}]));profiles.custom={baseURL:'http://127.0.0.1:'+mock.address().port,model:'fake-file-model',apiKey:'fake-file-secret'};const config=JSON.stringify({version:1,activeProvider:'custom',profiles});fs.writeFileSync(process.env.MM_AI_CONFIG_FILE,config);
const wait=async expression=>{for(let i=0;i<350;i++){if(await ev(expression))return;await sleep(60);}throw Error('UI timeout: '+expression);};
const files=async paths=>{const {root}=await send('DOM.getDocument'),{nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'#mmLecturePicker'});await send('DOM.setFileInputFiles',{nodeId,files:paths});await wait("document.querySelectorAll('.mm-lecture-file').length>0 && [...document.querySelectorAll('.mm-lecture-file small')].every(e=>!e.textContent.includes('读取页数'))");};
const openFiles=async()=>{await ev("MMAIOutline.open(!!Mindmap.state().cur);document.getElementById('mmOutlineInputSource').value='files';document.getElementById('mmOutlineInputSource').dispatchEvent(new Event('change'))");};
const submit=()=>clickSel('#mmOutlineGenerate');
const finished=()=>wait("Mindmap.state().cur?.outlineSources?.at(-1)?.mode==='lecture' && ['completed','partial','failed','stopped'].includes(Mindmap.state().cur.outlineSources.at(-1).status) && !MMAILecture.running");
const undo=async()=>{await ev("document.getElementById('mmView').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});};
let code=1;
try{
 await import(pathToFileURL(path.join(project,'server.js')));await openBrowser();await wait('!!window.MMAILecture && !!window.MMAIInspector && !!window.MMFiles');
 await ev("window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(e.message));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason)))");
 await clickSel('#mmAIInspectButton');await wait("document.querySelectorAll('[data-prompt-templates] textarea').length===9");
 check('Global investigation entry exposes nine centralized read-only prompt templates',await ev("[...document.querySelectorAll('[data-prompt-templates] textarea')].every(e=>e.readOnly) && document.getElementById('mmDlgBody').textContent.includes('prompts/lecture-extract.md')"));await clickSel('[data-mm="dclose"]');
 await openFiles();await files([one,two]);
 check('Multiple identically named PDFs show individual page counts and explicit embed-to-map controls',await ev("document.querySelectorAll('.mm-lecture-file').length===2 && [...document.querySelectorAll('.mm-lecture-file small')].some(e=>e.textContent.includes('10 页')) && document.querySelectorAll('[data-lecture-embed]').length===2 && document.getElementById('mmLectureBox').textContent.includes('嵌入到导图')"));
 const originalOrder=await ev("[...document.querySelectorAll('[data-lecture-embed]')].map(e=>e.dataset.lectureEmbed).join(',')");await clickSel('[data-lecture-move][data-offset="1"]');check('Reordering preserves distinct document identities and changes processing order',await ev("[...document.querySelectorAll('[data-lecture-embed]')].map(e=>e.dataset.lectureEmbed).join(',')")!==originalOrder);await clickSel('[data-lecture-move][data-offset="1"]');
 const formShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'file-import-preview.png'),Buffer.from(formShot.data,'base64'));
 await clickSel('[data-lecture-all="0"]');check('Bulk clearing only changes embedding choices, not the selected files',await ev("document.querySelectorAll('.mm-lecture-file').length===2 && [...document.querySelectorAll('[data-lecture-embed]')].every(e=>!e.checked)"));await clickSel('[data-lecture-all="1"]');await clickSel('[data-lecture-embed]');
 await ev("document.getElementById('mmOutlineTitle').value='多讲义分支测试'");await submit();await wait("Mindmap.state().cur?.nodes.some(n=>n.pdf) && MMAILecture.running");
 check('Selected original PDF appears on the main canvas while reading is still in progress',await ev("Mindmap.state().cur.nodes.filter(n=>n.pdf).length===1"));await finished();
 check('Successful lecture generation runs the shared whole-map review after extraction',structureCalls.length===1 && await ev("Mindmap.state().cur.outlineSources.at(-1).structureReview.status==='completed' && Object.keys(Mindmap.state().cur.structures).length===1"));
 check('Every page of both documents is processed, including pages beyond six',await ev("(()=>{const r=Mindmap.state().cur.outlineSources.at(-1);return r.status==='completed' && r.documents[0].processedPages.length===10 && r.documents[1].processedPages.length===3 && r.documents.every(d=>d.status==='completed')})()"));
 check('Completed lecture removes procedural root and file-description nodes while retaining all actual knowledge',await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1);return !m.nodes.some(n=>MMLectureCleanup.placeholder(n)) && r.generatedIds.every(id=>m.nodes.some(n=>n.id===id)) && m.nodes.filter(n=>n.citations?.length).length>40 && m.edges.every(e=>m.nodes.some(n=>n.id===e.from.node)&&m.nodes.some(n=>n.id===e.to.node))})()"));
 check('Completed lecture themes have editable spatial bottom frames',await ev("Mindmap.state().cur.groups.length===3 && document.querySelectorAll('.mm-group-label').length===3 && Mindmap.state().cur.groups.every(g=>!!g.topicKey && MMGroups.members(g).nodes.length>0)"));
 check('Same filenames retain distinct source identities and only the checked PDF is saved',await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1);return r.documents[0].id!==r.documents[1].id && !r.documents[0].mediaId && !!r.documents[1].mediaId && m.media.length===1 && m.nodes.filter(n=>n.pdf).length===1})()"));
 check('Branch generation exceeds forty total knowledge nodes while retaining per-request validation',received.filter(c=>c.input.stage==='extract').length>=4 && await ev("Mindmap.state().cur.nodes.filter(n=>n.citations?.length).length>40"));
 check('Real PDF output retains topic names across batches and remaps every hierarchy parent to a canvas ID',await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1),nodes=m.nodes.filter(n=>n.topic);return nodes.length>20 && m.topicGroups.length===3 && new Set(m.topicGroups.map(g=>g.title)).size===3 && nodes.every(n=>n.topicScope===r.id && (!n.layoutParent || m.nodes.some(p=>p.id===n.layoutParent))) && nodes.some(n=>m.topicLevels[n.id]===1)})()"));
 check('PDF generation preserves same-response plain-language briefs through streaming, review and save',await ev("Mindmap.state().cur.nodes.filter(n=>n.topic).every(n=>n.brief==='理解本主题的定义、条件及其应用关系。')"));
 check('Subsequent PDF batches receive only stable topic-name hints from earlier results',received.filter(r=>r.input.stage==='extract').slice(1).some(r=>r.input.topicHints?.includes('基础概念') && r.input.topicHints.includes('典型应用')));
 check('File requests reuse the configured model and contain no unrelated conversation',received.every(c=>c.data.model==='fake-file-model' && c.data.stream && c.data.messages.length===2 && c.input.pages?.length));
 await ev("window.__fileMap=Mindmap.state().cur.id;window.__recordId=Mindmap.state().cur.outlineSources.at(-1).id;window.__fileNodeCount=Mindmap.state().cur.nodes.length;window.__notEmbedded=Mindmap.state().cur.nodes.find(n=>n.citations?.some(c=>c.documentId===Mindmap.state().cur.outlineSources.at(-1).documents[0].id)).id;MMAIInspector.sources(__notEmbedded)");
 check('Unembedded source shows filename and page without a broken original-file link',await ev("document.getElementById('mmDlgBody').textContent.includes('仅保留出处信息') && !document.querySelector('[data-source-pdf]')"));await clickSel('[data-mm="dclose"]');
 await ev("(()=>{const m=Mindmap.state().cur,d=m.outlineSources.at(-1).documents[1],n=m.nodes.find(n=>n.citations?.some(c=>c.documentId===d.id&&c.page===3));MMAIInspector.sources(n.id)})()");await clickSel('[data-source-pdf]');await wait("Mindmap.state().cur.pdfViews?.[Mindmap.state().cur.outlineSources.at(-1).documents[1].pdfNodeId]?.page===3");
 check('Embedded citation navigates the actual PDF reader to its cited page',await ev("(()=>{const d=Mindmap.state().cur.outlineSources.at(-1).documents[1];return MMPDF.isActive(d.pdfNodeId) && Mindmap.state().cur.pdfViews[d.pdfNodeId].page===3})()"));await ev('MMPDF.close()');
 await ev("Mindmap.selectNodes([__notEmbedded]);Mindmap.revealBox(Mindmap.state().L.nodes.get(__notEmbedded))");await sleep(250);
 const dragId=await ev('__notEmbedded'),dragPoint=await rectOf('.mm-node[data-id="'+dragId+'"]');const dragBefore=await ev('JSON.stringify(Mindmap.state().cur.pos[__notEmbedded])');await mouse('mousePressed',dragPoint.x,dragPoint.y,1,1);for(let i=1;i<=15;i++)await mouse('mouseMoved',dragPoint.x+i*3,dragPoint.y+i*2,0,1);await mouse('mouseReleased',dragPoint.x+45,dragPoint.y+30,1,0);
 check('Actual repeated drag redraw keeps exactly one unwrapped citation button per node',await ev("(()=>{const m=Mindmap.state().cur,buttons=[...document.querySelectorAll('.mm-node-citations')],b=buttons.find(e=>e.dataset.nodeCitations===__notEmbedded);return JSON.stringify(m.pos[__notEmbedded])!=="+JSON.stringify(dragBefore)+" && buttons.length===m.nodes.filter(n=>n.citations?.length).length && buttons.filter(e=>e.dataset.nodeCitations===__notEmbedded).length===1 && getComputedStyle(b).whiteSpace==='nowrap' && Math.abs(parseFloat(b.style.left)-m.pos[__notEmbedded].x)<1})()"));
 await undo();check('Citation drag undo removes no source controls and restores node position',await ev('JSON.stringify(Mindmap.state().cur.pos[__notEmbedded])==='+JSON.stringify(dragBefore)+" && document.querySelectorAll('.mm-node-citations').length===Mindmap.state().cur.nodes.filter(n=>n.citations?.length).length"));
 await undo();check('The full multi-document generation, including its PDF node, undoes once',await ev('Mindmap.state().cur.nodes.length===0 && Mindmap.state().cur.outlineSources.length===1'));await clickSel('#mmRedo');check('Redo restores the original PDF and every knowledge node',await ev('Mindmap.state().cur.nodes.length===__fileNodeCount && Mindmap.state().cur.nodes.filter(n=>n.pdf).length===1'));
 await ev('MMFiles.save()');await ev('Mindmap.open(__fileMap)');await ev('MMAIOutline.records()');await clickSel('[data-outline-record]');check('General generation-record entry opens lecture investigation with no undefined source',await ev("!!document.querySelector('[data-inspector-runs]') && !document.getElementById('mmDlgBody').textContent.includes('undefined')"));
 check('Saved generation records retain actual effective prompts, inputs, outputs and coverage',await ev("document.querySelectorAll('[data-inspector-runs] details').length>=4 && [...document.querySelectorAll('[data-inspector-runs] textarea')].some(e=>e.value.includes('documentId')) && document.getElementById('mmDlgBody').textContent.includes('已完成页码：1–10')"));
 await ev("document.querySelector('[data-inspector-runs] details').open=true");const successShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'file-success-preview.png'),Buffer.from(successShot.data,'base64'));
 check('PDF generation preserves free relation labels and blank hierarchy through archive and reopen',await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1);return m.edges.some(e=>e.label==='适用条件') && r.runs.some(run=>run.inspection.output?.edges.some(e=>e.label==='适用条件')) && m.edges.some(e=>e.label==='')})()"));
 check('Investigation never stores API credentials or base64 image payloads in the map',await ev("!JSON.stringify(Mindmap.state().cur).includes('fake-file-secret') && !JSON.stringify(Mindmap.state().cur).includes('data:image/')"));await clickSel('[data-mm="dclose"]');await ev('Mindmap.leaveDocument()');
 const beforeFusion=received.length;await openFiles();await ev("document.getElementById('mmLectureStrategy').value='fusion';document.getElementById('mmOutlineTitle').value='主题融合测试'");await submit();await finished();
 check('Fusion reads all chapters before a separate thematic merge request',received.slice(beforeFusion).some(c=>c.input.stage==='merge') && await ev("Mindmap.state().cur.outlineSources.at(-1).strategy==='fusion' && Mindmap.state().cur.outlineSources.at(-1).sections.length>=4"));
 const beforeExpand=received.length,initialCount=await ev('Mindmap.state().cur.nodes.length');await ev("MMAIInspector.openRecord(Mindmap.state().cur.outlineSources.at(-1).id);document.querySelector('[data-expand-section]').closest('details').open=true");await clickSel('[data-expand-section]');
 check('Detailed source chapters expand from retained results without another model call',received.length===beforeExpand && await ev('Mindmap.state().cur.nodes.length>'+initialCount));
 await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');
 badNext=true;await openFiles();await ev("document.getElementById('mmLectureStrategy').value='branches'");await submit();await finished();
 check('A malformed citation fails that file explicitly while other documents can finish',await ev("(()=>{const r=Mindmap.state().cur.outlineSources.at(-1);return r.status==='partial' && r.documents[0].status==='failed' && r.documents[0].error.includes('出处') && r.documents[1].status==='completed'})()"));await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');
 slow=true;await openFiles();await submit();await wait("Mindmap.state().cur?.outlineSources?.at(-1)?.runs[0]?.status==='running'");await clickSel('[data-lecture-stop]');await sleep(500);const stopped=await ev('JSON.stringify(Mindmap.state().cur.nodes)');await sleep(1400);
 check('Stop cancels remaining model work and preserves explicit unfinished page ranges',await ev('JSON.stringify(Mindmap.state().cur.nodes)==='+JSON.stringify(stopped)+" && Mindmap.state().cur.outlineSources.at(-1).status==='stopped' && Mindmap.state().cur.outlineSources.at(-1).documents.some(d=>d.processedPages.length<d.pageCount)"));slow=false;
 await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');slow=true;await openFiles();await submit();await wait("Mindmap.state().cur?.outlineSources?.at(-1)?.runs[0]?.status==='running'");await ev('Mindmap.open(__fileMap)');await sleep(1600);check('Switching maps cancels lecture work and prevents results entering the destination map',await ev('Mindmap.state().cur.id===__fileMap && Mindmap.state().cur.nodes.length===__fileNodeCount && !MMAILecture.running'));slow=false;await ev('Mindmap.leaveDocument()');await openFiles();
 while(await ev("document.querySelectorAll('[data-lecture-remove]').length>0"))await clickSel('[data-lecture-remove]');await files([scan]);await clickSel('[data-lecture-all="0"]');await ev("document.getElementById('mmLectureReading').value='auto'");const beforeScan=received.length;await submit();await finished();
 check('Scanned pages use actual rendered image input through the selected model',received.slice(beforeScan).some(c=>Array.isArray(c.data.messages.at(-1).content) && c.data.messages.at(-1).content.some(p=>p.type==='image_url')));
 await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');await openFiles();await ev("document.getElementById('mmLectureReading').value='text'");const beforeText=received.length;await submit();await finished();
 check('Text-only reading never silently skips a page with no extractable text',received.length===beforeText && await ev("Mindmap.state().cur.outlineSources.at(-1).documents[0].error.includes('没有可提取文字')"));
 await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');await openFiles();await ev("document.getElementById('mmLectureReading').value='auto'");mathMode='repair';const beforeMath=mathCalls.length;await submit();await finished();
 check('Suspect PDF math is reviewed once per batch and renders as inline formulas beside display math',mathCalls.length===beforeMath+1 && await ev("(()=>{const m=Mindmap.state().cur,r=m.outlineSources.at(-1),n=m.nodes.find(n=>n.text.includes('设有'));window.__mathNode=n.id;return r.status==='completed' && n.text.includes('$m_k$') && n.text.includes('$k=1,2,') && !n.mathWarnings?.length && r.runs[0].inspection.mathReview.changes.length===5})()"));
 await ev("Mindmap.zoom(1);Mindmap.selectNodes([__mathNode]);Mindmap.revealBox(Mindmap.state().L.nodes.get(__mathNode))");await sleep(200);check('Actual node DOM preserves inline math and a single explicit display formula',await ev("(()=>{const n=document.querySelector('.mm-node[data-id=\"'+__mathNode+'\"]');return n.querySelectorAll('.katex').length>=6 && n.querySelectorAll('.katex-display').length===1})()"));
 const mathShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'reviewed-inline-math.png'),Buffer.from(mathShot.data,'base64'));await ev("MMAIInspector.openRecord(Mindmap.state().cur.outlineSources.at(-1).id);document.querySelector('[data-inspector-runs] details').open=true");check('Math review prompt, original text and corrections are available for investigation',await ev("[...document.querySelectorAll('textarea')].some(e=>e.value.includes('math-review') && e.value.includes('补充行内公式'))"));await clickSel('[data-mm="dclose"]');
 await ev('MMFiles.save()');await ev('Mindmap.leaveDocument()');await openFiles();mathMode='failure';await submit();await finished();check('Review failure keeps the generated map usable and shows a pending-math button',await ev("Mindmap.state().cur.outlineSources.at(-1).status==='completed' && !!document.querySelector('[data-math-warning]') && Mindmap.state().cur.outlineSources.at(-1).runs[0].inspection.mathReview.status==='failed'"));await ev("(()=>{document.getElementById('mmStage').style.setProperty('transition','none','important');Mindmap.resetScroll();Mindmap.zoom(1);const n=Mindmap.state().cur.nodes.find(n=>n.mathWarnings?.length);window.__pendingMathNode=n.id;const b=Mindmap.state().L.nodes.get(n.id);Mindmap.revealBox({...b,h:b.h+45})})()");await sleep(200);const pendingPoint=await rectOf('[data-math-warning]');await clickAt(pendingPoint.x,pendingPoint.y);await wait("document.getElementById('mmDlg').open");check('Pending math explains unresolved symbols without changing the node',await ev("document.getElementById('mmDlgBody').textContent.includes('已保留原文')"));await clickSel('[data-mm="dclose"]');await ev("Mindmap.editMap(()=>{Mindmap.state().cur.nodes.find(n=>n.id===__pendingMathNode).text='# 质量\\n\\n质量为 $m_k$。'})");check('Manual correction clears the pending-math badge on redraw',await ev("!document.querySelector('[data-math-warning]')"));
 mathMode='repair';await ev("Mindmap.editMap(()=>{Mindmap.state().cur.nodes.find(n=>n.id===__pendingMathNode).text='# 已有节点\\n\\n质量为 m_k。'});window.__manualBefore=Mindmap.findNode(__pendingMathNode).n.text;window.__manualEdges=JSON.stringify(Mindmap.state().cur.edges);window.__manualPos=JSON.stringify(Mindmap.state().cur.pos);Mindmap.selectNodes([__pendingMathNode]);Mindmap.revealBox(Mindmap.state().L.nodes.get(__pendingMathNode))");await sleep(200);
 const manualPoint=await rectOf('.mm-node[data-id="'+await ev('__pendingMathNode')+'"]');await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,clickCount:1,...manualPoint});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,clickCount:1,...manualPoint});await clickSel('[data-mm="node-math-review"]');await wait("document.getElementById('mmMathApply') && !document.getElementById('mmMathApply').disabled");
 check('Existing-node review is discoverable in the context menu and previews without changing the source',await ev("Mindmap.findNode(__pendingMathNode).n.text===__manualBefore && document.getElementById('mmMathAfter').value.includes('$m_k$')"));await clickSel('#mmMathApply');check('Applying existing-node review preserves positions, links and source identity',await ev("Mindmap.findNode(__pendingMathNode).n.text.includes('$m_k$') && JSON.stringify(Mindmap.state().cur.pos)===__manualPos && JSON.stringify(Mindmap.state().cur.edges)===__manualEdges && Mindmap.state().cur.outlineSources.at(-1).applied"));await undo();check('Existing-node math changes undo in one operation',await ev("Mindmap.findNode(__pendingMathNode).n.text===__manualBefore"));
 await ev('MMAIMathReview.open(__pendingMathNode)');await wait("document.getElementById('mmMathApply') && !document.getElementById('mmMathApply').disabled");await ev("Mindmap.editMap(()=>{Mindmap.findNode(__pendingMathNode).n.text='用户随后写入的新内容'})");await clickSel('#mmMathApply');check('A user edit after preview prevents stale math patches from overwriting the node',await ev("Mindmap.findNode(__pendingMathNode).n.text==='用户随后写入的新内容' && document.getElementById('mmMathStatus').textContent.includes('节点已修改')"));await clickSel('[data-mm="dclose"]');mathMode=null;

 check('Shared provider configuration is unchanged',fs.readFileSync(process.env.MM_AI_CONFIG_FILE,'utf8')===config);
 await ev('MMAIInspector.openRecord(Mindmap.state().cur.outlineSources.at(-1).id)');const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'file-investigation-preview.png'),Buffer.from(shot.data,'base64'));await clickSel('[data-mm="dclose"]');await openFiles();
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await sleep(120);check('File import controls fit a phone-width dialog',await ev("(()=>{const r=document.getElementById('mmDlg').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.getElementById('mmLectureBox').getBoundingClientRect().right<=r.right})()"));
 check('No uncaught browser errors or rejected promises',await ev('__uiErrors.length===0'),JSON.stringify(await ev('__uiErrors')));
 const bad=RESULTS.filter(r=>!r.ok);console.log(`${RESULTS.length-bad.length} passed / ${bad.length} failed`);code=bad.length?1:0;
}catch(error){console.error(error);try{const errorShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'math-ui-error.png'),Buffer.from(errorShot.data,'base64'));console.log(await ev('document.querySelector(".mm-lecture-progress p").textContent'));console.log(await ev('JSON.stringify(Mindmap.state().cur?.outlineSources?.at(-1)?.documents)'));console.log(await ev('__uiErrors'));}catch{}}
finally{
 try{if(ws)await send('Browser.close');}catch{}await sleep(300);try{child?.kill();}catch{}
 for(const s of sockets)s.destroy();mock.close();
 if(profile){const p=path.resolve(profile);if(path.dirname(p)===path.resolve(tmpdir()) && path.basename(p).startsWith('mm-verify-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}}
 const p=path.resolve(temp);if(path.dirname(p)===path.resolve(base) && path.basename(p).startsWith('file-browser-'))try{fs.rmSync(p,{recursive:true,force:true});}catch{}
}
process.exit(code);
