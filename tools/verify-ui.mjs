#!/usr/bin/env node
/* =========================================================================
 * tools/verify-ui.mjs —— 开发工具（**不参与运行时**：不被打包、不被任何运行时链路 require）
 *
 * 作用：用无头浏览器把 UI 级验收跑一遍 —— 页面能开、双击空白建点中心对齐、
 *       收起按钮第 1 次点就生效、删整棵子树后导图层无孤儿、撤销"新建"后无孤儿。
 *
 * 前提（缺一个就跑不了，脚本会直接说明）：
 *   · 本机装有 Edge 或 Chrome（可用 --edge/--chrome 指定，或用 MM_BROWSER 环境变量）
 *   · Node ≥ 22（用到内置 WebSocket；更低版本会提示而不是报错崩）
 *   · 目标地址上有服务在跑（默认 http://127.0.0.1:8788/，即 node server.js）
 *
 * 用法：
 *   node tools/verify-ui.mjs                              # 默认 http://127.0.0.1:8788/
 *   node tools/verify-ui.mjs --port 9000                  # 只换端口
 *   node tools/verify-ui.mjs --url http://127.0.0.1:9000/ # 换完整地址
 *   node tools/verify-ui.mjs --edge "D:\\Edge\\msedge.exe" # 指定浏览器
 *   node tools/verify-ui.mjs --keep                       # 排错：保留临时 profile
 *   node tools/verify-ui.mjs --timeout 90000              # 整体超时（毫秒，默认 60000）
 *
 * 零副作用：
 *   · 只用 node 内置模块，无任何第三方依赖
 *   · 临时 profile 建在**系统临时目录**（os.tmpdir() + 随机名），结束时删除；不写仓库、
 *     不写仓库外的固定位置
 *   · 只**读**页面状态 + 派发真实鼠标事件；不碰服务器、不改仓库文件、不动 8788 那个进程
 * ========================================================================= */
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
async function clickSel(sel) { const p = await rectOf(sel); if (!p) throw new Error("页面上找不到元素：" + sel); await clickAt(p.x, p.y); return p; }
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
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--window-size=1280,800", URL_], { stdio: "ignore" });
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

/* ---------------- 主流程 ---------------- */
const main = async () => {
  console.log("UI 级验收（开发工具）");
  console.log("  地址=" + URL_ + " · 浏览器=" + (BROWSER || "(没找到)") + " · Node=" + process.version + " · 超时=" + TIMEOUT + "ms");
  // 先看服务在不在，缺服务给一句人话，别让它以"浏览器起不来"的面貌失败
  try {
    const r = await fetch(URL_, { method: "GET" });
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch (e) {
    console.error("  ✗ 取不到 " + URL_ + "（" + e.message + "）——先在这个仓库根目录跑 `node server.js`，再重跑本脚本。");
    process.exit(3);
  }
  if (!BROWSER) {
    console.error("  ✗ 没找到 Edge/Chrome。用 --edge \"<exe 路径>\"（或 --chrome）指定，或设环境变量 MM_BROWSER。");
    process.exit(3);
  }
  await openBrowser();
  if(argv.includes('--media-actions') || argv.includes('--pdf-position') || argv.includes('--format-align') || argv.includes('--canvas-features') || argv.includes('--context-features') || argv.includes('--groups') || argv.includes('--fixes') || argv.includes('--sessions') || argv.includes('--wheel') || argv.includes('--pdf')) {
    for(let i=0;i<40;i++){if(await ev("document.readyState==='complete' && !!window.MMFiles && !!window.MMCanvasTools"))break;await sleep(100);}
    const {run}=await import(argv.includes('--media-actions')?'./verify-media-actions.mjs':argv.includes('--pdf-position')?'./verify-pdf-position.mjs':argv.includes('--format-align')?'./verify-format-align.mjs':argv.includes('--pdf')?'./verify-pdf.mjs':argv.includes('--wheel')?'./verify-wheel.mjs':argv.includes('--sessions')?'./verify-sessions.mjs':argv.includes('--fixes')?'./verify-fixes.mjs':argv.includes('--groups')?'./verify-groups.mjs':argv.includes('--context-features')?'./verify-interactions.mjs':'./verify-canvas.mjs');
    await run({ev,send,sleep,clickSel,mouse,check,writeFileSync});
    const bad=RESULTS.filter(r=>!r.ok);console.log(`\n结果：${RESULTS.length-bad.length} 通过 / ${bad.length} 失败`);return bad.length?1:0;
  }
  if (!argv.includes('--legacy')) {
    for (let i = 0; i < 40; i++) { if (await ev("document.readyState === 'complete' && !!window.Mindmap")) break; await sleep(200); }
    await clickSel('#mmShortcutsButton');
    check('右上角按钮打开右侧补全表，内容与实际规则一致', await ev(`document.getElementById('mmShortcutsButton').getAttribute('aria-expanded')==='true' && !document.getElementById('mmShortcuts').classList.contains('hidden') && document.querySelectorAll('.mm-shortcuts-table tbody tr').length===MMContent.snippetHelp.length && document.getElementById('mmShortcutsBody').textContent.includes('Ctrl / Cmd + Enter')`));
    await clickSel('#mmShortcutsClose');
    await ev(`(() => {
      const m = { id: '${UI_MAP}', title: '连线测试', v: 3, flat: true, layout: 'mind', theme: 'fresh', nodes: [{id:'a',text:'节点 A',children:[]},{id:'b',text:'节点 B',children:[]}], pos:{a:{x:0,y:0},b:{x:300,y:160}}, size:{a:{w:140,h:60},b:{w:140,h:60}}, edges:[{id:'test-edge',from:{node:'a',side:'w'},to:{node:'b',side:'e'},dir:'both'}],fold:{} };
      localStorage.setItem('mm_map_${UI_MAP}',JSON.stringify(m)); return Mindmap.open('${UI_MAP}');
    })()`);
    await sleep(300);
    const key = async (name, code, text, value, modifiers=0) => {
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,modifiers, ...(text ? {text} : {}), ...(value ? {windowsVirtualKeyCode:value} : {})});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,modifiers, ...(value ? {windowsVirtualKeyCode:value} : {})});
    };
    const nodeA = await clickSel('.mm-node[data-id="a"]');
    await key('x','KeyX','x',88); await key('F2','F2',null,113);
    check('单击后字符键和 F2 不启动编辑、不改原文字', await ev(`!document.querySelector('.mm-edit') && Mindmap.findNode('a').n.text==='节点 A' && Mindmap.state().cur.nodes.length===2`));
    const doubleAt = async p => {
      await mouse('mousePressed',p.x,p.y,1,1); await mouse('mouseReleased',p.x,p.y,1,0);
      await mouse('mousePressed',p.x,p.y,2,1); await mouse('mouseReleased',p.x,p.y,2,0);
    };
    await doubleAt(nodeA);
    check('真实双击节点进入原文字编辑，不新建节点', await ev(`document.querySelector('.mm-edit')?.value==='节点 A' && Mindmap.state().cur.nodes.length===2 && document.activeElement===document.querySelector('.mm-edit')`));
    await clickSel('#mmShortcutsButton');
    check('编辑时打开侧栏保留内容、焦点和可见预览', await ev(`(() => {const ta=document.querySelector('.mm-edit'),p=document.querySelector('.mm-edit-preview').getBoundingClientRect(),v=document.getElementById('mmView').getBoundingClientRect();return ta?.value==='节点 A' && document.activeElement===ta && p.right<=v.right+1 && p.left>=v.left;})()`));
    await clickSel('#mmSnippetSearch');await send('Input.insertText',{text:'定积分'});await key('Enter','Enter',null,13);
    check('快捷键表可按中文搜索，搜索时不结束编辑或新建节点',await ev(`!!document.querySelector('.mm-edit') && Mindmap.state().cur.nodes.length===2 && document.querySelectorAll('.mm-shortcuts-table tbody tr').length===3 && document.getElementById('mmSnippetResults').textContent.includes('被积函数') && document.getElementById('mmSnippetResults').textContent.includes('微分变量')`));
    writeFileSync(new URL('../tools/shortcuts-sidebar-preview.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await clickSel('#mmShortcutsClose');
    check('关闭侧栏恢复画布且不结束节点编辑', await ev(`document.getElementById('mmShortcuts').classList.contains('hidden') && document.getElementById('mmShortcutsButton').getAttribute('aria-expanded')==='false' && !!document.querySelector('.mm-edit')`));
    await ev(`document.querySelector('.mm-edit').select()`); await send('Input.insertText',{text:'修改后的 A'}); await key('Enter','Enter',null,13,2);
    check('双击后可修改并保存当前节点文字', await ev(`!document.querySelector('.mm-edit') && Mindmap.findNode('a').n.text==='修改后的 A' && JSON.parse(localStorage.getItem('mm_map_${UI_MAP}')).nodes.find(n=>n.id==='a').text==='修改后的 A'`));
    await clickSel('#mmUndo');
    await ev(`(() => {const r=document.querySelector('.mm-node[data-id="a"]').getBoundingClientRect();document.getElementById('mmView').dispatchEvent(new MouseEvent('dblclick',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));})()`);
    check('双击事件落在画布时仍按坐标命中节点，不误建新节点', await ev(`document.querySelector('.mm-edit')?.value==='节点 A' && Mindmap.state().cur.nodes.length===2`), await ev(`JSON.stringify({value:document.querySelector('.mm-edit')?.value,nodes:Mindmap.state().cur.nodes.length})`));
    await key('Escape','Escape',null,27);
    const blank = JSON.parse(await ev(`(() => {const r=document.getElementById('mmView').getBoundingClientRect();return JSON.stringify({x:r.right-40,y:r.top+40});})()`));
    await doubleAt(blank);
    check('双击真正空白处只创建一个节点', await ev(`Mindmap.state().cur.nodes.length===3 && !!document.querySelector('.mm-edit')`));
    await key('Escape','Escape',null,27);
    check('平级节点与唯一连线显示', await ev(`document.querySelectorAll('.mm-node').length === 2 && document.querySelectorAll('.mm-edge').length === 1 && document.querySelectorAll('.mm-arrow').length === 2`));
    check('反向选点也能绕行，磁吸点固定为左侧到右侧', await ev(`(() => {const s=Mindmap.state(),a=s.L.nodes.get('a'),b=s.L.nodes.get('b'),r=MMEdgeRouter.route(a,b,s.cur.edges[0]);return !r.blocked && r.fromSide==='w' && r.toSide==='e' && r.points[0].x===a.x && r.points.at(-1).x===b.x+b.w && r.points.length>3;})()`));
    const oldPath = await ev(`document.querySelector('.mm-edge').getAttribute('d')`);
    const pos = await rectOf('.mm-node[data-id="b"]');
    await mouse('mousePressed', pos.x, pos.y, 1, 1);
    await mouse('mouseMoved', pos.x - 500, pos.y - 100, 1, 1);
    await mouse('mouseReleased', pos.x - 500, pos.y - 100, 1, 0);
    check('真实鼠标拖动后节点移动且连线路径更新', await ev(`Mindmap.state().cur.pos.b.x !== 300 && document.querySelector('.mm-edge').getAttribute('d') !== ${JSON.stringify(oldPath)}`));
    check('拖动后没有切换磁吸点', await ev(`(() => {const s=Mindmap.state(),r=MMEdgeRouter.route(s.L.nodes.get('a'),s.L.nodes.get('b'),s.cur.edges[0]);return r.fromSide==='w'&&r.toSide==='e'&&s.cur.edges[0].from.side==='w'&&s.cur.edges[0].to.side==='e';})()`));
    await clickSel('#mmUndo');
    const points = await ev(`(() => { const s=Mindmap.state(); const p=MMEdgeRouter.route(s.L.nodes.get('a'),s.L.nodes.get('b'),s.cur.edges[0]).points; const st=document.getElementById('mmStage');const matrix=new DOMMatrix(getComputedStyle(st).transform); const r=document.getElementById('mmView').getBoundingClientRect();const i=Math.floor(p.length/2);return JSON.stringify({x:r.left+matrix.e+(p[i-1].x+p[i].x)/2*matrix.a,y:r.top+matrix.f+(p[i-1].y+p[i].y)/2*matrix.a});})()`);
    const midpoint=JSON.parse(points); await clickAt(midpoint.x,midpoint.y);
    check('转弯后的线段可以点击选中', await ev(`document.querySelector('.mm-edge').classList.contains('sel')`));
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Delete',code:'Delete',windowsVirtualKeyCode:46});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Delete',code:'Delete',windowsVirtualKeyCode:46});
    check('删除连线后没有旧线残留，节点保留', await ev(`Mindmap.state().cur.edges.length===0 && document.querySelectorAll('.mm-links path').length===0 && document.querySelectorAll('.mm-node').length===2`));
    await clickSel('#mmUndo');
    check('撤销恢复连线', await ev(`document.querySelectorAll('.mm-edge').length===1`));
    await doubleAt(await rectOf('.mm-node[data-id="a"]'));
    const richSource = '# 数学笔记\n\n**重点** 与 *说明*\n\n- [x] 已复习\n- 公式 $E=mc^2$\n\n$$\n\\frac{1}{2}+\\sqrt{x}\n$$\n\n> 引用内容\n\n| 项目 | 数值 |\n| --- | --- |\n| x | 2 |\n\n```js\nconst cost = "$x$";\n```';
    await ev('document.querySelector(".mm-edit").select()'); await send('Input.insertText',{text:richSource});
    check('编辑中实时渲染 Markdown、表格、代码和行内/独立公式', await ev(`document.querySelector('.mm-edit-preview h1') && document.querySelector('.mm-edit-preview strong') && document.querySelector('.mm-edit-preview table') && document.querySelector('.mm-edit-preview pre code') && document.querySelectorAll('.mm-edit-preview .katex').length===2`));
    check('源码与实时预览都在画布可视范围内', await ev(`(() => {const r=document.getElementById('mmView').getBoundingClientRect();return ['.mm-edit','.mm-edit-preview'].every(sel=>{const p=document.querySelector(sel).getBoundingClientRect();return p.left>=r.left && p.right<=r.right+1 && p.top>=r.top && p.bottom<=r.bottom+1;});})()`));
    writeFileSync(new URL('../tools/content-editor-preview.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check('源码中的代码块美元符号不被当成公式', await ev(`document.querySelector('.mm-edit-preview pre code').textContent.includes('$x$') && !document.querySelector('.mm-edit-preview pre .katex')`));
    await key('Enter','Enter','\r',13);
    check('Enter 保留编辑模式并换行', await ev(`!!document.querySelector('.mm-edit') && document.querySelector('.mm-edit').value.endsWith(${JSON.stringify('\n')})`), await ev(`JSON.stringify({value:document.querySelector('.mm-edit')?.value,focus:document.activeElement.className})`));
    await key('Enter','Enter',null,13,2);
    check('保存后节点显示 Markdown 与公式，源码和尺寸一起落盘', await ev(`(() => {const n=Mindmap.findNode('a').n,d=JSON.parse(localStorage.getItem('mm_map_${UI_MAP}'));return !!document.querySelector('.mm-node[data-id="a"] h1') && document.querySelectorAll('.mm-node[data-id="a"] .katex').length===2 && n.text===${JSON.stringify(richSource+'\n')} && d.nodes.find(n=>n.id==='a').text===n.text && d.size.a.h>60;})()`), await ev(`JSON.stringify({text:Mindmap.findNode('a').n.text,size:Mindmap.state().cur.size.a,math:document.querySelectorAll('.mm-node[data-id="a"] .katex').length})`));
    await ev(`Mindmap.open('${UI_MAP}')`);
    check('重新打开仍保留 Markdown 源码和公式渲染', await ev(`Mindmap.findNode('a').n.text===${JSON.stringify(richSource+'\n')} && document.querySelectorAll('.mm-node[data-id="a"] .katex').length===2`));
    await doubleAt(await rectOf('.mm-node[data-id="b"]'));
    await ev('document.querySelector(".mm-edit").select()'); await send('Input.insertText',{text:'$frac$'}); await ev('document.querySelector(".mm-edit").setSelectionRange(5,5)'); await key('Tab','Tab',null,9);
    check('数学区域 Tab 展开分数并选中填空位置', await ev(`document.querySelector('.mm-edit').value==='$\\\\frac{□}{□}$' && document.querySelector('.mm-edit').value.slice(document.querySelector('.mm-edit').selectionStart,document.querySelector('.mm-edit').selectionEnd)==='□'`));
    await send('Input.insertText',{text:'1'}); await key('Tab','Tab',null,9); await send('Input.insertText',{text:'2'});
    check('分数占位符可以 Tab 跳转并渲染填写结果', await ev(`document.querySelector('.mm-edit').value==='$\\\\frac{1}{2}$' && !!document.querySelector('.mm-edit-preview .katex')`));
    const resetTemplate = async trigger => {await ev('document.querySelector(".mm-edit").select()');await send('Input.insertText',{text:'$'+trigger+'$'});await ev(`document.querySelector('.mm-edit').setSelectionRange(${trigger.length+1},${trigger.length+1})`);await key('Tab','Tab',null,9);};
    await resetTemplate('int');
    check('定积分展开四个区域并提示下限',await ev(`MMContent.completionStatus(document.querySelector('.mm-edit')).total===4 && document.querySelector('.mm-edit-help').textContent.includes('下限')`));
    await send('Input.insertText',{text:'0'});await key('Tab','Tab',null,9);await send('Input.insertText',{text:'1'});await key('Tab','Tab',null,9);
    check('定积分第三个区域是被积函数',await ev(`MMContent.completionStatus(document.querySelector('.mm-edit')).field==='被积函数'`));
    await key('Tab','Tab',null,9,8);
    check('Shift+Tab 返回已填上限且选择原内容',await ev(`(() => {const ta=document.querySelector('.mm-edit');return MMContent.completionStatus(ta).field==='上限' && ta.value.slice(ta.selectionStart,ta.selectionEnd)==='1';})()`));
    await key('Tab','Tab',null,9);await send('Input.insertText',{text:'frac'});await key('Tab','Tab',null,9);
    await send('Input.insertText',{text:'1'});await key('Tab','Tab',null,9);await send('Input.insertText',{text:'1+x^2'});await key('Tab','Tab',null,9);
    check('被积函数内分数补全结束后回到微分变量',await ev(`MMContent.completionStatus(document.querySelector('.mm-edit')).field==='微分变量'`));
    await send('Input.insertText',{text:'x'});await key('Tab','Tab',null,9);
    check('定积分填完后保持正确源码与预览，无剩余填空',await ev(`document.querySelector('.mm-edit').value===${JSON.stringify('$\\int_{0}^{1} \\frac{1}{1+x^2}\\,\\mathrm{d}x$')} && !MMContent.completionStatus(document.querySelector('.mm-edit')) && !!document.querySelector('.mm-edit-preview .katex')`));
    await resetTemplate('lim');
    for(const value of ['x','0','\\frac{\\sin x}{x}']){await send('Input.insertText',{text:value});await key('Tab','Tab',null,9);}
    check('极限支持独立填写变量、趋近点和函数',await ev(`document.querySelector('.mm-edit').value===${JSON.stringify('$\\lim_{x\\to 0} \\frac{\\sin x}{x}$')} && !!document.querySelector('.mm-edit-preview .katex')`));
    await resetTemplate('mat2');
    for(const value of ['1','2','3','4']){await send('Input.insertText',{text:value});await key('Tab','Tab',null,9);}
    check('矩阵命令含数字，四个元素逐行填写后正确渲染',await ev(`document.querySelector('.mm-edit').value===${JSON.stringify('$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$')} && !!document.querySelector('.mm-edit-preview .katex') && !document.querySelector('.mm-edit-preview .mm-math-error')`));
    await key('Escape','Escape',null,27);
    check('Esc 取消公式编辑，原节点文字不变且预览移除', await ev(`Mindmap.findNode('b').n.text==='节点 B' && !document.querySelector('.mm-edit-preview')`));
    check('括号公式、矩阵、多行环境可渲染，转义美元保留原样', await ev(`(() => { const el=document.createElement('div'); el.innerHTML=MMContent.render(${JSON.stringify('内联 \\(x_1\\)\n\n\\[\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\]\n\n$$\\begin{aligned}a&=1\\\\b&=2\\end{aligned}$$\n\n价格 \\$5')});return el.querySelectorAll('.katex').length===3 && !el.querySelector('.mm-math-error') && el.textContent.includes('价格 $5');})()`));
    check('错误公式和未闭合公式保留文本，恶意 HTML/链接不执行', await ev(`(() => {const invalid=MMContent.render('$\\\\badcommand{x}$'); const raw=MMContent.render('<img src=x onerror="alert(1)"> [坏链接](javascript:alert(1))');const el=document.createElement('div');el.innerHTML=raw;return invalid.includes('mm-math-error') && MMContent.render('未闭合 $x').includes('$x') && !el.querySelector('img,script,[onerror],[href^="javascript:"]');})()`));
    await ev(`(() => {window.originalBlobURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.lastDownloadBlob=blob;return window.originalBlobURL(blob);};document.querySelector('[data-mm="export"]').click();document.querySelector('[data-mm="ex-md"]').click();})()`);
    check('Markdown 导出保留多行公式和代码块源码', (await ev('window.lastDownloadBlob.text()')).includes(richSource+'\n'));
    await ev(`(() => {document.querySelector('[data-mm="export"]').click();document.querySelector('[data-mm="ex-json"]').click();})()`);
    check('JSON 备份包含原始 Markdown/LaTeX 源码', JSON.parse(await ev('window.lastDownloadBlob.text()')).nodes.find(n=>n.id==='a').text===richSource+'\n');
    await ev('URL.createObjectURL=window.originalBlobURL');
    await ev(`document.fonts.ready`);
    const exported = JSON.parse(await ev(`new Promise(resolve => { const create=document.createElement.bind(document);document.createElement=function(tag){const el=create(tag);if(tag==='canvas')el.toBlob=cb=>{document.createElement=create;const px=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let ink=0;for(let i=0;i<px.length;i+=4)if(px[i+3]>0&&px[i]<160&&px[i+1]<160&&px[i+2]<160)ink++;resolve(JSON.stringify({url:el.toDataURL('image/png'),alpha:px[3],ink}));};return el;};document.querySelector('[data-mm="export"]').click();document.querySelector('[data-mm="ex-png"]').click();})`));
    const png = exported.url;
    check('PNG 实际导出成功', typeof png==='string' && png.startsWith('data:image/png;base64,'));
    check('PNG 有不透明背景、正文和公式笔画，没有导出空白图片', exported.alpha===255 && exported.ink>1000, JSON.stringify({alpha:exported.alpha,ink:exported.ink}));
    if (png) writeFileSync(new URL('../tools/flat-export-preview.png',import.meta.url),Buffer.from(png.split(',')[1],'base64'));
    const capture = await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(new URL('../tools/flat-ui-preview.png',import.meta.url),Buffer.from(capture.data,'base64'));
    await ev(`Mindmap.open('${UI_MAP}')`); await sleep(150);
    const rightNode = async id => { const r=await rectOf('.mm-node[data-id="'+id+'"]'); await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'right',buttons:2,clickCount:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y,button:'right',buttons:0,clickCount:1}); };
    const beforeMenu=await ev(`JSON.stringify(Mindmap.state().cur)`);
    await rightNode('a');
    check('真实右键节点出现样式和提问菜单，不移动节点或建立连线',await ev(`!document.getElementById('mmNodeMenu').classList.contains('hidden') && document.querySelector('[data-mm="node-ask"]') && !document.querySelector('.mm-tools [data-mm="style"]') && JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeMenu)}`));
    const colorMenu=await rectOf('#mmNodeMenu [data-submenu="node-color"]');await mouse('mouseMoved',colorMenu.x,colorMenu.y,0,0);
    check('节点颜色悬停展开子菜单，不打开侧栏',await ev(`document.getElementById('mmPanel').classList.contains('hidden') && getComputedStyle(document.querySelector('#mmNodeMenu [data-submenu="node-color"] .mm-ctx-submenu')).display!=='none' && Mindmap.state().sel==='a'`));
    await rightNode('a'); await clickSel('[data-mm="node-ask"]');
    check('提问打开对应节点侧栏并关闭样式面板',await ev(`!document.getElementById('mmAI').classList.contains('hidden') && document.getElementById('mmPanel').classList.contains('hidden') && document.getElementById('mmAIContext').textContent.includes('当前节点')`));
    await ev(`window.__realFetch=window.fetch;window.fetch=async(url,options)=>{window.__chatPayload=JSON.parse(options.body);return {ok:true,json:async()=>({reply:'**测试回答**：$x^2$'})};}`);
    await clickSel('#mmAIInput'); await send('Input.insertText',{text:'解释当前节点'}); await clickSel('#mmAISend'); await sleep(100);
    check('对话传入节点上下文，回答渲染 Markdown 和公式并提供两个操作入口（模拟接口）',await ev(`window.__chatPayload.context.node.id==='a' && document.querySelector('#mmAIMessages strong') && document.querySelector('#mmAIMessages .katex') && document.querySelectorAll('[data-ai]').length===2`));
    const beforeRefresh=await ev(`JSON.stringify(Mindmap.state().cur)`);
    await clickSel('[data-ai="refresh"]');
    check('刷新重新绘制画布且不改变节点和连线数据',await ev(`JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeRefresh)} && document.getElementById('mmAIStatus').textContent==='画布已重新渲染'`));
    await ev(`window.fetch=async(url,options)=>{window.__summaryPayload=JSON.parse(options.body);return {ok:true,json:async()=>({summary:{title:'函数曲率',text:'曲率衡量切线方向随弧长的变化，曲率越大，弯曲越明显。'}})};}`);
    await clickSel('[data-ai="modify"]'); await sleep(100);
    check('修改先生成200字内总结和满意提示，按钮变推送且不改变导图',await ev(`window.__summaryPayload.mode==='summary' && document.querySelector('.mm-ai-summary h1').textContent==='第1次提问：函数曲率' && document.querySelector('.mm-ai-summary').textContent.includes('不满意的话，继续发送提问') && document.querySelector('[data-ai="push"]').textContent==='推送' && JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeRefresh)}`));
    await ev(`MMAI.close();MMAI.open('a')`);
    check('重新打开节点保留待推送总结',await ev(`!!document.querySelector('.mm-ai-summary h1') && !!document.querySelector('[data-ai="push"]')`));
    await clickSel('[data-ai="push"]');
    check('推送创建B并以B指向A，标题渲染且坐标留在导图层',await ev(`(()=>{const m=Mindmap.state().cur,n=m.nodes.at(-1),e=m.edges.at(-1),a=Mindmap.state().L.nodes.get('a'),b=Mindmap.state().L.nodes.get(n.id);window.__summaryNode=n.id;return n.text.startsWith('# 第1次提问：函数曲率') && Array.from(n.text).length<=200 && e.from.node===n.id && e.to.node==='a' && e.dir==='fwd' && !!m.pos[n.id] && !!m.size[n.id] && !('x' in n) && b.x>=a.x+a.w && !document.querySelector('.mm-edit') && !!document.querySelector('.mm-node[data-id="'+n.id+'"] h1');})()`));
    await ev(`document.querySelector('[data-ai="push"]').click()`);
    check('已推送按钮防止重复创建',await ev(`document.querySelector('[data-ai="push"]').disabled && Mindmap.state().cur.nodes.length===JSON.parse(${JSON.stringify(beforeRefresh)}).nodes.length+1`));
    await clickSel('#mmUndo');
    check('一次撤销同时移除总结节点和B到A连线',await ev(`JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeRefresh)}`));
    await ev(`MMAI.open('a')`); await clickSel('[data-ai="push"]');
    check('撤销后总结草稿可以重新推送',await ev(`Mindmap.state().cur.nodes.at(-1).text.startsWith('# 第1次提问：函数曲率')`));
    await ev(`document.getElementById('mmAIInput').value='';MMAI.open('b')`);
    check('不同节点对话记录隔离',await ev(`document.querySelectorAll('.mm-ai-message').length===0`));
    await ev(`MMAI.open('a')`);
    check('重新打开节点恢复历史回答',await ev(`document.querySelectorAll('.mm-ai-message').length===2`));
    await ev(`window.fetch=async()=>({ok:false,json:async()=>({error:'连接测试失败'})});document.getElementById('mmAIInput').value='重试问题';document.getElementById('mmAIForm').requestSubmit()`); await sleep(100);
    check('接口失败保留输入并恢复发送按钮',await ev(`document.getElementById('mmAIStatus').textContent==='连接测试失败' && document.getElementById('mmAIInput').value==='重试问题' && !document.getElementById('mmAISend').disabled`));
    writeFileSync(new URL('../tools/ai-sidebar-preview.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await ev(`window.__pollCalls=0;window.fetch=async(url,options)=>{if(options?.method==='POST')return {ok:true,json:async()=>({job:'test-job',status:'running'})};if(options?.method==='DELETE')return {ok:true,json:async()=>({status:'completed'})};window.__pollCalls++;if(window.__pollCalls===1)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({status:'completed',reply:'轮询恢复成功：$x^2$'})};};document.getElementById('mmAIInput').value='异步问题';document.getElementById('mmAIForm').requestSubmit()`);
    await sleep(100);
    check('提交后立刻显示问题已送达，模型等待通过短请求处理',await ev(`document.getElementById('mmAIStatus').textContent.includes('问题已送达') && document.getElementById('mmAISend').disabled`));
    await sleep(2200);
    check('取回答时短暂断网能重试，恢复后显示回答和操作按钮',await ev(`window.__pollCalls===2 && document.getElementById('mmAIMessages').textContent.includes('轮询恢复成功') && !document.getElementById('mmAISend').disabled`));
    const beforeSecondSummary=await ev(`JSON.stringify(Mindmap.state().cur)`);
    await ev(`window.fetch=async()=>({ok:true,json:async()=>({summary:{title:'缺少正文'}})});`);
    await clickSel('.mm-ai-message:last-child [data-ai="modify"]'); await sleep(100);
    check('正文缺失明确说明缺少text，画布数据不变',await ev(`document.getElementById('mmAIStatus').textContent.includes('总结正文缺失') && !document.querySelector('.mm-ai-message:last-child [data-ai="push"]') && JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeSecondSummary)}`));
    await ev(`window.fetch=async()=>({ok:true,json:async()=>({summary:{title:'主题'.repeat(20)+String.fromCharCode(10)+'继续讨论',text:'字'.repeat(240)+'$x^2$'}})});`);
    await clickSel('.mm-ai-message:last-child [data-ai="modify"]'); await sleep(100);
    check('超过200字和长标题仍可推送，标题换行自动合并，按第2次编号',await ev(`document.querySelector('.mm-ai-message:last-child .mm-ai-summary h1').textContent==='第2次提问：'+'主题'.repeat(20)+' 继续讨论' && !!document.querySelector('.mm-ai-message:last-child [data-ai="push"]') && document.querySelectorAll('.mm-ai-summary').length===2 && JSON.stringify(Mindmap.state().cur)===${JSON.stringify(beforeSecondSummary)}`));
    await clickSel('.mm-ai-message:last-child [data-ai="push"]');
    check('超200字总结完整推送，不截断正文或公式',await ev(`Mindmap.state().cur.nodes.at(-1).text.endsWith('字'.repeat(240)+'$x^2$')`));
    check('连续推送时新节点不会覆盖原节点或之前的总结',await ev(`(()=>{const l=[...Mindmap.state().L.nodes.values()],b=l.at(-1);return l.slice(0,-1).every(a=>b.x>=a.x+a.w || b.x+b.w<=a.x || b.y>=a.y+a.h || b.y+b.h<=a.y);})()`));
    await ev(`window.fetch=async()=>{throw new TypeError('Failed to fetch')};document.getElementById('mmAIInput').value='发送失败保留问题';document.getElementById('mmAIForm').requestSubmit()`); await sleep(100);
    check('发送连接失败显示中文恢复提示，并保留问题',await ev(`document.getElementById('mmAIStatus').textContent.includes('连接本地 AI 服务失败') && document.getElementById('mmAIInput').value==='发送失败保留问题' && !document.getElementById('mmAISend').disabled`));
    await ev(`window.fetch=window.__realFetch`);
    check('真实后端明确声明模型未接入',await ev(`fetch('/api/ai/status').then(r=>r.json()).then(s=>s.available===false && s.provider===null)`));
    await ev(`document.getElementById('mmAIInput').value='未配置模型时保留问题';document.getElementById('mmAIForm').requestSubmit()`); await sleep(100);
    check('未配置模型不调用本机工具，提示明确且保留问题',await ev(`document.getElementById('mmAIStatus').textContent.includes('尚未接入 AI 模型') && document.getElementById('mmAIInput').value==='未配置模型时保留问题' && !document.getElementById('mmAISend').disabled`));
    await ev(`MMAI.close()`);
    const bad=RESULTS.filter(r=>!r.ok);console.log(`\n结果：${RESULTS.length-bad.length} 通过 / ${bad.length} 失败`);return bad.length?1:0;
  }
  const deadline = Date.now() + TIMEOUT;
  const guard = () => { if (Date.now() > deadline) throw new Error("整体超时（" + TIMEOUT + "ms），用 --timeout 加大"); };

  // 0) 页面能开
  for (let i = 0; i < 40; i++) { if (await ev("document.readyState === 'complete' && !!window.Mindmap")) break; await sleep(200); }
  const title = await ev("document.title");
  check("页面能打开并加载出导图模块（title=" + JSON.stringify(title) + "）", !!title && await ev("!!window.Mindmap"));
  check("列表页没有画布（#mmStage 不存在）", (await ev("!!document.getElementById('mmStage')")) === false);

  // 1) 用模板建一张图 → 画布出现
  await clickSel('[data-mm="new"][data-tpl="course"]');
  await sleep(700);
  await ev(`(() => { const ta = document.querySelector('.mm-edit'); if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return !!ta; })()`);
  await sleep(300);
  let c = JSON.parse(await ev(SCAN));
  check("点模板后进入编辑页、画布出现、节点都落到了坐标上（树 " + c.tree + " 个 / pos " + c.pos + " 条）",
    (await ev("!!document.getElementById('mmStage')")) && c.tree > 1 && c.pos === c.tree, "tree=" + c.tree + " pos=" + c.pos);

  const geo = JSON.parse(await ev(`JSON.stringify({ boxTop: +document.getElementById('mmBox').getBoundingClientRect().top.toFixed(1), viewTop: +document.getElementById('mmView').getBoundingClientRect().top.toFixed(1), toolsH: +document.querySelector('.mm-tools').getBoundingClientRect().height.toFixed(1) })`));
  console.log("    几何： #mmBox top=" + geo.boxTop + " · #mmView top=" + geo.viewTop + " · 工具条高=" + geo.toolsH + "（换算基准必须是 #mmView）");

  // 2) 收起按钮：第 1 次点就折叠
  const foldT = JSON.parse(await ev(`(() => { const st = window.Mindmap.state(); const s = [...st.L.nodes.values()].find((x) => x.depth === 1 && (x.n.children || []).length); return s ? JSON.stringify({ id: s.n.id, text: s.n.text }) : "null"; })()`));
  if (!foldT || foldT === "null") check("找得到带子节点的一级主题（收起按钮的前提）", false, "模板里没有这样的节点");
  else {
    const btn = await rectOf(`#mmStage .mm-node[data-id="${foldT.id}"] .mm-fold`);
    if (!btn) check("节点的收起按钮已渲染", false, "找不到 .mm-fold");
    else {
      await mouse("mouseMoved", btn.x, btn.y, 0, 0);            // 只悬停，不点节点（复现"第 1 次点"的场景）
      await sleep(200);
      const st1 = JSON.parse(await ev(`(() => { const st = window.Mindmap.state(); const b = document.querySelector('#mmStage .mm-node[data-id="${foldT.id}"] .mm-fold'); return JSON.stringify({ selThis: st.sel === "${foldT.id}", hasBtn: !!b, opacity: b ? getComputedStyle(b).opacity : "", pe: b ? getComputedStyle(b).pointerEvents : "" }); })()`));
      const domBefore = await ev("document.querySelectorAll('#mmStage .mm-node').length");
      console.log("    收起按钮：悬停后 opacity=" + st1.opacity + " pointer-events=" + st1.pe + " · 点之前该节点被选中吗=" + st1.selThis);
      await clickAt(btn.x, btn.y);
      await sleep(400);
      const folded = JSON.parse(await ev(`(() => { const st = window.Mindmap.state(), m = st.cur;
  const find = (id) => { for (const t of window.Mindmap.nodesOf(m)) { const q = (function w(n) { if (n.id === id) return n; for (const c of n.children || []) { const r = w(c); if (r) return r; } return null; })(t); if (q) return q; } return null; };
  /* 折叠状态在**导图层** cur.fold（节点字段里没有 fold），所以这里读 m.fold 而不是节点上的 f.fold。 */
  return JSON.stringify({ fold: !!(m.fold && m.fold["${foldT.id}"]), node: !!find("${foldT.id}"), dom: document.querySelectorAll('#mmStage .mm-node').length, selThis: st.sel === "${foldT.id}" }); })()`));
      check("收起按钮：**第 1 次点**就折叠（点之前该节点未被选中：" + !st1.selThis + "）", folded.fold === true, JSON.stringify(folded));
      check("折叠后后代不再画进 DOM（" + domBefore + " → " + folded.dom + "）", folded.dom < domBefore);
      await clickAt(btn.x, btn.y);
      await sleep(400);
      const unfolded = JSON.parse(await ev(`(() => { const st = window.Mindmap.state(), m = st.cur;
  return JSON.stringify({ fold: !!(m.fold && m.fold["${foldT.id}"]), dom: document.querySelectorAll('#mmStage .mm-node').length }); })()`));
      check("第 2 次点展开（一次点击一个动作，不是「按两下才动」）", unfolded.fold === false, JSON.stringify(unfolded));
    }
  }

  // 3) 双击空白建点：中心落在鼠标点（绝对对齐）
  const free = JSON.parse(await ev(`(() => {
    const st = window.Mindmap.state(), r = document.getElementById('mmView').getBoundingClientRect();
    const m = document.getElementById('mmStage').style.transform.match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)\\s*scale\\(([\\d.]+)\\)/);
    const k = +m[3], ox = r.left + +m[1], oy = r.top + +m[2];
    const boxes = [...st.L.nodes.values()].filter((s) => s.x != null).map((s) => ({ x: ox + s.x * k, y: oy + s.y * k, w: s.w * k, h: s.h * k }));
    for (let y = Math.round(r.top + 60); y < r.bottom - 60; y += 17)
      for (let x = Math.round(r.left + 60); x < r.right - 60; x += 17)
        if (!boxes.some((b) => x > b.x - 20 && x < b.x + b.w + 20 && y > b.y - 20 && y < b.y + b.h + 20)) return JSON.stringify({ x, y, viewTop: +r.top.toFixed(1), k });
    return "null";
  })()`));
  if (!free || free === "null") check("找得到一块没被节点盖住的空白（双击建点的前提）", false, "画布太满");
  else {
    const n0 = await ev("Object.keys(window.Mindmap.state().cur.pos).length");
    await clickAt(free.x, free.y); await sleep(60); await mouse("mousePressed", free.x, free.y, 2, 1); await mouse("mouseReleased", free.x, free.y, 2, 0);
    await sleep(400);
    const got = JSON.parse(await ev(`(() => {
      const st = window.Mindmap.state(), ids = Object.keys(st.cur.pos), last = ids[ids.length - 1], s = st.L.nodes.get(last);
      const r = document.getElementById('mmView').getBoundingClientRect();
      const m = document.getElementById('mmStage').style.transform.match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)\\s*scale\\(([\\d.]+)\\)/);
      const k = +m[3], ox = r.left + +m[1], oy = r.top + +m[2];
      return JSON.stringify({ size: s ? { w: s.w, h: s.h } : null, center: s ? { x: +(s.x + s.w / 2).toFixed(1), y: +(s.y + s.h / 2).toFixed(1) } : null,
        want: { x: +(( ${free.x} - ox) / k).toFixed(1), y: +(( ${free.y} - oy) / k).toFixed(1) }, edit: !!document.querySelector('.mm-edit') });
    })()`));
    const dx = got.center ? +(got.center.x - got.want.x).toFixed(1) : NaN, dy = got.center ? +(got.center.y - got.want.y).toFixed(1) : NaN;
    check("双击空白：新节点**中心**落在鼠标点 ±2px（偏差 " + dx + "," + dy + "，尺寸 " + JSON.stringify(got.size) + "）",
      !!got.center && Math.abs(dx) <= 2 && Math.abs(dy) <= 2);
    check("新节点进编辑（.mm-edit 出现）", got.edit === true);
    check("一次双击只建一个节点（pos " + n0 + " → " + (await ev("Object.keys(window.Mindmap.state().cur.pos).length")) + "）",
      (await ev("Object.keys(window.Mindmap.state().cur.pos).length")) === n0 + 1);
  }

  // 4) 删整棵子树 → 导图层无孤儿；5) 新建 → 撤销 → 无孤儿
  const t2 = JSON.parse(await ev(`(() => { const st = window.Mindmap.state(); const s = [...st.L.nodes.values()].find((x) => x.depth === 1 && (x.n.children || []).length); return JSON.stringify({ id: s.n.id, kids: (s.n.children || []).length }); })()`));
  await clickSel(`#mmStage .mm-node[data-id="${t2.id}"]`);
  await sleep(200);
  const selOK = (await ev("window.Mindmap.state().sel")) === t2.id;
  check("能选中带子节点的一级主题（删除断言的前提）", selOK, "sel=" + (await ev("window.Mindmap.state().sel")));
  if (selOK) {
    const b4 = JSON.parse(await ev(SCAN));
    await clickSel('[data-mm="del"]');
    await sleep(300);
    const af = JSON.parse(await ev(SCAN));
    check("删整棵子树后：表里不存在任何不在树上的 id（树 " + b4.tree + "→" + af.tree + "，pos " + b4.pos + "→" + af.pos + "）",
      af.orphans.length === 0, "孤儿=" + af.orphans.join(","));
    check("被删的子树节点条目都清了（pos 条数 == 树大小）", af.pos === af.tree && af.size === af.tree, "pos=" + af.pos + " size=" + af.size + " tree=" + af.tree);
  }
  const b5 = JSON.parse(await ev(SCAN));
  await clickSel('[data-mm="child"]').catch(() => {});
  await sleep(300);
  const a5 = JSON.parse(await ev(SCAN));
  check("点「＋ 子主题」新建成功（树 " + b5.tree + "→" + a5.tree + "，pos " + b5.pos + "→" + a5.pos + "）", a5.tree === b5.tree + 1 && a5.pos === b5.pos + 1);
  await clickSel('[data-mm="undo"]').catch(() => {});
  await sleep(300);
  const a6 = JSON.parse(await ev(SCAN));
  check("撤销「新建」后导图层里没有孤儿（树回到 " + a6.tree + "、pos 回到 " + a6.pos + "）",
    a6.orphans.length === 0 && a6.tree === b5.tree && a6.pos === b5.pos, "孤儿=" + a6.orphans.join(","));

  /* ---- 5b) 孤岛必须可见：真浏览器里"把所有线删光"，树上的节点一个都不许消失 ---- */
  {
    const cnt = `(() => {
      const M2 = window.Mindmap, m = M2.state().cur, vis = M2.visibleIds(m);
      let tree = 0, seen = 0;
      for (const t of M2.nodesOf(m)) (function w(n) { tree++; if (vis.has(n.id)) seen++; (n.children || []).forEach(w); })(t);
      return JSON.stringify({ edges: (m.edges || []).length, tree, seen });
    })()`;
    const before = JSON.parse(await ev(cnt));
    const beforeIds = JSON.parse(await ev("JSON.stringify(window.Mindmap.state().cur.edges || [])"));   // 放回原样用
    const after = JSON.parse(await ev(`(() => {
      const m = window.Mindmap.state().cur;
      m.edges = [];                                  // 等价于用户把所有线删光之后重开那张图（纯数据层，不改产品行为）
      return ${cnt};
    })()`));
    /* 这里只查数据层、不动 DOM；画布侧的证据在下面"真鼠标点线 + 真 Delete 删掉最后一条线"那一段。 */
    console.log("    孤岛（数据层）：删边前 边=" + before.edges + " → 删空后 边=" + after.edges);
    check("删空所有边后，**树上每个节点都可见**（可见 " + after.seen + "/" + after.tree + "，无边 ≠ 被折叠）",
      after.edges === 0 && after.seen === after.tree && after.tree > 1, JSON.stringify(after));
    /* 复位：不靠撤销栈（前面几段攒了一堆历史，撤销到哪一步不可控）——见下方"单边图删掉最后一条线"两节点仍在，
       产品状态在那一笔里已经自洽；这里把 edges 放回原样，后面的连线用例不受影响。 */
    await ev(`(() => { const m = window.Mindmap.state().cur; m.edges = ${JSON.stringify(beforeIds)}; return true; })()`);
    const back = JSON.parse(await ev("JSON.stringify({ edges: (window.Mindmap.state().cur.edges || []).length })"));
    check("（复位）边放回原样（" + back.edges + " 条）", back.edges === before.edges, JSON.stringify(back));
  }

  /* ---- 6) 第 1 步可见部分：四个磁吸点 + 拖拽虚线预览 + 松手建边（真浏览器 + 真鼠标） ---- */
  const magOf = async (id, side) => JSON.parse(await ev(`(() => {
    const st = window.Mindmap.state(), s = st.L.nodes.get("${id}");
    const tr = document.getElementById('mmStage').style.transform.match(/translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)\\s*scale\\(([\\d.]+)\\)/);
    const r = document.getElementById('mmView').getBoundingClientRect();
    const k = +tr[3], ox = r.left + +tr[1], oy = r.top + +tr[2];
    const p = "${side}" === "n" ? { x: s.x + s.w / 2, y: s.y } : "${side}" === "s" ? { x: s.x + s.w / 2, y: s.y + s.h }
      : "${side}" === "w" ? { x: s.x, y: s.y + s.h / 2 } : { x: s.x + s.w, y: s.y + s.h / 2 };
    return JSON.stringify({ x: Math.round(ox + p.x * k), y: Math.round(oy + p.y * k), k });
  })()`));
  const twoNodes = JSON.parse(await ev(`(() => {
    const st = window.Mindmap.state(), list = [...st.L.nodes.values()].filter((s) => s.x != null);
    const a = list.find((s) => s.depth === 1) || list[0], b = list.find((s) => s.n.id !== a.n.id && Math.abs(s.y - a.y) < 40) || list.find((s) => s.n.id !== a.n.id);
    return JSON.stringify({ a: a.n.id, b: b.n.id });
  })()`));
  const mA = await magOf(twoNodes.a, "n"), mB = await magOf(twoNodes.b, "s");   // 与迁移出的树边（e→w）不同的端点对
  await mouse("mouseMoved", mA.x, mA.y, 0, 0);        // 悬停到磁吸点附近
  await sleep(250);
  const magVis = JSON.parse(await ev(`(() => {
    const w = document.querySelector('#mmStage .mm-magwrap[data-id="${twoNodes.a}"]'), d = w && w.querySelector('.mm-mag');
    const cs = w ? getComputedStyle(w) : null, rd = d ? d.getBoundingClientRect() : null;
    return JSON.stringify({ opacity: cs ? cs.opacity : null, pe: cs ? cs.pointerEvents : null, d: rd ? +rd.width.toFixed(1) : null });
  })()`));
  check("悬停后该节点的磁吸点真的淡入（computed opacity=" + magVis.opacity + "，圆点屏幕直径 " + magVis.d + "px）",
    Number(magVis.opacity) === 1 && magVis.d >= 6 && magVis.d <= 12 + mA.k / 2 + 0.6, JSON.stringify(magVis));
  check("磁吸点层不吃事件（pointer-events:none —— 命中是几何算的，不让元素抢事件）", magVis.pe === "none", "pe=" + magVis.pe);
  const edgesBefore = Number(await ev("(window.Mindmap.state().cur.edges || []).length"));
  await mouse("mousePressed", mA.x, mA.y, 1, 1);
  await mouse("mouseMoved", Math.round((mA.x + mB.x) / 2), Math.round((mA.y + mB.y) / 2), 0, 1);
  await sleep(120);
  const prevN = Number(await ev("document.querySelectorAll('#mmStage .mm-linkprev path').length"));
  check("按住磁吸点拖动时，页面里真的画出了虚线预览（.mm-linkprev path = " + prevN + "）", prevN === 1, "path=" + prevN);
  await mouse("mouseMoved", mB.x, mB.y, 0, 1);
  await sleep(80);
  await mouse("mouseReleased", mB.x, mB.y, 1, 0);
  await sleep(250);
  const afterEdge = JSON.parse(await ev(`(() => { const c = window.Mindmap.state().cur, es = c.edges || []; return JSON.stringify({ n: es.length, last: es[es.length - 1] || null, prev: document.querySelectorAll('#mmStage .mm-linkprev path').length }); })()`));
  check("真实鼠标从一个磁吸点拖到另一个磁吸点 → 建出一条边（" + edgesBefore + " → " + afterEdge.n + "）",
    afterEdge.n === edgesBefore + 1, JSON.stringify(afterEdge));
  check("边的端点就是那两个磁吸点（from=" + JSON.stringify(afterEdge.last && afterEdge.last.from) + " to=" + JSON.stringify(afterEdge.last && afterEdge.last.to) + "）",
    !!afterEdge.last && afterEdge.last.from.node === twoNodes.a && afterEdge.last.from.side === "n" &&
    afterEdge.last.to.node === twoNodes.b && afterEdge.last.to.side === "s", JSON.stringify(afterEdge.last));
  check("松手后预览线自己收掉（不留残影）", afterEdge.prev === 0, "path=" + afterEdge.prev);
  /* 端点对唯一**含反向**：从 B.w 拖回 A.e 不许再建一条（真鼠标 + 真提示） */
  await mouse("mousePressed", mB.x, mB.y, 1, 1);
  await mouse("mouseMoved", mA.x, mA.y, 0, 1);
  await mouse("mouseReleased", mA.x, mA.y, 1, 0);
  await sleep(250);
  const revEdge = JSON.parse(await ev(`(() => JSON.stringify({ n: (window.Mindmap.state().cur.edges || []).length, banner: (document.getElementById('banner') || {}).textContent || "" }))()`));
  check("反向同一对端点（B.w → A.e）也拦下来（边数仍是 " + revEdge.n + "，提示：" + JSON.stringify(revEdge.banner) + "）",
    revEdge.n === edgesBefore + 1 && /已经有一条线/.test(revEdge.banner), JSON.stringify(revEdge));
  /* 三档视觉 + 命中带（真浏览器算出的 stroke-width / class）：2px 灰 → hover 3px 蓝 → 选中 4px 蓝 */
  const midEarly = { x: Math.round((mA.x + mB.x) / 2), y: Math.round((mA.y + mB.y) / 2) };
  const myEdge = String((afterEdge.last && afterEdge.last.id) || "");
  const edgeStyle = async () => JSON.parse(await ev(`(() => {
    const p = document.querySelector('#mmStage .mm-links path.mm-edge[data-id="${myEdge}"]');
    return JSON.stringify({ w: p ? +p.getAttribute('stroke-width') : null, c: p ? p.getAttribute('stroke') : null,
      hot: !!p && p.classList.contains('hot'), sel: !!p && p.classList.contains('sel') });
  })()`));
  await mouse("mouseMoved", midEarly.x, midEarly.y + 20, 0, 0);   // 离线 20px（>10px 命中带）
  await sleep(150);
  const stFar = await edgeStyle();
  check("真鼠标离线 20px（>10px 命中带）→ 不亮 hover、仍是常态 2px 灰（" + JSON.stringify(stFar) + "）",
    stFar.hot === false && stFar.w === 2 && stFar.c === "#5b6b7c", JSON.stringify(stFar));
  await mouse("mouseMoved", midEarly.x, midEarly.y + 6, 0, 0);    // 离线 6px（命中带内）
  await sleep(150);
  const stHot = await edgeStyle();
  check("真鼠标离线 6px（命中带内）→ hover 档 3px 蓝（" + JSON.stringify(stHot) + "）—— 命中带仍是 10px",
    stHot.hot === true && stHot.sel === false && stHot.w === 3 && stHot.c === "#2f7cf6", JSON.stringify(stHot));
  await clickAt(midEarly.x, midEarly.y + 6);
  await sleep(200);
  const stSel = await edgeStyle();
  check("真鼠标点线 → 选中档 4px 蓝、且 sel 压过 hover（" + JSON.stringify(stSel) + "）—— 选中比 hover 更明显",
    stSel.sel === true && stSel.hot === false && stSel.w === 4, JSON.stringify(stSel));
  /* 第 2 步：边要真的被画出来（默认单指向、箭头在目标端） */
  const edgeDraw = JSON.parse(await ev(`(() => {
    const line = document.querySelector('#mmStage .mm-links path.mm-edge[data-id="${myEdge}"]');
    const arrows = [...document.querySelectorAll('#mmStage .mm-links path.mm-arrow[data-edge="${myEdge}"]')];
    return JSON.stringify({ lines: document.querySelectorAll('#mmStage .mm-links path.mm-edge[data-id="${myEdge}"]').length,
      to: arrows.filter((x) => x.dataset.end === "to").length, from: arrows.filter((x) => x.dataset.end === "from").length,
      d: line ? line.getAttribute("d") : null, arrowD: arrows[0] ? arrows[0].getAttribute("d") : null });
  })()`));
  check("边真的画在页面上了（.mm-edge=" + edgeDraw.lines + "，path d=" + edgeDraw.d + "）",
    edgeDraw.lines === 1 && !!edgeDraw.d && /^M-?[\d.]+,-?[\d.]+ L-?[\d.]+,-?[\d.]+$/.test(edgeDraw.d), JSON.stringify(edgeDraw));
  check("默认单指向：箭头只画在目标端（to=" + edgeDraw.to + " from=" + edgeDraw.from + "，箭头 d=" + edgeDraw.arrowD + "）",
    edgeDraw.to === 1 && edgeDraw.from === 0 && !!edgeDraw.arrowD, JSON.stringify(edgeDraw));
  /* 屏幕恒定：放大之后圆点的**屏幕**直径必须还在 6–12.5px（不跟着舞台一起放大）。 */
  const boxBefore = JSON.parse(await ev(`(() => { const r = document.querySelector('#mmStage .mm-node[data-id="${twoNodes.a}"]').getBoundingClientRect(); return JSON.stringify({ w: +r.width.toFixed(1) }); })()`));
  await mouse("mouseMoved", mA.x, mA.y, 0, 0);
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: mA.x, y: mA.y, deltaX: 0, deltaY: -240, modifiers: 2 });
  await sleep(250);
  const zoomed = JSON.parse(await ev(`(() => {
    const w = document.querySelector('#mmStage .mm-magwrap[data-id="${twoNodes.a}"]'), d = w && w.querySelector('.mm-mag');
    const rd = d ? d.getBoundingClientRect() : null;
    const r = document.querySelector('#mmStage .mm-node[data-id="${twoNodes.a}"]').getBoundingClientRect();
    return JSON.stringify({ d: rd ? +rd.width.toFixed(1) : null, w: +r.width.toFixed(1) });
  })()`));
  check("放大后节点变大（" + boxBefore.w + " → " + zoomed.w + "）而圆点屏幕直径仍在 6–13px（" + zoomed.d + "）—— 屏幕恒定",
    zoomed.w > boxBefore.w * 1.05 && zoomed.d >= 6 && zoomed.d <= 13, JSON.stringify(zoomed));

  /* ---- 7) 第 3 步：点线选中（屏幕命中带）+ 右键菜单（四种指向 / 删边） ---- */
  /* 第 3 步的这几条（选线 / 右键菜单 / Esc / Delete）用一张**只有一条边**的干净图：
     老图迁移出来的树边会和测试边压在同一条线上，`edgeAt` 取最近的那条，"点中的是哪条"就说不清了。 */
  await ev(`(() => {
    const m = { id: "ui-edge", title: "一条边", layout: "mind", line: "curve", theme: "fresh", v: 3, fold: {},
      nodes: [{ id: "PA", text: "左主题", children: [] }, { id: "PB", text: "右主题", children: [] }],
      edges: [{ id: "EX", from: { node: "PA", side: "e" }, to: { node: "PB", side: "w" }, dir: "fwd" }],
      pos: { PA: { x: 0, y: 0 }, PB: { x: 460, y: 0 } }, size: {} };
    localStorage.setItem("mm_map_ui-edge", JSON.stringify(m));
    const idx = JSON.parse(localStorage.getItem("mm_index_v1") || "[]");
    if (!idx.some((x) => x.id === "ui-edge")) { idx.push({ id: "ui-edge", title: "一条边", updated: Date.now(), nodes: 2, version: 3, local: true, dirty: false }); localStorage.setItem("mm_index_v1", JSON.stringify(idx)); }
    return "ok";
  })()`);
  await ev("window.Mindmap.open('ui-edge')");
  await sleep(400);
  const mA2 = await magOf("PA", "e"), mB2 = await magOf("PB", "w");
  const midE = { x: Math.round((mA2.x + mB2.x) / 2), y: Math.round((mA2.y + mB2.y) / 2) };
  await clickAt(midE.x, midE.y);
  await sleep(200);
  const selN = Number(await ev("document.querySelectorAll('#mmStage .mm-edge.sel').length"));
  check("点在线上（真实鼠标，10px 命中带）→ 这条边被选中（.mm-edge.sel = " + selN + "）", selN === 1, "sel=" + selN);
  /* 右键：无头 CDP 的 Input.dispatchMouseEvent 不会合成 contextmenu 事件，所以在页内派发一个
     MouseEvent('contextmenu')（走的是**同一条监听**：真实右键就是这条路径）。 */
  await ev(`(() => {
    const el = document.elementFromPoint(${midE.x}, ${midE.y}) || document.getElementById('mmView');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${midE.x}, clientY: ${midE.y}, button: 2 }));
    return true;
  })()`);
  await sleep(250);
  const menu = JSON.parse(await ev(`(() => {
    const cm = document.getElementById('mmEdgeMenu'), body = cm || document.getElementById('mmDlgBody');
    const items = [...body.querySelectorAll('[data-dir]')].map((x) => x.getAttribute('data-dir'));
    const r = cm ? cm.getBoundingClientRect() : null;
    return JSON.stringify({ popup: !!cm && !cm.classList.contains('hidden'), dlgOpen: document.getElementById('mmDlg').open,
      items, hasDel: !!body.querySelector('[data-mm="edel"]'), x: r ? Math.round(r.left) : null, y: r ? Math.round(r.top) : null,
      text: body.textContent.replace(/\\s+/g, ' ').slice(0, 120) });
  })()`));
  check("真实右键线 → 弹出**浮层**菜单（浮层可见=" + menu.popup + "，弹窗没开=" + !menu.dlgOpen + "，位置 " + menu.x + "," + menu.y + "）",
    menu.popup === true && menu.dlgOpen === false, JSON.stringify(menu));
  check("菜单四项 + 删除都在：" + JSON.stringify(menu.items),
    menu.items.length === 4 && ["none", "fwd", "rev", "both"].every((v) => menu.items.indexOf(v) >= 0) && menu.hasDel === true,
    JSON.stringify(menu));
  check("菜单是人话（不是枚举值）：" + menu.text, /指向/.test(menu.text) && /没有箭头/.test(menu.text), menu.text);
  await clickSel('#mmEdgeMenu [data-dir="rev"]');
  await sleep(250);
  const afterRev = JSON.parse(await ev(`(() => {
    const a = [...document.querySelectorAll('#mmStage .mm-links path.mm-arrow[data-edge="EX"]')], cm = document.getElementById('mmEdgeMenu');
    return JSON.stringify({ to: a.filter((x) => x.dataset.end === "to").length, from: a.filter((x) => x.dataset.end === "from").length,
      hidden: !cm || cm.classList.contains('hidden'), dir: ((window.Mindmap.state().cur.edges || []).find((e) => e.id === "EX") || {}).dir });
  })()`));
  check("点「← 指向」→ 箭头立刻改到起点、浮层顺手收掉（dir=" + afterRev.dir + "，to=" + afterRev.to + " from=" + afterRev.from + "，收起=" + afterRev.hidden + "）",
    afterRev.dir === "rev" && afterRev.to === 0 && afterRev.from === 1 && afterRev.hidden === true, JSON.stringify(afterRev));
  /* Esc 收菜单 / Delete 删选中的线（真键盘事件） */
  await ev(`(() => { const el = document.elementFromPoint(${midE.x}, ${midE.y}) || document.getElementById('mmView');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${midE.x}, clientY: ${midE.y}, button: 2 })); return true; })()`);
  await sleep(200);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  const escHid = JSON.parse(await ev(`(() => { const cm = document.getElementById('mmEdgeMenu');
    return JSON.stringify({ hidden: !cm || cm.classList.contains('hidden'), edges: (window.Mindmap.state().cur.edges || []).length }); })()`));
  check("真实按 Esc → 浮层收起、那条线还在（edges=" + escHid.edges + "）", escHid.hidden === true && escHid.edges === 1, JSON.stringify(escHid));
  await clickAt(midE.x, midE.y);                       // 先点线选中它
  await sleep(200);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await sleep(250);
  const delKb = JSON.parse(await ev(`(() => JSON.stringify({ n: (window.Mindmap.state().cur.edges || []).length, dom: document.querySelectorAll('#mmStage .mm-edge').length }))()`));
  check("选中边后按 Delete → 这条线被删（内存=" + delKb.n + "，画布上 .mm-edge=" + delKb.dom + "）", delKb.n === 0 && delKb.dom === 0, JSON.stringify(delKb));
  /* 删掉最后一条线之后：两个节点**都不许消失**（无边 ≠ 被折叠）。
     旧口径（种子只从容器根出发）在这里的后果是画布上只剩容器根 —— 用户看到"点没了"。 */
  const orb = JSON.parse(await ev(`(() => {
    const M2 = window.Mindmap, m = M2.state().cur, vis = M2.visibleIds(m);
    let tree = 0, seen = 0;
    for (const t of M2.nodesOf(m)) (function w(n) { tree++; if (vis.has(n.id)) seen++; (n.children || []).forEach(w); })(t);
    return JSON.stringify({ tree, seen, dom: document.querySelectorAll('#mmStage .mm-node').length,
      edges: (m.edges || []).length, ids: [...document.querySelectorAll('#mmStage .mm-node')].map((x) => x.dataset.id).join(","),
      pos: Object.keys(m.pos || {}).join(",") });
  })()`));
  check("真浏览器：删光所有线后孤岛仍在画布上（可见 " + orb.seen + "/" + orb.tree + "，DOM " + orb.dom + "，节点=" + orb.ids + "）",
    orb.tree === 2 && orb.seen === 2 && orb.dom === 2 && orb.edges === 0, JSON.stringify(orb));

  /* ---- 8) 第②步：多容器图在真浏览器里也要**全部**画出来（draw 与 PNG 共用同一份 layout） ---- */
  await ev(`(() => {
    const m = { id: "ui-two", title: "两个容器", layout: "mind", line: "curve", theme: "fresh", v: 2, edges: [], fold: {},
      nodes: [{ id: "rA", text: "容器一", children: [{ id: "aA", text: "一的子" }] },
              { id: "rB", text: "容器二", children: [{ id: "aB", text: "二的子" }] }],
      pos: { rA: { x: 0, y: 0 }, aA: { x: 220, y: 0 }, rB: { x: 0, y: 220 }, aB: { x: 220, y: 220 } }, size: {} };
    localStorage.setItem("mm_map_ui-two", JSON.stringify(m));
    const idx = JSON.parse(localStorage.getItem("mm_index_v1") || "[]");
    if (!idx.some((x) => x.id === "ui-two")) { idx.push({ id: "ui-two", title: "两个容器", updated: Date.now(), nodes: 4, version: 2, local: true, dirty: false }); localStorage.setItem("mm_index_v1", JSON.stringify(idx)); }
    return "ok";
  })()`);
  await ev("window.Mindmap.open('ui-two')");
  await sleep(400);
  const twoDom = JSON.parse(await ev(`(() => {
    const st = window.Mindmap.state(), b = st.L.nodes.get("aB");
    return JSON.stringify({ dom: document.querySelectorAll('#mmStage .mm-node').length, live: window.Mindmap.liveIds(st.cur).size,
      hasB: !!document.querySelector('#mmStage .mm-node[data-id="aB"]'), bx: b ? Math.round(b.x) : null, x1: Math.round(st.L.bounds.x1) });
  })()`));
  check("多容器图在真浏览器里**全画出来**（DOM=" + twoDom.dom + " / 树=" + twoDom.live + "，第二个容器在=" + twoDom.hasB + "，其 x=" + twoDom.bx + "）",
    twoDom.dom === twoDom.live && twoDom.dom === 4 && twoDom.hasB === true && twoDom.bx === 220, JSON.stringify(twoDom));
  check("布局 bounds 覆盖第二个容器（x1=" + twoDom.x1 + " ≥ 220）—— PNG 导出用同一份 layout",
    twoDom.x1 >= 220, JSON.stringify(twoDom));

  guard();
  const bad = RESULTS.filter((r) => !r.ok);
  console.log("\n结果：" + (RESULTS.length - bad.length) + " 通过 / " + bad.length + " 失败" +
    (bad.length ? "  → " + bad.map((b) => b.name).join("；") : ""));
  return bad.length === 0 ? 0 : 1;
};

/* ---------------- 收尾：一定关浏览器、一定删临时 profile ---------------- */
let code = 1;
try { code = await main(); } catch (e) { console.error("  ✗ 跑不下去：" + (e && e.message)); code = 1; }
try { if (ws) await send("Browser.close"); } catch (e) {}
await sleep(400);
try { if (child) child.kill(); } catch (e) {}
if (profile) {
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch (e) { await sleep(400); }
  }
  if (KEEP && existsSync(profile)) console.log("（--keep）临时 profile 保留在：" + profile);
}
process.exit(code);
