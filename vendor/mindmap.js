/* =========================================================================
 * 捞捞思维导图（工具页里打开）
 *   · 很多张导图：模板新建、搜索、改名、复制、删除；登录后存在账号里（数据库 mm_*，见 deploy/mindmap.sql），没登录先存在这台设备
 *   · 三种结构：思维导图（左右分布）/ 逻辑图（向右）/ 组织结构图（向下）；三种连线；四套主题
 *   · 编辑：Tab 子主题、Enter 同级、F2 / 双击改字、Delete 删除、方向键移动、Alt+↑↓ 调顺序、空格折叠、拖动换位置
 *     颜色、加粗、标记（优先级 / 完成 / 重点 / 疑问 / 易错…）、进度、备注、链接；撤销重做、复制粘贴整枝、搜索
 *   · 大纲视图（像写列表一样编辑）；粘贴 AI 回答 / Markdown / 缩进文字直接变成导图
 *   · 导出 PNG 图片、Markdown、纯文本大纲、JSON 备份；导入 JSON / Markdown / TXT
 *   · 两台设备同时改：不会互相覆盖，后保存的那份另存为「冲突副本」
 * 依赖 app.js：$ esc load save showView showBanner currentUser Sync CCAuth isMobile
 * =========================================================================
 * 【独立版改动记录】—— 基线：主仓库 main 的 75699 字节版本（sha256 1d28e770…62b2）
 *
 *   1) 坐标契约：坐标存在**导图层** cur.pos = { 节点id: {x, y} }。
 *      x/y 是节点左上角、舞台坐标系里的绝对值，单位与运行时 Map 的 s.x / s.y 一致。
 *      绝不写进节点字段（安卓端 normalizeNode() 是白名单式过滤，会静默丢掉）。
 *   2) 渲染改为读坐标：layout() 重命名为 layoutAuto()，外面包一层 layoutWithPos()：
 *      有坐标的节点用坐标；父节点有坐标的子节点跟着父节点一起挪；没有坐标的节点按旧算法排，
 *      再挪开避免与已摆好的节点重叠。
 *   3) 拖动落地：endNodeDrag() 松手时把位置写进 pos 并持久化（原来是改完父子关系就丢掉）。
 *   4) 新建节点：addChild / addSibling / addParent 创建时算一次初始坐标并立刻固化，
 *      不盖在父节点上（取父节点右侧，被占就往下让）。
 *   5) 迁移播种：旧导图（没有 pos）第一次打开时用旧布局算法算一遍写进 pos，之后不再重算。
 *      入口 seedPos()，在 openMap / create / 导入文件之后调用。
 * ========================================================================= */
(() => {
  const LS_IDX = "mm_index_v1", LS_REV = "mm_rev_v1", LS_PREF = "mm_pref_v1", mapKey = (id) => "mm_map_" + id;
  const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif";   // 用单引号：要写进 style="…" 里
  const THEMES = {
    fresh: { name: "纸感", bg: "#f4f1e8", grid: "#dedfce", root: "#637747", rootText: "#fffef8", text: "#343b2e", sub: "#fffef9", line: 2,
      colors: ["#77885e", "#6c8a94", "#b17a63", "#a18db1", "#b39758", "#749385", "#a27c87", "#838d70"] },
    warm: { name: "暖阳", bg: "#fffaf2", grid: "#f6ead6", root: "#e0683a", rootText: "#fff", text: "#3b2a1c", sub: "#fffdf8", line: 2,
      colors: ["#e0683a", "#d99a1e", "#7aa33c", "#c4567a", "#4b8bc9", "#9a6bd3", "#2f9e8f", "#b0743a"] },
    night: { name: "夜空", bg: "#121826", grid: "#1b2335", root: "#7c8cff", rootText: "#0e1220", text: "#e8edf7", sub: "#1b2335", line: 2,
      colors: ["#7c8cff", "#45d1a2", "#ffc94d", "#ff8a6b", "#c08bff", "#4fc3f7", "#ff7eb6", "#a5d86a"] },
    board: { name: "黑板", bg: "#24382f", grid: "#2b4237", root: "#f5f1e3", rootText: "#24382f", text: "#f5f1e3", sub: "#2b4237", line: 2.2,
      colors: ["#f9e27d", "#9fd8ff", "#ffb3a7", "#b8f2a8", "#e0c3ff", "#ffd1a1", "#a8f0e6", "#f5f1e3"] },
  };
  const LAYOUTS = { mind: "思维导图（左右分布）", right: "逻辑图（向右）", down: "组织结构图（向下）" };
  const LINES = { curve: "曲线", elbow: "折线", straight: "直线" };
  const MARKS = [["p1", "①", "优先级 1"], ["p2", "②", "优先级 2"], ["p3", "③", "优先级 3"], ["done", "✅", "完成"], ["star", "⭐", "重点"], ["ask", "❓", "疑问"],
    ["warn", "⚠️", "易错"], ["idea", "💡", "想法"], ["pin", "📌", "记住"], ["book", "📖", "要看书"], ["calc", "✏️", "要练习"], ["heart", "❤️", "喜欢"]];
  const MARK = Object.fromEntries(MARKS.map((m) => [m[0], m[1]]));
  const TEMPLATES = [
    { id: "blank", icon: "⚪", name: "空白导图", tip: "从一个空白节点开始", make: () => ({ text: "", children: [] }) },
  ];

  // ---------------- 小工具 ----------------
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
  const nid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const me = () => (typeof currentUser !== "undefined" && currentUser ? currentUser : null);
  // [独立版] 云同步已停用：RPC 通道不存在（第一版剥离 mm_save / mm_list / mm_get / mm_del / mm_rename）
  // const rpc = (fn, args) => CCAuth.rpc(fn, args || {});
  const tip = (msg, ms = 2600) => { showBanner(msg); clearTimeout(tip.t); tip.t = setTimeout(() => showBanner(""), ms); };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const when = (t) => { const d = new Date(t); if (isNaN(d)) return ""; const s = (Date.now() - d) / 1000; if (s < 60) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前"; return `${d.getMonth() + 1}月${d.getDate()}日`; };
  const fill = (n) => { n.id = n.id || nid(); n.text = String(n.text ?? ""); n.children = (n.children || []).map(fill); return n; };
  const walk = (n, f, p = null, depth = 0) => { if (!n) return; f(n, p, depth); if (n.children) for (const c of n.children) walk(c, f, n, depth + 1); };
  const count = (n) => { let k = 0; walk(n, () => k++); return k; };
  /* 容器版计数：新格式 nodes 数组、旧格式 root 都认。 */
  /* 【独立版·平级】边的 id 走独立空间（与节点 id 不同源），便于排查与断言。 */
  const eid = () => "e" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const countNodes = (m) => (Array.isArray(m && m.nodes) ? m.nodes : m && m.root ? [m.root] : []).reduce((a, r) => a + count(r), 0);
  const pref = Object.assign({ layout: "mind", line: "curve", theme: "fresh" }, lsGet(LS_PREF, {}));

  // ---------------- 存储 ----------------
  // 本机索引：[{id, title, updated, nodes, version, local(还没传上去), dirty(有改动没同步)}]
  let index = lsGet(LS_IDX, []);
  const idxSave = () => lsSet(LS_IDX, index);
  const idxGet = (id) => index.find((x) => x.id === id);
  function idxPut(e) { const i = index.findIndex((x) => x.id === e.id); if (i >= 0) index[i] = { ...index[i], ...e }; else index.unshift(e); idxSave(); }
  function newMap(tpl, title) {
    const root = fill(clone((TEMPLATES.find((t) => t.id === tpl) || TEMPLATES[0]).make()));
    if (title) root.text = title;
    return { id: uid(), title: title || root.text || "未命名导图", layout: pref.layout, line: pref.line, theme: pref.theme, nodes: [root], fold: {}, edges: [], v: 2 };
  }
  function storeLocal(m) {
    fileListRevision++;
    const e = idxGet(m.id) || {};
    const ok = lsSet(mapKey(m.id), m);
    idxPut({ id: m.id, title: m.title, updated: Date.now(), nodes: countNodes(m), version: e.version || 0, local: e.local ?? true, dirty: true, uid: me() ? me().id : e.uid || null });
    if (!ok) tip("这台设备的存储空间满了：登录后导图会存到账号里", 4000);
    window.MMFiles?.queue(m);
  }

  /* ===== [独立版] 云同步整段停用 =====
     第一版范围明确排除云同步（BRIEF 第 3 节）。下面这段是主仓原实现，
     原样保留在注释里：将来要恢复云同步，删掉这一对注释符即可，逻辑没被改动过。
  let cloudBusy = false, cloudTimer = 0, syncSt = "";
  function setSync(s) { syncSt = s; const el = $("mmSync"); if (el) { el.textContent = s; el.className = "mm-sync" + (/失败|冲突/.test(s) ? " bad" : /保存中|同步中/.test(s) ? " busy" : ""); } }
  function scheduleCloud() { clearTimeout(cloudTimer); if (!me()) { setSync("只存在这台设备（登录后自动存到账号）"); return; } setSync("保存中…"); cloudTimer = setTimeout(pushDirty, 1200); }
  // 把有改动的导图传上去（带版本号：别的设备改过就不覆盖，自己这份另存为副本）
  async function pushDirty() {
    if (!me() || cloudBusy) return;
    cloudBusy = true;
    try {
      for (const e of index.filter((x) => x.dirty && (!x.uid || x.uid === me().id))) {
        const m = lsGet(mapKey(e.id), null); if (!m) { e.dirty = false; continue; }
        const r = await rpc("mm_save", { p_id: m.id, p_title: m.title, p_data: m, p_base: e.local ? null : e.version || null, p_nodes: countNodes(m) });
        if (r && r.ok) { e.version = r.version; e.local = false; e.dirty = false; e.uid = me().id; }
        else if (r && r.conflict) {
          // 别的设备先改了：我这份另存为「冲突副本」，当前打开的换成账号里的最新版
          const copy = { ...clone(m), id: uid(), title: m.title + "（冲突副本）" };
          lsSet(mapKey(copy.id), copy); index.unshift({ id: copy.id, title: copy.title, updated: Date.now(), nodes: countNodes(copy), version: 0, local: true, dirty: true, uid: me().id });
          e.dirty = false; e.version = 0;
          tip("这张图在别的设备上也改过：账号里的最新版已经打开，你刚才这份另存为「冲突副本」", 6000);
          if (cur && cur.id === m.id) { await openMap(m.id, true); }
        }
      }
      idxSave();
      setSync("已存到账号");
      try { save(LS_REV, { t: Date.now() }); } catch (e) {}
    } catch (err) {
      setSync(/function|does not exist|PGRST202|404/.test(err.message || "") ? "服务器还没装好思维导图，先存在这台设备" : "网络不好，先存在这台设备，稍后自动同步");
    } finally { cloudBusy = false; }
    if (index.some((x) => x.dirty && (!x.uid || x.uid === me().id))) { clearTimeout(cloudTimer); cloudTimer = setTimeout(pushDirty, 15000); }
  }
  // 从账号拿列表：账号里有、本机没有（或更新）的，记进索引
  async function pullList() {
    if (!me()) return;
    try {
      const rows = await rpc("mm_list");
      const ids = new Set(rows.map((r) => r.id));
      for (const r of rows) {
        const e = idxGet(r.id);
        if (!e) index.push({ id: r.id, title: r.title, updated: Date.parse(r.updated_at), nodes: r.nodes, version: 0, server: r.version, local: false, dirty: false, uid: me().id });
        else Object.assign(e, { server: r.version, uid: me().id, ...(e.dirty ? {} : { title: r.title, updated: Date.parse(r.updated_at), nodes: r.nodes }) });
      }
      // 账号里已经删了的（别的设备删的）：本机也删掉；本机新建还没传的留着
      index = index.filter((e) => ids.has(e.id) || e.local || e.dirty || (e.uid && e.uid !== me().id));
      index.sort((a, b) => b.updated - a.updated);
      idxSave();
      if (index.some((x) => x.dirty || x.local)) pushDirty();
    } catch (e) {}
  }
  ===== [独立版] 云同步停用结束 ===== */

  // 停用后的空壳：调用点一律不改，行为等同"没有云端"。
  // pullList / pushDirty 必须保持 async（调用点用了 .then），否则会 TypeError。
  let syncSt = "";
  function setSync() {}
  function scheduleCloud() {}
  async function pushDirty() {}
  // Reconcile the home list with saved files on every visit. Browser drafts are
  // kept separately, including when a saved file is removed outside the app.
  let fileListRequest=null, fileListRevision=0;
  const recoveryKey=id=>'mm_recovery_v1_'+id;
  async function mapHash(map){
    const bytes=new TextEncoder().encode(JSON.stringify(map));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function fileRequest(address,options){
    const response=await fetch(address,{cache:'no-store',...options});
    const data=await response.json();if(!response.ok)throw new Error(data.error || '读取本地导图失败');return data;
  }
  async function noteFile(map){
    if(!map?.id)return;
    const fileBaseHash=await mapHash(map);
    idxPut({id:map.id,fileBacked:true,fileBaseHash,fileMissing:false});
  }
  async function browserDraft(id,baseHash){
    const map=lsGet(mapKey(id),null),recovery=lsGet(recoveryKey(id),null);
    const changed=async value=>!!value && (!baseHash || await mapHash(value)!==baseHash);
    return {map,recovery,changed:await changed(map) || await changed(recovery?.map)};
  }
  async function pullList(){
    if(fileListRequest){fileListRevision++;return fileListRequest;}
    fileListRequest=(async()=>{
      let retry=true;
      while(retry && !cur){
        retry=false;const serial=openSerial,revision=fileListRevision;
        const data=await fileRequest('/api/maps');
        if(!Array.isArray(data.maps))throw new Error('本地导图列表格式无效');
        const files=await Promise.all(data.maps.map(async entry=>{
          if(typeof entry.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id))throw new Error('导图编号无效');
          const info=await fileRequest('/api/maps/'+encodeURIComponent(entry.id)+'/draft');
          if(info.base?.id!==entry.id || (!Array.isArray(info.base.nodes) && !info.base.root))throw new Error('导图文件格式无效');
          return {entry,info,hash:await mapHash(info.base)};
        }));
        const updates=[],removed=[],present=new Set(files.map(f=>f.entry.id));
        for(const {entry,info,hash} of files){
          const old=idxGet(entry.id),local=await browserDraft(entry.id,old?.fileBaseHash || hash);
          const preserve=local.changed;
          updates.push({entry:{...old,id:entry.id,title:info.base.title || '未命名导图',nodes:countNodes(info.base),updated:entry.updated || old?.updated || Date.now(),fileBacked:true,fileBaseHash:hash,fileMissing:false,hasDraft:preserve || !!info.recoverable,local:true,dirty:false},map:preserve?null:info.base,recovery:!preserve && info.recoverable && info.draft?{map:info.draft,token:info.token,updated:info.updated}:null});
        }
        for(const entry of index){
          if(present.has(entry.id) || !entry.fileBacked)continue;
          const local=await browserDraft(entry.id,entry.fileBaseHash);
          if(local.changed)updates.push({entry:{...entry,fileMissing:true,hasDraft:true},map:null,recovery:null});
          else removed.push(entry.id);
        }
        if(cur)return;
        if(serial!==openSerial || revision!==fileListRevision){retry=true;continue;}
        // Apply only after the entire scan succeeded; an offline or invalid file
        // must never turn an incomplete response into a deletion.
        for(const update of updates){
          if(update.map && !lsSet(mapKey(update.entry.id),update.map))throw new Error('浏览器存储空间不足');
          if(update.recovery && !lsSet(recoveryKey(update.entry.id),update.recovery))throw new Error('浏览器存储空间不足');
          const i=index.findIndex(e=>e.id===update.entry.id);if(i<0)index.push(update.entry);else index[i]=update.entry;
        }
        for(const id of removed){lsDel(mapKey(id));lsDel(recoveryKey(id));}
        index=index.filter(e=>!removed.includes(e.id)).sort((a,b)=>b.updated-a.updated);idxSave();
      }
    })().catch(error=>{console.warn('[local map list]',error);tip('更新本地导图列表失败，原列表和草稿已保留。请检查服务后刷新。',5000);});
    try{await fileListRequest;}
    finally{fileListRequest=null;}
  }
  function refreshHome(){renderList();pullList().then(()=>{if(!cur && currentView()==='mindmap')renderList();});}

  // ---------------- 状态 ----------------
  const aiBatches=new Set();
  let cur = null, sel = null, editing = null, editingNew = null, hist = [], redo = [], view = { x: 0, y: 0, k: 1 }, mode = "map", q = "", found = [], clip = null, panelOpen = false, listQ = "";
  let selectedNodes = new Set();
  let openSerial = 0;
  /* 【独立版】收起按钮的指针路径状态（见 bindCanvas 的 pointerdown / up）：
     foldDown = 按下时命中的收起按钮；foldSwallow = 这次折叠已经由指针路径处理过，
     浏览器随后还会补发一次 click，别在 click 委托里再折一次（否则一按一展开、净效果为零）。 */
  let foldDown = null, foldSwallow = null;
  /* 【独立版·平级】正在从某个磁吸点拖出的连线：{ from:{node,side} }；松手时按松手位置的磁吸点建边。 */
  let link = null;
  /* 选中的边（与"选中的节点" sel 是两套：点线选线、点节点选节点）。右键菜单与 Delete 都看它。 */
  let selEdge = null;
  /* 指针悬停到的那条边（视觉档：hover 比常态明显、比选中弱）。 */
  let hotEdge = null;
  let L = null;   // 最近一次布局：{nodes: Map(id → {n, x, y, w, h, depth, side, color, parent}), bounds}
  const node = (id) => (L && L.nodes.get(id) ? L.nodes.get(id).n : null);
  /* 【独立版·平级】按 id 查找必须覆盖**全部容器**（多容器下只搜 nodes[0] = 选中/编辑/删除/撤销里
     第二个容器的节点"找不到"，随后被当成"已删除"清掉 sel）。不传 n 时遍历全部容器；
     传 n 时仍是单棵树的递归（内部递归、isAncestor 都走这条）。 */
  function findNode(id, n, p = null) {
    if (n) {
      if (n.id === id) return { n, p };
      for (const c of n.children || []) { const r = findNode(id, c, n); if (r) return r; }
      return null;
    }
    for (const r of nodesArr()) { const hit = findNode(id, r, null); if (hit) return hit; }
    return null;
  }
  const isAncestor = (a, b) => { let r = findNode(b); while (r && r.p) { if (r.p.id === a) return true; r = findNode(r.p.id); } return false; };

  // Conversation records survive canvas undo; history stores canvas data only.
  function historyJSON(map=cur){const snapshot={...map};delete snapshot.aiMemory;return JSON.stringify(snapshot);}
  function restoreHistory(snapshot){const memory=cur?.aiMemory;cur=JSON.parse(snapshot);if(memory)cur.aiMemory=memory;}
  function change(fn, keepSel) {
    if (!cur) return;
    hist.push(historyJSON()); if (hist.length > 120) {hist.shift();for(const batch of aiBatches)batch.historyIndex--;} redo = [];
    fn();
    if (!cur.flat) cur.title = String((topNode() || {}).text || "未命名导图").split("\n")[0].slice(0, 80) || "未命名导图";
    storeLocal(cur); scheduleCloud(); draw();
  }
  function undo() { window.dispatchEvent(new Event("mm:ai-interrupt")); if (!hist.length) return; redo.push(historyJSON()); restoreHistory(hist.pop()); if (sel && !findNode(sel)) sel = null; storeLocal(cur); scheduleCloud(); draw(); tip("已撤销", 1200); }
  function redoIt() { window.dispatchEvent(new Event("mm:ai-interrupt")); if (!redo.length) return; hist.push(historyJSON()); restoreHistory(redo.pop()); if (sel && !findNode(sel)) sel = null; storeLocal(cur); scheduleCloud(); draw(); }

  // ---------------- 量字 + 布局 ----------------
  const cvs = document.createElement("canvas").getContext("2d");
  const fontOf = (depth, bold, size=16) => `${bold ? 700 : 400} ${Math.min(48,Math.max(10,Number(size)||16))}px ${FONT}`;
  const lineH = (depth,size=16) => Math.min(48,Math.max(10,Number(size)||16))*1.5;
  function wrapLines(text, font, maxW) {
    cvs.font = font;
    const out = [];
    for (const para of String(text || " ").split("\n")) {
      let line = "";
      for (const ch of para) {
        if (line && cvs.measureText(line + ch).width > maxW) { out.push(line); line = ch; } else line += ch;
      }
      out.push(line || " ");
    }
    return { lines: out, w: Math.max(...out.map((l) => cvs.measureText(l).width)) };
  }
  function measure(n, depth, fixedWidth = null) {
    if(n.pdf)return {w:480,h:570,lines:[],font:fontOf(depth,n.bold),padX:4,padY:4,pdf:true};
    if (n.image) {
      const media = (cur?.media || []).find(m => m.id === n.image), ratio = media?.width && media?.height ? media.height/media.width : .7;
      return {w:300,h:Math.min(420,Math.max(100,280*ratio))+20,lines:[],font:fontOf(depth,n.bold),padX:10,padY:10,image:true};
    }
    const font = fontOf(depth, n.bold,n.fontSize), maxW = fixedWidth ? Math.max(20,fixedWidth-34) : 326;
    const pre = (n.marks || []).map((m) => MARK[m] || "").join("");
    const wr = wrapLines((pre ? pre + " " : "") + (n.text || " "), font, maxW);
    const extra = (n.note ? 20 : 0) + (n.link ? 20 : 0) + (n.progress ? 22 : 0);
    const padX = depth === 0 ? 22 : depth === 1 ? 14 : 10, padY = depth === 0 ? 12 : depth === 1 ? 8 : 6;
    if (window.MMContent) {
      const rich = window.MMContent.measure(n.text || ' ', font, maxW, !fixedWidth);
      return { w: Math.max(60,rich.w + extra + padX * 2 + 6), h: Math.max(40,rich.h + padY * 2 + 4 + (pre ? lineH(depth,n.fontSize) : 0)), lines: wr.lines, font, padX, padY, rich: true };
    }
    // +6：边框和字体渲染的误差，免得最后一个字被挤到下一行
    return { w: Math.ceil(Math.max(depth === 0 ? 90 : 34, wr.w + extra) + padX * 2 + 6), h: wr.lines.length * lineH(depth) + padY * 2 + 2, lines: wr.lines, font, padX, padY };
  }
  function layoutAuto(all) {
    const th = THEMES[cur.theme] || THEMES.fresh, nodes = new Map(), lay = cur.layout || "mind";
    /* 【独立版·平级】**每个容器都是一棵树**：布局从全部容器开始摆，不再只看第一个。
       这里只改"从哪几个根开始"—— span / placeH / placeV 的算法本身一字不动
       （老图首次打开还要靠它们播种坐标，见 seedPos）。 */
    const roots = nodesArr();
    if (!roots.length) return { nodes, th, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } };
    const HG = lay === "down" ? 26 : 46, VG = lay === "down" ? 56 : 14;
    // 1) 量大小、记颜色（每个容器各量一棵，容器根一律是 depth 0）
    /* 【独立版·平级】可见性来自 **hiddenIds(cur)**（"谁被折叠盖住"的唯一权威）：
       · 不可见的节点**不进 L.nodes**（于是 draw / span / nudgeFree / bounds 全都只看得见可见节点）；
       · 但**仍然往下递归**：多父的节点可能被折叠挡了一条路、又靠另一条路绕得到（a2→a1x），
         不递归就摸不到它 —— 这也正是不能用 `children` 判折叠的原因（它判的只是叶子关系）。
       · cur.pos / cur.size 里被藏起来的条目故意保留：那是"用户摆过的位置"，展开时直接用回去。 */
    const hid = cur.flat ? new Set() : hiddenIds(cur, all);
    function prep(n, depth, color, parent) {
      if (!hid.has(n.id)) {
        const m = measure(n, depth, curSize()[n.id]?.w);
        const c = n.color || (depth === 0 ? th.root : color);
        /* 【独立版】尺寸在这里合并（measure 之后、nodes.set 之前）：让 span() 的缓存从一开始就按最终尺寸算 */
        const z = curSize()[n.id];
        const pinned = !!(z && Number.isFinite(z.w) && Number.isFinite(z.h) && z.w > 0 && z.h > 0);
        const cs = clampSize(pinned ? z.w : m.w, pinned ? z.h : m.h, m.w, m.h);
        if (!pinned || cs.w !== z.w || cs.h !== z.h) { curSize()[n.id] = cs; sizeDirty = true; }
        nodes.set(n.id, { n, depth, ...m, w: cs.w, h: cs.h, measW: m.w, measH: m.h, color: c, parent: parent ? parent.id : null, kids: n.children || [] });
      }
      (n.children || []).forEach((k, i) => prep(k, depth + 1, depth === 0 ? (k.color || th.colors[i % th.colors.length]) : color, n));
    }
    for (const r of roots) prep(r, cur.flat ? 1 : 0, cur.flat ? th.colors[0] : th.root, null);
    const S = (id) => nodes.get(id);
    // 2) 子树大小
    /* 【独立版·平级】只把**有盒子**的孩子算进 span/摆位：被折叠盖住的后代不进 L.nodes（`S(id)` 为 undefined），
       它们不占位置；展开时它们会重新参与（L 每帧重算）。 */
    const liveKids = (s) => s.kids.filter((k) => S(k.id));
    const span = (n) => { const s = S(n.id); if (s.span != null) return s.span;
      const ks = liveKids(s); const own = lay === "down" ? s.w : s.h;
      s.span = !ks.length ? own : Math.max(own, ks.reduce((a, k) => a + span(k), 0) + VG * (ks.length - 1) * (lay === "down" ? 0 : 1) + (lay === "down" ? HG * (ks.length - 1) : 0));
      return s.span; };
    // 横向：x 往 dir 方向长，y 在 [top, top+span] 内居中
    function placeH(n, x, top, dir) {
      const s = S(n.id); span(n);
      s.side = dir; s.x = dir > 0 ? x : x - s.w; s.y = top + s.span / 2 - s.h / 2;
      const tot = liveKids(s).reduce((a, k) => a + span(k), 0) + VG * Math.max(0, liveKids(s).length - 1);
      let y = top + (s.span - tot) / 2;
      for (const k of liveKids(s)) { placeH(k, dir > 0 ? s.x + s.w + HG : s.x - HG, y, dir); y += span(k) + VG; }
    }
    function placeV(n, left, y) {
      const s = S(n.id); span(n);
      s.side = 0; s.x = left + s.span / 2 - s.w / 2; s.y = y;
      const tot = liveKids(s).reduce((a, k) => a + span(k), 0) + HG * Math.max(0, liveKids(s).length - 1);
      let x = left + (s.span - tot) / 2;
      const rowH = Math.max(...liveKids(s).map((k) => S(k.id).h), 0);
      for (const k of liveKids(s)) { placeV(k, x, y + s.h + VG + (rowH - S(k.id).h) * 0); x += span(k) + HG; }
    }
    /* 3) 摆位置：**每个容器各摆一棵**，然后纵向叠放（容器之间留一条空）。
       `mind` 那套"左右按高度分两半"每个容器内部照旧。 */
    const placeRoot = (root) => {
      const rs = S(root.id);
      if (lay === "down") placeV(root, 0, 0);
      else if (lay === "right") placeH(root, 0, 0, 1);
      else {
        // 左右分布：按高度把一级主题分成两边（右边先放、尽量各一半）；可以手动指定 side
        const ks = liveKids(rs), total = ks.reduce((a, k) => a + span(k), 0);
        const right = [], left = []; let acc = 0;
        ks.forEach((k) => { const want = k.side === "l" ? left : k.side === "r" ? right : (acc + span(k) / 2 <= total / 2 + 1 || !right.length ? right : left); want.push(k); if (want === right) acc += span(k); });
        rs.side = 0; rs.x = -rs.w / 2; rs.y = -rs.h / 2;
        const stack = (arr, dir) => {
          const tot = arr.reduce((a, k) => a + span(k), 0) + VG * Math.max(0, arr.length - 1);
          let y = -tot / 2;
          for (const k of arr) { placeH(k, dir > 0 ? rs.x + rs.w + HG + 14 : rs.x - HG - 14, y, dir); y += span(k) + VG; }
        };
        stack(right, 1); stack(left, -1);
      }
    };
    let yOff = 0;
    for (const root of roots) {
      placeRoot(root);
      const sub = [];
      walk(root, (n) => { const s = S(n.id); if (s && s.x != null) sub.push(s); });
      if (!sub.length) continue;
      let mn = Infinity, mx = -Infinity;
      for (const s of sub) { mn = Math.min(mn, s.y); mx = Math.max(mx, s.y + s.h); }
      const dy = yOff - mn;
      for (const s of sub) s.y += dy;
      yOff += (mx - mn) + (lay === "down" ? 48 : 72);
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of nodes.values()) { if (s.x == null) continue; x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
    return { nodes, th, bounds: { x0, y0, x1, y1 } };
  }

  // ---------------- 【独立版】坐标：导图层 cur.pos ----------------
  // cur.pos 里是"已固化"的坐标：节点左上角，舞台坐标系。
  // 没碰过拖动的节点没有条目，仍按旧布局算法排，只是会被挪开避免压在一起。
  // 新建节点时还没量过字，这里给一个保守的估算尺寸，够用来算"别盖住父节点"
  const estSize = (text, depth) => ({ w: Math.max(depth === 0 ? 120 : 90, Math.min(260, String(text || "").length * (depth === 0 ? 20 : 15) + 40)), h: depth === 0 ? 52 : 38 });
  function validPos(p) { return p && typeof p.x === "number" && typeof p.y === "number" && isFinite(p.x) && isFinite(p.y); }
  function curPos() {
    if (!cur) return {};
    if (!cur.pos || typeof cur.pos !== "object") cur.pos = {};
    return cur.pos;
  }
  /* 【独立版·平级】节点集合的入口是**数组** `cur.nodes = [root]`（按 Chief 裁定；不参与布局/样式/折叠语义，
     `children` 留在节点上作迁移来源）。**不留 `root` 别名。**
     ⚠️ **数据形状只有这一处权威**（新格式 `nodes` 数组 / 旧格式 `root`）：`nodesOf(m)` 是唯一读取入口，
     渲染之外的调用方（自测台、`tools/verify-ui.mjs` 的页内片段）一律走它，**不许自己写**
     `Array.isArray(m.nodes) ? m.nodes : [m.root]` —— 第二份形状知识迟早和这里走偏。 */
  const nodesOf = (m) => (m && Array.isArray(m.nodes) ? m.nodes : (m && m.root ? [m.root] : []));
  const nodesArr = () => nodesOf(cur);
  const topNode = () => nodesArr()[0] || null;
  const isTopNode = (v) => { const id = v && typeof v === "object" ? v.id : v; return !!id && nodesArr().some((r) => r.id === id); };
  /* 全部容器里的节点 id 集合（pruneLayer / applyLayer / 断言共用同一处，别各写一份遍历）。 */
  const liveIds = (m) => { const s = new Set(); for (const r of nodesOf(m)) walk(r, (n) => s.add(n.id)); return s; };
  /* 【独立版·平级】**"谁看得见"只有这一处权威**（像 nodesOf 一样导出）：layout / draw / outline /
     doFind / exportPng 全调它，任何一处都不许自己再算一遍"谁被折叠盖住"。
     折叠 = **边的可达集合**（关系来源是**边**；`children` 只当迁移来源，老图的 children 在 migrateMap 里变成 fwd 边）：
       · 遍历种子 s = **容器根 ∪ 一张边都没有的节点**。只从容器根出发等于在渲染层偷偷安了一个"起点"
         （正是 INV-1 要拆的），代价是"边被删光/新建的点"这些孤岛被当成"被折叠"而消失 ——
         **无边 ≠ 被折叠**：跟任何节点都没关系的点照样画出来（它本来就画得出来，只是没人连它）。
         注意只放"**一条边都没有**"的节点（看的是是否有边，不看方向）：若按"没有出边的节点"放种子，
         有向图里**每个叶子**都会被放出来，折叠父亲时孩子会凭空露出来 —— 折叠功能整体失效。
       · 被折叠的节点**自身可见**，但不再往外传（邻居要靠别的路才够得着）；
       · 环用 visited 防死循环（INV-3：环合法）；多父的节点只要还有一条没被挡住的路就仍然可见。
     `all=true` = 不看折叠（播种时要用：折叠只是"暂时看不见"，位置照旧该固化）。 */
  const isFoldIn = (m, id) => !!(m && m.fold && m.fold[id]);
  function visibleIds(m, all) {
    if (m && m.flat) return liveIds(m);
    const out = new Set(), adj = new Map();
    for (const e of (m && Array.isArray(m.edges) ? m.edges : [])) {
      if (!e || !e.from || !e.to) continue;
      if (!adj.has(e.from.node)) adj.set(e.from.node, []);
      if (!adj.has(e.to.node)) adj.set(e.to.node, []);
      adj.get(e.from.node).push(e.to.node);
      adj.get(e.to.node).push(e.from.node);
    }
    const queue = [];
    /* 孤岛：**一条边都没有**的节点直接当遍历种子（先收它们，再收容器根；顺序无关，只是把两族种子一次放齐）。 */
    for (const r of nodesOf(m)) walk(r, (n) => { if (!adj.has(n.id) && !out.has(n.id)) { out.add(n.id); queue.push(n.id); } });
    for (const r of nodesOf(m)) { out.add(r.id); queue.push(r.id); }
    while (queue.length) {
      const id = queue.shift();
      if (!all && isFoldIn(m, id)) continue;               // 自身可见，但不往外传
      for (const nb of adj.get(id) || []) if (!out.has(nb)) { out.add(nb); queue.push(nb); }
    }
    return out;
  }
  function hiddenIds(m, all) {
    const vis = visibleIds(m, all), hid = new Set();
    for (const r of nodesOf(m)) walk(r, (n) => { if (!vis.has(n.id)) hid.add(n.id); });
    return hid;
  }
  /* 要"看见某个节点"需要先展开哪些折叠节点：从容器根按边找一条路，收集路上的折叠点。
     搜索命中了被折叠盖住的节点时用它（把路展开），而不是靠 children 的父子链去猜。 */
  function foldPathTo(m, id) {
    const prev = new Map(), seen = new Set(nodesOf(m).map((r) => r.id)), q = [...seen];
    const nbOf = (e, from) => {
      const a = e && e.from && e.from.node, b = e && e.to && e.to.node;
      return a === from ? b : b === from ? a : null;
    };
    while (q.length) {
      const cur2 = q.shift();
      if (cur2 === id) {
        const out = []; let x = id;
        while (prev.has(x)) { const p = prev.get(x); if (isFoldIn(m, p)) out.push(p); x = p; }
        return out;
      }
      for (const e of (m && Array.isArray(m.edges) ? m.edges : [])) {
        const nb = nbOf(e, cur2);
        if (!nb || seen.has(nb)) continue;
        seen.add(nb); prev.set(nb, cur2); q.push(nb);
      }
    }
    return [];
  }
  /* 【独立版·平级】折叠状态在**导图层** `cur.fold = { 节点id: true }`（与 pos/size 同层，绝不写节点字段）。
     所有读写走这两个入口：节点字段里**不再有** fold（迁移时 delete n.fold）。 */
  const isFold = (n) => !!(n && cur && cur.fold && cur.fold[n.id]);
  const setFold = (n, v) => { if (!n || !cur) return; if (v) (cur.fold ||= {})[n.id] = true; else if (cur.fold) delete cur.fold[n.id]; };
  /* 【独立版·平级】迁移（**显式步骤，不顺带**）：把老图节点字段上的折叠搬进导图层，
     并保证两个新导图层字段存在（fold 映射 / edges 列表）。幂等靠 v:2 —— 否则用户"删光折叠"后重开又被重建。 */
  function migrateMap(m) {
    if (!m || typeof m !== "object") return false;
    let changed = false;
    if (!m.fold || typeof m.fold !== "object" || Array.isArray(m.fold)) { m.fold = {}; changed = true; }
    if (!Array.isArray(m.edges)) { m.edges = []; changed = true; }
    if (!Array.isArray(m.nodes)) { m.nodes = m.root ? [m.root] : []; delete m.root; changed = true; }
    /* 顺序要紧：**补 id 必须在搬折叠之前**。`fill` 才给无 id 的老节点分配 id（见文件头），
       先搬折叠会把它的折叠写成 key "undefined"，随后被 pruneLayer 当孤儿清掉 —— 折叠静默丢失。
       （openMap 里那句 `for (const r of m.nodes) fill(r)` 在迁移之后，补不上这个洞。） */
    let idFilled = false;
    for (const r of m.nodes) walk(r, (n) => { if (!n.id) idFilled = true; });
    for (const r of m.nodes) fill(r);
    if (idFilled) changed = true;
    for (const r of m.nodes) walk(r, (n) => { if (n.fold) { m.fold[n.id] = true; delete n.fold; changed = true; } });
    /* 【独立版·平级】**children → 边**：老图的上下级自动变线（层级从此在边上，渲染与折叠都按边算）。
       只做一次，靠 v:3 幂等 —— 用户删光边之后重开不会再被重建。
       侧面：mind 默认 e→w（左分支 w→e）；down 用 s→n。拿不到布局信息时按默认走。 */
    if (m.v !== 3 && !(Array.isArray(m.edges) && m.edges.length)) {
      for (const r of m.nodes) walk(r, (n) => {
        for (const k of n.children || []) {
          const sd = (m.layout === "down") ? { from: "s", to: "n" } : (k.side === "l" ? { from: "w", to: "e" } : { from: "e", to: "w" });
          m.edges.push({ id: eid(), from: { node: n.id, side: sd.from }, to: { node: k.id, side: sd.to }, dir: "fwd" });
          changed = true;
        }
      });
    }
    if (m.v !== 3) { m.v = 3; changed = true; }
    return changed;
  }
  /* 【独立版】导图层表的**两个清单**（契约 §2.4）：各自只有一处定义，断言直接读同一处（见导出）。
     · LAYER_MAPS  按键删：`delete map[节点id]`
     · LAYER_LISTS 按**端点**删：过滤掉 from.node / to.node 命中被删集合的**条目**。
       它们没有"按节点 id 的键"，**绝不可当映射去 `delete d[节点id]`** —— 那删的是条目自己的 id，完全删错东西。
     `fold` / `edges` 落地时由这两处自动覆盖，清理代码不用再改。 */
  const LAYER_MAPS = ["pos", "size", "fold", "sizing", "pdfViews"];
  const LAYER_LISTS = ["edges"];
  /* 【独立版】**唯一的坐标写入口**：全文只有这里出现 `curPos()[…] = …`。
     调用方必须在 change() 的 fn 内调它（change 先快照再执行 fn，写在 fn 外就撤不回去）。 */
  function putLayerPos(id, p) { if (p) curPos()[id] = p; }
  /* 【独立版】删除时按节点 id 清理导图层：**两个清单各喂各的函数，不许互相复用** ——
     · dropLayer 只对 LAYER_MAPS（按键删）有效
     · dropEdges 只对 LAYER_LISTS（按**端点**过滤条目）有效
     为什么必须分开：dropLayer 天生是 `delete map[节点id]` 的语义；列表条目另有自己的 id，
     让它"顺手"处理列表，等于把两种语义塞进一个函数名 —— 迟早有人拿节点 id 去删边。 */
  function dropLayer(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    for (const t of LAYER_MAPS) { const d = cur[t]; if (!d) continue; for (const id of set) delete d[id]; }
  }
  function dropEdges(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    for (const t of LAYER_LISTS) {
      const a = cur[t]; if (!Array.isArray(a)) continue;
      cur[t] = a.filter((e) => !(e && ((e.from && set.has(e.from.node)) || (e.to && set.has(e.to.node)))));
    }
  }
  /* 【独立版】**列表类的最小助手**（只碰 LAYER_LISTS，函数体里不出现 delete）。
     抽出来的唯一目的是让"列表分支绝不按键删"这条形状断言**范围天然干净** —— 正则没法按分支圈范围，
     写成"整个 pruneLayer 里没有 delete"会把映射分支里正当的 `delete d[id]` 逼红。
     语义与原来内联的那两段一字不差（纯搬运，不带行为变化）。 */
  function pruneEdgesIn(live) {
    let n = 0;
    for (const t of LAYER_LISTS) {
      const a = cur[t]; if (!Array.isArray(a)) continue;
      const keep = a.filter((e) => e && e.from && e.to && live.has(e.from.node) && live.has(e.to.node));
      n += a.length - keep.length;
      cur[t] = keep;
    }
    return n;
  }
  function applyEdgesInto(src, live) {
    let n = 0;
    for (const t of LAYER_LISTS) {
      const from = src[t]; if (!Array.isArray(from)) continue;
      const to = (cur[t] ||= []);
      for (const e of from) {
        if (!e || !e.from || !e.to) continue;
        if (!live.has(e.from.node) || !live.has(e.to.node)) continue;
        to.push(clone(e)); n++;
      }
    }
    return n;
  }
  /* 导入时把文件里的导图层条目搬到当前图上：**只搬树上存在的 id / 两端都在树上的条目**
     （与 pruneLayer 同一判据），并按表做形状校验（坏数据不进门）。清单同样来自上面两处。 */
  const LAYER_OK = {
    pos: (v) => !!validPos(v),
    size: (v) => !!v && Number.isFinite(v.w) && Number.isFinite(v.h) && v.w > 0 && v.h > 0,
    sizing: v => !!v && typeof v === 'object' && (!('w' in v) || typeof v.w === 'boolean') && (!('h' in v) || typeof v.h === 'boolean'),
    pdfViews: v => !!v && typeof v === 'object' && Number.isSafeInteger(v.page) && v.page>0,
  };
  function applyLayer(src) {
    if (!cur || !src) return 0;
    const live = liveIds(cur);                         // 全部容器（唯一一处遍历；只算第一个容器 = 把别的容器当孤儿删）
    let n = 0;
    for (const t of LAYER_MAPS) {
      const from = src[t]; if (!from || typeof from !== "object") continue;
      const ok = LAYER_OK[t], to = (cur[t] ||= {});
      for (const id of Object.keys(from)) {
        if (!live.has(id)) continue;
        const v = from[id]; if (ok && !ok(v)) continue;
        to[id] = clone(v); n++;
      }
    }
    n += applyEdgesInto(src, live);                    // 列表类：只搬"两端都在树上"的条目（助手只碰 LAYER_LISTS）
    return n;
  }
  /* 读取容错：把"表里有、树里没有"的孤儿条目清掉（返回清掉的条数）。
     治本在 del 的清理；这里救的是**本次修复之前**就已经被污染、存在盘上的旧图。
     映射类按键清；列表类按**端点**清（条目自己还有 id，绝不能拿节点 id 去 delete）。 */
  function pruneLayer() {
    if (!cur || !topNode()) return 0;
    const live = liveIds(cur);                         // 全部容器（唯一一处遍历；只算第一个容器 = 把别的容器当孤儿删）
    let n = 0;
    for (const t of LAYER_MAPS) {
      const d = cur[t]; if (!d) continue;
      for (const id of Object.keys(d)) if (!live.has(id)) { delete d[id]; n++; }
    }
    n += pruneEdgesIn(live);                           // 列表类：按端点清理（助手只碰 LAYER_LISTS）
    return n;
  }

  function collide(rects, x, y, w, h) {
    for (const r of rects) if (x < r.x + r.w + 8 && x + w + 8 > r.x && y < r.y + r.h + 8 && y + h + 8 > r.y) return true;
    return false;
  }
  // 没有坐标的节点：压到别人就往下让，直到让开；最多试 200 档
  function nudgeFree(nodes, pos) {
    const placed = [];
    for (const [id, s] of nodes) { if (s.x == null || s.y == null) continue; if (pos[id]) placed.push({ x: s.x, y: s.y, w: s.w, h: s.h }); }
    for (const [id, s] of nodes) {
      if (s.x == null || s.y == null || pos[id]) continue;
      let y = s.y;
      for (let i = 0; i < 200 && collide(placed, s.x, y, s.w, s.h); i++) y += s.h + 14;
      s.y = y;
      placed.push({ x: s.x, y: s.y, w: s.w, h: s.h });
    }
  }
  /* 【独立版】节点尺寸：与坐标同层、同生命周期 —— 存在导图层 cur.size = { 节点id: {w,h} }，
     绝不写进节点字段（安卓 normalizeNode() 是白名单式过滤，会静默丢掉）。
     不变量：
       1) cur.size 里没有记录的节点，用"现有文本测量结果"落一次盘，之后不再重算（F5 重开不重算）；
       2) 最小 60×40；单个方向上限 8000，不再按短文本长度限制手动宽度。
       3) sizing[id].w/h 分别记录手动固定的方向；自动尺寸只在内容编辑/恢复适配时重算。 */
  const SIZE_MIN_W = 60, SIZE_MIN_H = 40;
  const curSize = () => (cur.size ||= {});
  const finNum = (v, d) => (Number.isFinite(v) ? v : d);   // 显式挡 NaN / Infinity：Math.max(60, NaN) 还是 NaN
  function clampSize(w, h) {
    const maxW = 8000, maxH = 8000;
    return {
      w: Math.min(maxW, Math.max(SIZE_MIN_W, Math.round(finNum(w, SIZE_MIN_W)))),
      h: Math.min(maxH, Math.max(SIZE_MIN_H, Math.round(finNum(h, SIZE_MIN_H)))),
    };
  }
  function fitNode(id, reset = false) {
    const n=findNode(id)?.n; if(!n || n.image || n.pdf)return;
    if(reset && cur.sizing)delete cur.sizing[id];
    const manual=cur.sizing?.[id] || {},old=curSize()[id] || {},natural=measure(n,1,manual.w ? old.w : null);
    curSize()[id]=clampSize(manual.w?old.w:natural.w,manual.h?old.h:natural.h,natural.w,natural.h);
  }
  /* 【独立版】尺寸合并点已前移到 measure() 之后、nodes.set 之前（见下方 layoutAuto 的 prep）。
     为什么必须在那里：span() 首次算完会把 s.span 缓存住（`if (s.span != null) return s.span`），
     若先建 Map、再事后覆写 w/h，缓存会停在旧尺寸上 —— 不报错，但给错值。
     sizeDirty = 本次有尺寸新写入或被 clamp 修正，需要落盘（一趟布局最多落一次） */
  let sizeDirty = false;

  function layoutWithPos() {
    const lay = layoutAuto(), pos = curPos(), fixed = new Set();
    if (sizeDirty) { sizeDirty = false; try { storeLocal(cur); } catch (e) {} }
    for (const [id, s] of lay.nodes) if (validPos(pos[id])) fixed.add(id);
    /* 【独立版·平级】有坐标的节点：坐标就是它的位置 —— **位置属于每个节点自己**（INV-4）。
       这里原先还有一段"父节点被拖走时，让它的子节点跟着挪同样的位移"（树语义残留）：
       平级模型下父子只是 children 的迁移来源、不是布局关系，跟随已删（Chief 裁定）。
       未固化的节点仍由 layoutAuto 摆、再由 nudgeFree 让开已摆好的（见下两步）。 */
    for (const [id, s] of lay.nodes) {
      if (!fixed.has(id)) continue;
      const p = pos[id];
      s.x = p.x; s.y = p.y;
    }
    // 没有坐标的节点：让开已经摆好的
    nudgeFree(lay.nodes, pos);
    if (cur.flat) {
      let pinned = false;
      for (const [id, box] of lay.nodes) if (!validPos(pos[id])) { putLayerPos(id, { x: box.x, y: box.y }); pinned = true; }
      if (pinned) storeLocal(cur);
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of lay.nodes.values()) { if (s.x == null) continue; x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
    for (const s of lay.nodes.values()) if (s.n.image) y0=Math.min(y0,s.y-38);
    for(const s of lay.nodes.values()){
      const record=cur.aiMemory?.turns?.find(t=>t.id===s.n.aiTurnId),b=window.MMAILearning?.box(s,record);
      if(b){x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h);}
    }
    lay.bounds = lay.nodes.size ? { x0, y0, x1, y1 } : {x0:0,y0:0,x1:0,y1:0};
    window.MMCanvasTools?.extendBounds(lay);
    window.MMGroups?.extendBounds(lay);
    return lay;
  }

  // 迁移播种：旧导图第一次打开（没有 pos）→ 用旧布局算法算一遍写进 pos
  // 坐标原点对齐到中心主题：根节点落在 (0,0)，整张图往左上方长也一样能看清
  function seedPos() {
    if (!topNode()) return false;
    const p = curPos();
    if (Object.keys(p).length) return false;
    const lay = layoutAuto(true), rs = lay.nodes.get(topNode().id);   // all=true：折叠只是"暂时看不见"，位置照旧固化
    const ox = rs && rs.x != null ? rs.x : 0, oy = rs && rs.y != null ? rs.y : 0;
    for (const [id, s] of lay.nodes) if (s.x != null && s.y != null) p[id] = { x: Math.round(s.x - ox), y: Math.round(s.y - oy) };
    try { storeLocal(cur); } catch (e) {}     // 立刻落盘：之后打开就是"已固化"的图
    return true;
  }

  // 新节点出生的位置：父节点右侧、垂直居中；被占了就往下让
  function spawnPos(anchor) {
    if (!anchor || anchor.x == null) return null;
    const p = curPos(), ids = Object.keys(p);
    let maxX = null, minY = null;
    for (const [id, s] of (L ? L.nodes : new Map())) {
      if (s.x == null || !p[id]) continue;
      maxX = maxX == null ? p[id].x + s.w : Math.max(maxX, p[id].x + s.w);
      minY = minY == null ? p[id].y : Math.min(minY, p[id].y);
    }
    const dy0 = Math.round(anchor.y + anchor.h / 2 - 15);
    let best = null;
    for (let i = 0; i < 20; i++) {
      const x = Math.round(anchor.x + anchor.w + 46), y = dy0 + i * 34;
      const taken = ids.some((id) => { const q = p[id]; return Math.abs(q.x - x) < 30 && Math.abs(q.y - y) < 26; });
      if (!taken) { best = { x, y }; break; }
    }
    if (!best) best = { x: maxX == null ? Math.round(anchor.x + anchor.w + 46) : Math.round(maxX + 60), y: minY == null ? dy0 : Math.round(minY) };
    // 再让开已经固化的节点：往下，最多 60 档
    let guard = 0;
    while (guard++ < 60 && ids.some((id) => { const q = p[id]; return Math.abs(q.x - best.x) < 60 && Math.abs(q.y - best.y) < 40; })) best.y += 40;
    return best;
  }
  // 新建节点：算一次初始坐标、立刻固化（改动 4）
  // at：显式指定左上角（双击空白用）；不传就按 spawnPos 算（挂在父/兄弟旁边）
  /* 【独立版】算新节点的出生坐标（**纯计算、不写数据**）。
     spawnPos 读 L，而 L 只在 draw() 里重算 —— 所以这一步必须在 change() 的 fn **之外**做，
     fn 里看到的还是旧 L。写入由调用方在 change() 的 fn 内调 putLayerPos，与 endNodeDrag 的 putPos 同构。 */
  function birthPos(anchor, at) {
    return at || spawnPos(anchor);
  }
  const layout = layoutWithPos;

  const hidden = (n) => { let k = 0; for (const c of n.children || []) walk(c, () => k++); return k; };

  /* ---------------- 磁吸点（连线落点） ----------------
     【独立版·平级】每条边记的是 { from:{node,side}, to:{node,side} } —— **只有端点语义，没有坐标**：
     端点位置每帧从布局盒现算（节点被拖动/缩放/换 zoom 后连线自然跟着走，不需要"重锚"）。
     磁吸点 = 节点盒四条边的中点（n/e/s/w），屏幕坐标下**大小恒定**：
       · 命中半径 magRadius：clamp(0.4 × min(节点屏幕宽, 屏幕高), 8, 16)   —— 常规节点退化成 16
       · 圆点直径 magDia   ：clamp(0.25 × min(…), 6, 12)                 —— 常规节点退化成 12
     圆点**只做视觉**（pointer-events:none），命中一律在 magnetAt() 里按几何算 ——
     与八方向缩放同一套口径，避免"元素命中抢事件"（第一次点被 hover 状态吃掉那次的教训）。 */
  const MAG_SIDES = ["n", "e", "s", "w"];
  const MAG_DIST = 26;                 // 指针离节点屏幕矩形多少像素以内 → 磁吸点淡入（屏幕像素，恒定）
  const magRadius = (s) => Math.max(8, Math.min(16, Math.round(0.4 * Math.min(s.w * view.k, s.h * view.k))));
  const magDia = (s) => Math.max(6, Math.min(12, Math.round(0.25 * Math.min(s.w * view.k, s.h * view.k))));
  /* 磁吸点的**舞台坐标**（每帧现算，不落盘） */
  const magPos = (s, side) => side === "n" ? { x: s.x + s.w / 2, y: s.y }
    : side === "s" ? { x: s.x + s.w / 2, y: s.y + s.h }
    : side === "w" ? { x: s.x, y: s.y + s.h / 2 }
    : { x: s.x + s.w, y: s.y + s.h / 2 };
  const magScreen = (s, side) => { const p = magPos(s, side); return { x: p.x * view.k + view.x, y: p.y * view.k + view.y }; };
  /* 磁吸点"屏幕恒定"：缩放变了要**立刻**把圆点直径改回 magDia/view.k（不然它会跟着舞台一起缩放）。
     只在 k 真的变了时才动 DOM —— 平移每帧都调 applyView，不做无谓的样式写。 */
  let magK = 1;
  function syncMagSize() {
    if (magK === view.k || !L) return;
    magK = view.k;
    const kk = view.k || 1;
    for (const w of document.querySelectorAll("#mmStage .mm-magwrap")) {
      const s = L.nodes.get(w.dataset.id); if (!s) continue;
      const md = Math.max(4, Math.round(magDia(s) / kk));
      for (const d of w.children) { d.style.width = md + "px"; d.style.height = md + "px"; }
    }
  }
  /* 【独立版·平级】边的命中（屏幕坐标入参）：线只有 1–2px，用户点不中就是没做 —— 所以按**屏幕 10px
     命中带**算（点到线段的距离）。节点优先于边：调用方先问节点、再问边。 */
  const EDGE_HIT = 10;
  function edgeAt(cx, cy) {
    if (!L || !cur || !Array.isArray(cur.edges) || !cur.edges.length) return null;
    const r = $("mmView").getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    let best = null, bestD = EDGE_HIT;
    for (const e of cur.edges) {
      const a = L.nodes.get(e.from.node), b = L.nodes.get(e.to.node);
      if (!a || !b || a.x == null || b.x == null) continue;
      const points = window.MMEdgeRouter.route(a, b, e).points.map(p => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y }));
      for (let i = 1; i < points.length; i++) {
        const p1 = points[i - 1], p2 = points[i], vx = p2.x - p1.x, vy = p2.y - p1.y, len2 = vx * vx + vy * vy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - p1.x) * vx + (py - p1.y) * vy) / len2)) : 0;
        const d = Math.hypot(px - (p1.x + t * vx), py - (p1.y + t * vy));
        if (d <= bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }
  /* 磁吸点命中（屏幕坐标入参）：返回 { id, side, cx, cy } 或 null。
     选中节点优先（与 zoneAt 同口径）—— 选中那一个的最后一次操作最可能是它。 */
  function magnetAt(cx, cy) {
    if (!L || !cur) return null;
    const r = $("mmView").getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
    const list = [...L.nodes.values()];
    const si = list.findIndex((s) => s.n.id === sel);
    if (si > 0) { const s = list.splice(si, 1)[0]; list.unshift(s); }
    for (const s of list) {
      if (s.x == null || s.y == null) continue;
      const rad = magRadius(s);
      for (const side of MAG_SIDES) {
        const p = magScreen(s, side);
        if (Math.hypot(px - p.x, py - p.y) <= rad) return { id: s.n.id, side, cx: p.x, cy: p.y };
      }
    }
    return null;
  }
  /* 【独立版·平级】同一对端点**唯一，且含反向**：已经 A.e↔B.w 之后，无论从 A.e 拖到 B.w、
     还是从 B.w 拖回 A.e，都是同一条线（拦下并给可见提示，不许静默丢）。
     注意**磁吸点本身不独占**：同一个点上可以挂多条边（扇出是正常需求）；
     平行边靠"不同的端点对"成立（A.e→B.n 与 A.s→B.w 是两条合法边）。 */
  function edgeDup(from, to) {
    return (cur.edges || []).some((e) => e && e.from && e.to && (
      (e.from.node === from.node && e.from.side === from.side && e.to.node === to.node && e.to.side === to.side) ||
      (e.from.node === to.node && e.from.side === to.side && e.to.node === from.node && e.to.side === from.side)));
  }
  function addEdge(from, to, dir) {
    if (!cur || !from || !to) return null;
    if (from.node === to.node && from.side === to.side) { tip("请连接不同的磁吸点"); return null; }
    if (edgeDup(from, to)) { tip("这两个点之间已经有一条线了（换个点连，或先删掉那条）"); return null; }
    const e = { id: eid(), from: { node: from.node, side: from.side }, to: { node: to.node, side: to.side }, dir: dir || "fwd" };
    change(() => { (cur.edges ||= []).push(e); });     // 走 change：可撤销、能落盘
    return e;
  }

  /* ---------------- 画 ----------------
     【独立版·平级】边怎么画：端点每帧从布局盒现算（magPos），线走直线，箭头画成小三角 `<path>`。
     箭头位置由 dir 决定：fwd = 只在终点（to）、rev = 只在起点、both = 两端、none = 不画。
     `data-end` 标明这一端是哪一头，方便断言与排查。 */
  const EDGE_COLOR = "#8b957f", EDGE_HOT = "#637747", ARROW = 10;
  /* 边的三档视觉：常态 2px 灰 / hover 3px 蓝 / 选中 4px 蓝 + 外圈光晕（选中必须比 hover 更明显）。
     命中带跟这个无关 —— 命中一律按屏幕 10px 几何算（EDGE_HIT），线本身多细都点得中。 */
  function edgeArrow(p, q, end, hot, eid, color=EDGE_COLOR) {
    const deg = Math.atan2(p.y - q.y, p.x - q.x) * 180 / Math.PI;
    return `<path class="mm-arrow${hot ? " hot" : ""}" data-end="${end}" data-edge="${eid}" d="M0,0 L${-ARROW},${ARROW * 0.45} L${-ARROW},${-ARROW * 0.45} Z" fill="${hot ? EDGE_HOT : color}" transform="translate(${p.x},${p.y}) rotate(${deg})"/>`;
  }
  function edgeSvg() {
    if (!cur || !Array.isArray(cur.edges)) return [];
    const out = [];
    for (const e of cur.edges) {
      if (!e || !e.from || !e.to) continue;
      const a = L.nodes.get(e.from.node), b = L.nodes.get(e.to.node);
      if (!a || !b || a.x == null || b.x == null) continue;      // 端点不在画布上（折叠/已删）就这条不画
      const routed = window.MMEdgeRouter.route(a, b, e), points = routed.points, p1 = points[0], p2 = points[points.length - 1], dir = e.dir || "fwd";
      const sel2 = e.id === selEdge, hot = !sel2 && e.id === hotEdge;
      const cls = "mm-edge" + (sel2 ? " sel" : hot ? " hot" : "");
      const baseColor=/^#[0-9a-f]{6}$/i.test(e.color || "")?e.color:EDGE_COLOR;
      const col = sel2 || hot ? EDGE_HOT : baseColor, wd = sel2 ? 4 : hot ? 3 : 2;
      out.push(`<path class="${cls}" data-id="${e.id}" d="${routed.path}" stroke="${col}" stroke-width="${wd}" fill="none" stroke-linecap="round" opacity="${sel2 || hot ? 1 : .9}"/>`);
      if (dir === "fwd" || dir === "both") out.push(edgeArrow(p2, points[points.length - 2], "to", sel2 || hot, e.id, baseColor));
      if (dir === "rev" || dir === "both") out.push(edgeArrow(p1, points[1], "from", sel2 || hot, e.id, baseColor));
    }
    return out;
  }
  /* 指针悬停到某条线上：只改类名/属性，不重画整张图（连线可能很多）。
     与选中互斥：选中的那条永远用"选中档"。 */
  function markEdgeHot(id) {
    if (hotEdge === id) return;
    hotEdge = id;
    for (const p of document.querySelectorAll("#mmStage .mm-links path.mm-edge")) {
      const on = p.dataset.id === id, isSel = p.classList.contains("sel");
      p.classList.toggle("hot", on && !isSel);
      if (on && !isSel) { p.setAttribute("stroke", EDGE_HOT); p.setAttribute("stroke-width", "3"); p.setAttribute("opacity", "1"); }
      else if (!isSel) { p.setAttribute("stroke", /^#[0-9a-f]{6}$/i.test((cur.edges || []).find(e=>e.id===p.dataset.id)?.color || "")?(cur.edges || []).find(e=>e.id===p.dataset.id).color:EDGE_COLOR); p.setAttribute("stroke-width", "2"); p.setAttribute("opacity", ".9"); }
    }
    for (const a of document.querySelectorAll("#mmStage .mm-links path.mm-arrow")) {
      const owner=cur && (cur.edges || []).find(e=>e.id===a.dataset.edge);
      const isHot=owner && (owner.id===id || owner.id===selEdge);
      a.setAttribute("fill",isHot?EDGE_HOT:/^#[0-9a-f]{6}$/i.test(owner?.color || "")?owner.color:EDGE_COLOR);
    }
  }
  const E = (s) => esc(s);
  function draw(transient = false) {
    if (!cur) return;
    if (sel && !selectedNodes.has(sel)) selectedNodes = new Set([sel]);
    selectedNodes = new Set([...selectedNodes].filter(id => findNode(id)));
    if (sel && !selectedNodes.has(sel)) sel = [...selectedNodes].at(-1) || null;
    if (!sel) selectedNodes.clear();
    if (!cur.flat || nodesArr().some(n => n.children && n.children.length)) {
      seedPos();
      const flat = []; for (const r of nodesArr()) walk(r, n => flat.push(n));
      for (const n of flat) { n.children = []; delete n.side; }
      cur.nodes = flat; cur.fold = {}; cur.flat = true; cur.v = 3;
      storeLocal(cur);
    }
    L = layout();
    const th = L.th, st = $("mmStage"), svg = [], html = [], specs=[];
    for (const s of L.nodes.values()) {
      if (s.x == null) continue;
      const n = s.n, d = s.depth, isSel = selectedNodes.has(n.id), hit = found.includes(n.id);
      const paper = cur.theme === 'fresh' && cur.flat;
      const style = paper ? `background:${mix(s.color,th.sub,.32)};color:${th.text};border-color:${mix(s.color,th.sub,.92)};--mm-node-color:${s.color};` : (d === 0 ? `background:${s.color};color:${th.rootText};` : d === 1 ? `background:${mix(s.color, th.sub, .16)};color:${th.text};` : `color:${th.text};background:${th.sub};`) + `border-color:${s.color};--mm-node-color:${s.color};`;
      const prog = n.progress ? `<svg class="mm-prog" viewBox="0 0 16 16" title="${n.progress}%"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" opacity=".25" stroke-width="2"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="${d === 0 ? "currentColor" : s.color}" stroke-width="2.4" stroke-dasharray="${(n.progress / 100) * 40.8} 41" transform="rotate(-90 8 8)" stroke-linecap="round"/></svg>` : "";
      const full=()=>n.pdf?window.MMPDF.element(n.id,n.pdf):(n.image ? `<img class="mm-node-image" src="/api/maps/${encodeURIComponent(cur.id)}/media/${encodeURIComponent(n.image)}?draft=1" alt="${E((cur.media || []).find(m=>m.id===n.image)?.name || "图片")}" draggable="false">` : s.rich ? `<div class="mm-t mm-rich"><div class="mm-rich-inner">${(n.marks || []).length ? `<p>${E(n.marks.map(m => MARK[m] || "").join(""))}</p>` : ""}${window.MMContent.render(n.text)}</div></div>` : `<span class="mm-t">${E(s.lines.join("\n"))}</span>`)
        + `${prog}`
        + ((n.children || []).length && d > 0 || (d === 0 && isFold(n)) ? `<button class="mm-fold${isFold(n) ? " on" : ""} s${s.side}" data-mm="fold" data-id="${n.id}" style="--c:${s.color}" title="${isFold(n) ? "展开" : "收起"}">${isFold(n) ? hidden(n) : "−"}</button>` : "");
      const media=(cur.media || []).find(m=>m.id===(n.image || n.pdf));
      const className=`mm-node d${Math.min(d,2)}${isSel?' sel':''}${hit?' hit':''}${n.bold?' b':''}${n.pdf?' mm-node-pdf':''}`;
      const css=`left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;${style}font:${s.font};line-height:${lineH(d,n.fontSize)}px;padding:${s.padY}px ${s.padX}px;text-align:left;`;
      if(window.MMScene)specs.push({id:n.id,isPDF:!!n.pdf,mediaName:media?.name || "PDF文档",className,style:css,box:s,keep:isSel || editing===n.id,key:JSON.stringify([n.text,n.image,n.pdf,n.marks,n.progress,n.bold,media?.name]),summary:n.pdf?'PDF · '+(media?.name || '文档'):n.image?(media?.name || '图片'):String(n.text || '').split('\n').find(line=>line.trim())?.replace(/^\s*#{1,6}\s+/,'').slice(0,100) || '',full});
      else html.push(`<div class="${className}" data-id="${n.id}" style="${css}">${full()}</div>`);
      if(n.aiEntry && n.aiTurnId){const record=cur.aiMemory?.turns?.find(t=>t.id===n.aiTurnId),status=record?.status || 'completed';
        html.push(window.MMAILearning?.render(s,record) || '');
        html.push(`<button type="button" class="mm-ai-task-badge ${status==='running'?'running':status==='completed'?'complete':'incomplete'}" data-ai-turn="${E(n.aiTurnId)}" title="查看本次提问的方向、参考资料和生成过程" style="left:${s.x}px;top:${s.y-29}px;--ai-chain-color:${E(n.color || '#667e51')}"><span aria-hidden="true">${status==='running'?'◉':status==='completed'?'✓':'○'}</span> ${status==='running'?'生成中':status==='completed'?'查看过程':'未完成 · 查看过程'}</button>`);
      }
      if(n.image){const name=media?.name || (n.pdf?'PDF文档':'图片');html.push(`<button type="button" class="mm-image-label${isSel?' sel':''}" data-image-label="${E(n.id)}" title="${E(name)}" style="left:${s.x}px;top:${s.y-34}px;max-width:${s.w}px;--image-color:${s.color}">${E(name)}</button>`);}
    }
    /* 磁吸点画成**独立覆盖层**（在节点之上、不放进 .mm-node 里）：.mm-node 是 overflow:hidden，
       圆点骑在盒子边线上会被裁掉一半。层本身 pointer-events:none —— 命中在 magnetAt 里按几何算。
       直径要写 val/view.k：#mmStage 整体被 scale(view.k) 放大，写死屏幕像素才"大小恒定"。 */
    const magHtml = [];
    for (const s of L.nodes.values()) {
      if (s.x == null) continue;
      const md = Math.max(4, Math.round(magDia(s) / (view.k || 1)));
      magHtml.push(`<span class="mm-magwrap" data-id="${s.n.id}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px">`
        + MAG_SIDES.map((sd) => `<i class="mm-mag ${sd}" data-side="${sd}" style="width:${md}px;height:${md}px"></i>`).join("") + `</span>`);
    }
    const b = L.bounds, pad = 400;
    /* 预览线（拖磁吸点时那条虚线）与连线同坐标空间：每帧重建，拖动过程中只改它的 innerHTML。 */
    const prevBox = `left:${b.x0 - pad}px;top:${b.y0 - pad}px;width:${b.x1 - b.x0 + pad * 2}px;height:${b.y1 - b.y0 + pad * 2}px" viewBox="${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`;
    const chrome=`<svg class="mm-links" style="${prevBox}">${svg.join("")}${edgeSvg().join("")}</svg><svg class="mm-linkprev" style="${prevBox}"></svg>${html.join("")}${magHtml.join("")}`;
    if(window.MMScene)window.MMScene.render(st,chrome,specs);else st.innerHTML=chrome;
    window.MMGroups?.render();
    window.MMCanvasTools?.render();
    const vw = $("mmView");
    vw.style.background = th.bg; vw.style.setProperty("--grid", th.grid); vw.dataset.theme = cur.theme;
    applyView();
    $("mmTitleIn").value = cur.title;
    toolbarState();
    if (panelOpen) panel();
    if (!transient) window.MMFiles?.onDraw(cur);
  }
  function mix(hex, base, a) {
    const p = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
    try { const x = p(hex), y = p(base); return "rgb(" + x.map((v, i) => Math.round(v * a + y[i] * (1 - a))).join(",") + ")"; } catch (e) { return base; }
  }
  function applyView() { const st = $("mmStage"); if (st){st.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;window.MMScene?.refresh(st);} const z = $("mmZoom"); if (z) z.textContent = Math.round(view.k * 100) + "%"; syncMagSize(); }
  function fit(anim) {
    if (!L) return;
    const vw = $("mmView"), r = vw.getBoundingClientRect(), b = L.bounds, pad = 85;
    const w = Math.max(1,b.x1-b.x0), h = Math.max(1,b.y1-b.y0);
    // Dock clearance is measured in screen pixels, independent of canvas zoom.
    const want = Math.min(Math.max(80,r.width-pad*2)/w,Math.max(80,r.height-pad*2)/h), minK = isMobile() ? 0.6 : 0.2;
    view.k = Math.max(minK, Math.min(1.4, want));
    if (want < minK) {
      // 手机上整张图放不下：不缩得看不清，以中心主题为准，其余的左右拖着看
      const s = L.nodes.get(topNode()?.id); if (!s) { view.x = r.width / 2 - (b.x0+b.x1)/2*view.k; view.y = r.height / 2 - (b.y0+b.y1)/2*view.k; applyView(); return; } const lay = cur.layout;
      const cx = lay === "right" ? s.x + Math.min(r.width / view.k / 2 - 20, (b.x1 - b.x0) / 2) : s.x + s.w / 2, cy = lay === "down" ? s.y + Math.min(r.height / view.k / 2 - 20, (b.y1 - b.y0) / 2) : s.y + s.h / 2;
      view.x = r.width / 2 - cx * view.k; view.y = r.height / 2 - cy * view.k;
    } else { view.x = r.width / 2 - ((b.x0 + b.x1) / 2) * view.k; view.y = r.height / 2 - ((b.y0 + b.y1) / 2) * view.k; }
    if (anim) { const st = $("mmStage"); st.classList.add("anim"); setTimeout(() => st.classList.remove("anim"), 260); }
    applyView();
  }
  // 选中的节点不在屏幕里时挪过去
  function reveal(id) {
    const s = L && L.nodes.get(id); if (!s || s.x == null) return;
    const r = $("mmView").getBoundingClientRect(), m = 30;
    const sx = s.x * view.k + view.x, sy = s.y * view.k + view.y, sw = s.w * view.k, sh = s.h * view.k;
    let dx = 0, dy = 0;
    if (sx < m) dx = m - sx; else if (sx + sw > r.width - m) dx = r.width - m - sx - sw;
    if (sy < m) dy = m - sy; else if (sy + sh > r.height - m) dy = r.height - m - sy - sh;
    if (dx || dy) { view.x += dx; view.y += dy; const st = $("mmStage"); st.classList.add("anim"); applyView(); setTimeout(() => st.classList.remove("anim"), 260); }
  }
  function selectNodes(ids, show) {
    selectedNodes = new Set(ids.filter(id => findNode(id))); sel = [...selectedNodes].at(-1) || null; selEdge = null;
    window.MMGroups?.clearSelection(); window.MMCanvasTools?.clearSelection();
    document.querySelectorAll("#mmStage .mm-node").forEach(el => el.classList.toggle("sel", selectedNodes.has(el.dataset.id)));
    document.querySelectorAll('#mmStage .mm-image-label').forEach(el=>el.classList.toggle('sel',selectedNodes.has(el.dataset.imageLabel)));
    window.MMScene?.refresh($('mmStage'));
    toolbarState(); if (panelOpen) panel(); if (show && sel) reveal(sel);
  }
  function select(id, show) { selectNodes(id ? [id] : [], show); }
  function toolbarState() {
    for (const [id, off] of [["mmSib", !sel], ["mmDel", !sel], ["mmUndo", !hist.length], ["mmRedo", !redo.length], ["mmFold", true]]) { const b = $(id); if (b) b.disabled = off; }
  }
  // Flat nodes: creating a node does not create a hierarchy or an edge.
  function addChild(id, text) {
    const anchor = L && L.nodes.get(id || sel);
    const k = { id: nid(), text: text ?? "", children: [] };
    const at = birthPos(anchor || { x: 0, y: 0, w: 150, h: 40 });
    change(() => { cur.nodes.push(k); putLayerPos(k.id, at); });
    sel = k.id; draw(); reveal(k.id); startEdit(k.id, true); editingNew = k.id;
  }
  function addSibling(id) { addChild(id); }
  function pushAISummary(mapId, sourceId, text) {
    return pushAISummaries(mapId, sourceId, [text])[0];
  }
  function pushAISummaries(mapId, sourceId, texts) {
    if (!cur || cur.id !== mapId || !findNode(sourceId)) throw new Error("提问节点已删除或导图已切换，请重新选择节点。");
    if (!Array.isArray(texts) || !texts.length || texts.length > 12 || texts.some(text => typeof text !== "string" || !text.startsWith("# 第") || text.length > 21000)) throw new Error("请选择1–12个有效的总结节点后推送。");
    endEdit();
    const anchor = L.nodes.get(sourceId);
    if (!anchor) throw new Error("提问节点尚未完成布局，请稍后重试。");
    const prepared = texts.map(text => { const node = { id: nid(), text, children: [] }; return { node, box: measure(node, 0) }; });
    const width = Math.max(...prepared.map(item => item.box.w));
    const occupied = [...L.nodes.values()];
    // Place only this batch in two columns, measuring real content and avoiding
    // both existing nodes and earlier rows; the rest of the canvas stays put.
    let rowY = anchor.y;
    for (let index = 0; index < prepared.length; index += 2) {
      const row = prepared.slice(index, index + 2);
      row.forEach((item, col) => { item.x = anchor.x + anchor.w + 80 + col * (width + 64); });
      while (true) {
        const hits = occupied.filter(s => row.some(item => item.x < s.x+s.w+24 && item.x+item.box.w+24 > s.x && rowY < s.y+s.h+24 && rowY+item.box.h+24 > s.y));
        if (!hits.length) break;
        rowY = Math.max(...hits.map(s => s.y+s.h+32));
      }
      for (const item of row) { item.y = rowY; occupied.push({x:item.x,y:item.y,w:item.box.w,h:item.box.h}); }
      rowY += Math.max(...row.map(item => item.box.h)) + 40;
    }
    // A single change records all nodes and edges as one undo operation.
    change(() => {
      for (const { node, box, x, y } of prepared) {
        cur.nodes.push(node); putLayerPos(node.id, {x,y}); curSize()[node.id] = { w: box.w, h: box.h };
        (cur.edges ||= []).push({ id: eid(), from: { node: node.id, side: "w" }, to: { node: sourceId, side: "e" }, dir: "fwd" });
      }
    });
    const ids = prepared.map(item => item.node.id);
    selectNodes(ids); reveal(ids[0]); return ids;
  }
  function addParent() {}
  function pushAIGraph(mapId, sourceId, summary, texts, mapping = {}) {
    if (!cur || cur.id !== mapId || !findNode(sourceId)) throw new Error("提问节点已删除或导图已切换，请重新选择节点。");
    const plan = window.MMAISummary.normalizeSummary(summary,{allowEmpty:true});
    if (!Array.isArray(texts) || texts.length !== plan.nodes.length || texts.some(t=>typeof t!=="string" || !t.startsWith("# 第") || t.length>21000)) throw new Error("节点正文无效。");
    const graph = window.MMAISummary.layoutGraph(plan, n=>measure({text:texts[plan.nodes.findIndex(v=>v.id===n.id)]},0));
    const known = new Map(plan.nodes.filter(n=>typeof mapping[n.id]==="string" && findNode(mapping[n.id])).map(n=>[n.id,mapping[n.id]]));
    const added = graph.nodes.filter(n=>n.selected && !known.has(n.id));
    if (!added.length) throw new Error("请勾选尚未推送的节点。");
    if(added.some(n=>!n.title.trim() || !n.text.trim()))throw new Error("所选节点的标题和正文不能为空。");
    endEdit();
    const anchor=L.nodes.get(sourceId),previous=graph.nodes.find(n=>known.has(n.id));
    if(!anchor)throw new Error("提问节点尚未完成布局。");
    let dx=anchor.x+anchor.w+80,dy=anchor.y;
    if(previous){const p=L.nodes.get(known.get(previous.id));dx=p.x-previous.x;dy=p.y-previous.y;}
    else {
      // Translate the whole plan, never alter the relative graph layout.
      while(true){const hits=[...L.nodes.values()].filter(s=>added.some(n=>n.x+dx<s.x+s.w+24 && n.x+dx+n.w+24>s.x && n.y+dy<s.y+s.h+24 && n.y+dy+n.h+24>s.y));if(!hits.length)break;dy=Math.max(...hits.map(s=>s.y+s.h+32));}
    }
    const fresh=new Set(added.map(n=>n.id)), all=new Map(known);
    added.forEach(n=>all.set(n.id,nid()));
    change(()=>{
      for(const n of added){const id=all.get(n.id);cur.nodes.push({id,text:texts[plan.nodes.findIndex(v=>v.id===n.id)],children:[]});putLayerPos(id,{x:n.x+dx,y:n.y+dy});curSize()[id]={w:n.w,h:n.h};}
      const edges=cur.edges ||= [];
      for(const e of graph.edges){if(!all.has(e.from) || !all.has(e.to) || !fresh.has(e.from) && !fresh.has(e.to))continue;
        const from=all.get(e.from),to=all.get(e.to),label=window.MMAISummary.relationLabels[e.kind];
        if(!edges.some(v=>v.from.node===from && v.to.node===to && v.label===label))edges.push({id:eid(),from:{node:from,side:"e"},to:{node:to,side:"w"},dir:e.kind==="parallel"?"none":"fwd",label});
      }
      if(!known.size){const entry=added.find(n=>!graph.edges.some(e=>e.to===n.id && fresh.has(e.from))) || added[0];edges.push({id:eid(),from:{node:all.get(entry.id),side:"w"},to:{node:sourceId,side:"e"},dir:"fwd",label:"回应"});}
    });
    const ids=added.map(n=>all.get(n.id));selectNodes(ids);reveal(ids[0]);return ids;
  }
  function pushAIPresentation(mapId,sourceId,summary,entryText,images={},mapping={}){
    if(!cur || cur.id!==mapId || !findNode(sourceId))throw new Error('提问节点已删除或导图已切换');
    if(typeof entryText!=='string' || !entryText.trim() || entryText.length>500)throw new Error('提问入口标题无效');
    const S=window.MMAISummary;
    const graph=S.presentationGraph(summary,entryText,images,n=>measure({text:S.nodeText(n)},0));
    const known=new Map(graph.nodes.filter(n=>typeof mapping[n.id]==='string' && findNode(mapping[n.id])).map(n=>[n.id,mapping[n.id]]));
    const selected=graph.nodes.filter(n=>n.type!=='entry' && n.selected && !known.has(n.id));
    if(!selected.length)throw new Error('请勾选尚未推送的节点');
    if(selected.some(n=>n.type==='text' && (!n.title.trim() || !n.text.trim())))throw new Error('所选节点的标题和正文不能为空');
    for(const n of selected.filter(n=>n.type==='image')){
      if(!known.has(n.imageFor) && !selected.some(t=>t.id===n.imageFor))throw new Error('请同时选择图片对应的文字节点');
      if(typeof n.media.id!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(n.media.id) || n.media.sourceMap!==mapId)throw new Error('配图文件不属于当前导图，请重新生成');
    }
    endEdit();const anchor=L.nodes.get(sourceId);if(!anchor)throw new Error('提问节点尚未完成布局');
    const added=known.has('__entry')?selected:[graph.nodes[0],...selected];
    const previous=graph.nodes.find(n=>known.has(n.id));let dx=anchor.x+anchor.w+80,dy=anchor.y;
    if(previous){const pos=L.nodes.get(known.get(previous.id));dx=pos.x-previous.x;dy=pos.y-previous.y;}
    else while(true){const hits=[...L.nodes.values()].filter(b=>added.some(n=>n.x+dx<b.x+b.w+24 && n.x+dx+n.w+24>b.x && n.y+dy<b.y+b.h+24 && n.y+dy+n.h+24>b.y));if(!hits.length)break;dy=Math.max(...hits.map(b=>b.y+b.h+32));}
    const all=new Map(known),fresh=new Set(added.map(n=>n.id));added.forEach(n=>all.set(n.id,nid()));
    change(()=>{
      for(const n of added){const id=all.get(n.id),node={id,text:n.type==='image'?'':S.nodeText(n),children:[]};
        if(n.type==='image'){node.image=n.media.id;if(!(cur.media ||= []).some(m=>m.id===n.media.id))cur.media.push(clone(n.media));}
        cur.nodes.push(node);putLayerPos(id,{x:n.x+dx,y:n.y+dy});curSize()[id]={w:n.w,h:n.h};
      }
      const edges=cur.edges ||= [];
      function connect(from,to,label,dir='fwd',fromSide='e',toSide='w'){
        if(!edges.some(e=>e.from.node===from && e.to.node===to && e.label===label))edges.push({id:eid(),from:{node:from,side:fromSide},to:{node:to,side:toSide},dir,label});
      }
      for(const e of graph.edges)if(all.has(e.from) && all.has(e.to) && (fresh.has(e.from)||fresh.has(e.to)))connect(all.get(e.from),all.get(e.to),S.relationLabels[e.kind],e.kind==='parallel'?'none':'fwd');
      // A partial selection still has an entry path, even if its preceding step is omitted.
      for(const n of graph.nodes)if(n.type==='text' && all.has(n.id) && !edges.some(e=>e.to.node===all.get(n.id) && [...all.values()].includes(e.from.node)))connect(all.get('__entry'),all.get(n.id),'展开');
      connect(all.get('__entry'),sourceId,'回应','fwd','w','e');
    });
    const ids=added.map(n=>all.get(n.id));selectNodes(ids);reveal(ids[0]);
    return {ids,mapping:Object.fromEntries(all)};
  }
  // Complete streamed nodes join one history operation. Later history snapshots
  // receive only fresh additions, preserving intervening user edits and deletions.
  function appendAIResult(mapId,sourceId,summary,entryText,batch,final=false){
    if(!cur || cur.id!==mapId || !findNode(sourceId))throw new Error('提问节点已删除或导图已切换');
    if(!batch || batch.mapId && (batch.mapId!==mapId || batch.sourceId!==sourceId))throw new Error('生成批次无效');
    if(typeof entryText!=='string' || !entryText.trim() || entryText.length>500)throw new Error('提问入口标题无效');
    const S=window.MMAISummary,plan=S.normalizeSummary(summary,{partial:!final});
    if(!batch.mapping){endEdit();batch.mapping={};batch.mapId=mapId;batch.sourceId=sourceId;
      if(batch.turnId && window.MMAIBranch){batch.color ||= window.MMAIBranch.color(L.nodes.get(sourceId)?.color,(cur.aiMemory?.turns || []).filter(t=>t.sourceId===sourceId).map(t=>t.color),cur.aiMemory?.turns?.length || 0);batch.sourcePort=window.MMAIBranch.port(sourceId,cur.edges || []);}
    }
    const mapping=batch.mapping,anchor=L.nodes.get(sourceId);if(!anchor)throw new Error('提问节点尚未完成布局');
    if(mapping.__entry && !findNode(mapping.__entry))throw new Error('本次提问入口已删除，生成已停止');
    const items=[],occupied=[...L.nodes.values()].flatMap(s=>{
      const record=cur.aiMemory?.turns?.find(t=>t.id===s.n.aiTurnId),b=window.MMAILearning?.box(s,record,true);return b?[s,b]:[s];
    });
    function place(key,text,at){
      const n={id:nid(),text,children:[],...(batch.turnId?{aiTurnId:batch.turnId,aiEntry:key==='__entry',color:batch.color}: {})},box=measure(n,0),p={...at};
      const reserve=n.aiEntry && window.MMAILearning?{w:Math.max(220,box.w),h:box.h+174}:box;
      while(true){const hits=occupied.filter(b=>p.x<b.x+b.w+24 && p.x+reserve.w+24>b.x && p.y<b.y+b.h+24 && p.y+reserve.h+24>b.y);if(!hits.length)break;p.y=Math.max(...hits.map(b=>b.y+b.h+40));}
      mapping[key]=n.id;items.push({node:n,pos:p,size:{w:box.w,h:box.h}});const result={x:p.x,y:p.y,w:box.w,h:box.h};occupied.push({...result,...reserve});return result;
    }
    const boxOf=key=>{const id=mapping[key],n=items.find(v=>v.node.id===id);return n?{...n.pos,...n.size}:L.nodes.get(id);};
    if(!mapping.__entry){const box=measure({text:'# '+entryText},0),side=batch.sourcePort?.side;
      const at=side==='s'?{x:anchor.x,y:anchor.y+anchor.h+100}:side==='n'?{x:anchor.x,y:anchor.y-box.h-100}:side==='w'?{x:anchor.x-box.w-100,y:anchor.y}:{x:anchor.x+anchor.w+100,y:anchor.y};place('__entry','# '+entryText,at);
    }
    for(const n of plan.nodes){
      if(mapping[n.id])continue; // A user-deleted generated node stays deleted.
      const parent=plan.edges.find(e=>e.to===n.id && boxOf(e.from)),base=parent?boxOf(parent.from):boxOf('__entry');
      place(n.id,S.nodeText(n),{x:base.x+base.w+110,y:base.y});
    }
    const exists=id=>items.some(v=>v.node.id===id) || !!findNode(id),edges=[];
    function connect(from,to,label,dir='fwd',fromSide='e',toSide='w',fixed=null){
      if(!from || !to || !exists(from) || !exists(to))return;
      if(!(cur.edges || []).some(e=>e.from.node===from && e.to.node===to && e.label===label)){
        const all=[...(cur.edges || []),...edges],B=batch.turnId && window.MMAIBranch;
        const a=fixed || (B?B.port(from,all,[fromSide,...['e','s','n','w'].filter(s=>s!==fromSide)]):{side:fromSide}),b=B?B.port(to,all,[toSide,...['w','n','s','e'].filter(s=>s!==toSide)]):{side:toSide};
        edges.push({id:eid(),from:{node:from,...a},to:{node:to,...b},dir,label,...(batch.color?{color:batch.color}: {})});
      }
    }
    if(batch.turnId)connect(sourceId,mapping.__entry,'提问','fwd',batch.sourcePort?.side || 'e',({e:'w',w:'e',s:'n',n:'s'})[batch.sourcePort?.side] || 'w',batch.sourcePort);else connect(mapping.__entry,sourceId,'回应','fwd','w','e');
    for(const e of plan.edges)connect(mapping[e.from],mapping[e.to],S.relationLabels[e.kind],e.kind==='parallel'?'none':'fwd');
    if(final){for(const n of plan.nodes)if(!plan.edges.some(e=>e.to===n.id))connect(mapping.__entry,mapping[n.id],'展开');}
    else if(plan.nodes[0])connect(mapping.__entry,mapping[plan.nodes[0].id],'展开');
    if(!items.length && !edges.length)return {ids:[],mapping};
    function apply(map,current=false){
      for(const v of items){map.nodes.push(clone(v.node));if(current)putLayerPos(v.node.id,clone(v.pos));else (map.pos ||= {})[v.node.id]=clone(v.pos);(map.size ||= {})[v.node.id]=clone(v.size);}
      const live=new Set(map.nodes.map(n=>n.id));
      for(const e of edges)if(live.has(e.from.node) && live.has(e.to.node))(map.edges ||= []).push(clone(e));
    }
    if(!batch.before){batch.before=historyJSON();batch.historyIndex=hist.length;aiBatches.add(batch);change(()=>apply(cur,true));const focus=mapping[plan.nodes[0].id];selectNodes([focus]);reveal(focus);}
    else{
      const start=Math.max(0,batch.historyIndex+1);
      for(let i=start;i<hist.length;i++){const snapshot=JSON.parse(hist[i]);apply(snapshot);hist[i]=JSON.stringify(snapshot);}
      redo=[];apply(cur,true);storeLocal(cur);scheduleCloud();draw();
    }
    if(final)aiBatches.delete(batch);return {ids:items.map(v=>v.node.id),mapping};
  }
  function del(id) {
    const ids = id ? [id] : [...selectedNodes]; if (!ids.length) return;
    const remove = new Set(ids);
    change(() => { cur.nodes = cur.nodes.filter(n => !remove.has(n.id)); dropLayer(ids); dropEdges(ids); sel = null; selectedNodes.clear(); });
  }
  function moveSib() {}
  function toggleFold() {}
  function foldLevel() {}

  function setProp(k, v) { const nodes = [...selectedNodes].map(id => findNode(id)?.n).filter(Boolean); if (!nodes.length) return; change(() => { for (const n of nodes) { if (v === undefined || v === "" || v === false || v === null) delete n[k]; else n[k] = clone(v); } }); }
  function toggleMark(m) {
    const r = findNode(sel); if (!r) return;
    change(() => {
      for (const id of selectedNodes) { const n = findNode(id)?.n; if (!n) continue;
      let a = (n.marks || []).slice();
      if (selectedNodes.size === 1 && a.includes(m)) a = a.filter((x) => x !== m);
      else { if (/^p\d$/.test(m)) a = a.filter((x) => !/^p\d$/.test(x)); a.unshift(m); }
      if (a.length) n.marks = [...new Set(a)]; else delete n.marks;
      }
    });
  }
  const NODE_CLIP_TYPE="application/x-laolao-node+json";
  function copySel(cut,event) {
    const groupId=window.MMGroups?.state().selected, group=(cur.groups || []).find(g=>g.id===groupId);
    const members=group?window.MMGroups.members(group):null;
    const ids=new Set(group?members.nodes:selectedNodes), groupIds=new Set(group?[group.id,...members.groups]:[]);
    if(!ids.size && !groupIds.size)return;
    const nodes=cur.nodes.filter(n=>ids.has(n.id)).map(n=>({...clone(n),children:[]}));
    const layers={};for(const name of LAYER_MAPS)layers[name]=Object.fromEntries([...ids].filter(id=>cur[name]?.[id]!==undefined).map(id=>[id,clone(cur[name][id])]));
    const images=new Set(nodes.map(n=>n.image || n.pdf).filter(Boolean));
    clip={version:2,nodes,layers,edges:clone((cur.edges || []).filter(e=>ids.has(e.from.node)&&ids.has(e.to.node))),groups:clone((cur.groups || []).filter(g=>groupIds.has(g.id))),media:clone((cur.media || []).filter(m=>images.has(m.id))),sourceMap:cur.id};
    clip.text=nodes.map(n=>n.text || '').join('\n\n') || group?.title || '';
    // Keep the original one-node payload readable by older app versions.
    if(nodes.length===1){clip.node=nodes[0];clip.size=clone(curSize()[nodes[0].id] || {});}
    if(!event?.clipboardData)return;
    event.clipboardData.setData('text/plain',clip.text);
    try{event.clipboardData.setData(NODE_CLIP_TYPE,JSON.stringify(clip));}catch{}
    event.preventDefault();
    if(cut){change(()=>{cur.nodes=cur.nodes.filter(n=>!ids.has(n.id));dropLayer(ids);dropEdges(ids);cur.groups=(cur.groups || []).filter(g=>!groupIds.has(g.id));sel=null;selectedNodes.clear();window.MMGroups?.clearSelection();});}
    else tip(group?'已复制分组及内容，Ctrl+V 粘贴':'已复制 '+nodes.length+' 个节点，Ctrl+V 粘贴',1600);
  }
  function pasteSelection(payload) {
    if(!Array.isArray(payload.nodes) || !payload.layers)return;
    const original=payload.nodes.filter(n=>n && typeof n.id==='string' && typeof n.text==='string');
    const copiedGroups=(payload.groups || []).filter(g=>g && [g.x,g.y,g.w,g.h].every(Number.isFinite));
    if(!original.length && !copiedGroups.length)return;
    const nodeIds=new Map(original.map(n=>[n.id,nid()])),groupIds=new Map(copiedGroups.map(g=>[g.id,eid()]));
    const nodes=original.map(n=>fill({...clone(n),id:nodeIds.get(n.id),children:[]}));
    const boxes=original.map(n=>{const p=payload.layers.pos?.[n.id] || {x:0,y:0},z=payload.layers.size?.[n.id] || measure(n,1);return {...p,w:z.w,h:z.h};}).concat(copiedGroups);
    const bounds={x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y))};bounds.w=Math.max(...boxes.map(b=>b.x+b.w))-bounds.x;bounds.h=Math.max(...boxes.map(b=>b.y+b.h))-bounds.y;
    const frame=(cur.groups || []).find(g=>g.id===window.MMGroups?.state().selected),anchor=frame || L?.nodes.get(sel) || bounds;
    const at={x:anchor.x+anchor.w+60,y:anchor.y};
    const occupied=[...(L?.nodes.values() || []),...(cur.groups || [])];
    for(;;){const hits=occupied.filter(b=>at.x<b.x+b.w+24 && at.x+bounds.w+24>b.x && at.y<b.y+b.h+24 && at.y+bounds.h+24>b.y);if(!hits.length)break;at.y=Math.max(...hits.map(b=>b.y+b.h+30));}
    const dx=at.x-bounds.x,dy=at.y-bounds.y;
    change(()=>{
      cur.nodes.push(...nodes);
      for(const name of LAYER_MAPS){const target=(cur[name] ||= {});for(const [old,id] of nodeIds){const value=payload.layers[name]?.[old];if(value!==undefined)target[id]=clone(value);}}
      for(const [old,id] of nodeIds){const p=payload.layers.pos?.[old] || {x:0,y:0};putLayerPos(id,{x:p.x+dx,y:p.y+dy});}
      for(const edge of payload.edges || [])if(nodeIds.has(edge.from?.node)&&nodeIds.has(edge.to?.node))(cur.edges ||= []).push({...clone(edge),id:eid(),from:{...edge.from,node:nodeIds.get(edge.from.node)},to:{...edge.to,node:nodeIds.get(edge.to.node)}});
      (cur.groups ||= []).push(...copiedGroups.map(g=>({...clone(g),id:groupIds.get(g.id),x:g.x+dx,y:g.y+dy})));
      const images=new Set(nodes.map(n=>n.image || n.pdf).filter(Boolean));
      for(const media of payload.media || [])if(images.has(media.id)&&!(cur.media || []).some(m=>m.id===media.id))(cur.media ||= []).push({...clone(media),sourceMap:media.sourceMap || payload.sourceMap});
    });
    if(copiedGroups.length){const outer=[...copiedGroups].sort((a,b)=>b.w*b.h-a.w*a.h)[0];window.MMGroups.select(groupIds.get(outer.id));}
    else selectNodes(nodes.map(n=>n.id));
    window.Mindmap.revealBox({...at,w:bounds.w,h:bounds.h});
    if(nodes.some(n=>n.image || n.pdf) && window.MMFiles){const map=cur;window.MMFiles.flush(map).then(()=>{if(cur===map){draw();return window.MMFiles.refresh();}}).catch(error=>tip(error.message));}
  }
  function pasteNode(payload) {
    if(!payload?.node || typeof payload.node.text!=="string")return;
    const node=fill({...clone(payload.node),id:nid(),children:[]}),anchor=L?.nodes.get(sel) || {x:0,y:0,w:150,h:40}, measured=measure(node,1);
    const size=payload.size && Number.isFinite(payload.size.w) && Number.isFinite(payload.size.h)?clampSize(payload.size.w,payload.size.h,measured.w,measured.h):{w:measured.w,h:measured.h};
    const at={x:anchor.x+anchor.w+70,y:anchor.y};
    const occupied=[...(L?.nodes.values() || [])];
    for(;;) {const hits=occupied.filter(s=>at.x<s.x+s.w+24 && at.x+size.w+24>s.x && at.y<s.y+s.h+24 && at.y+size.h+24>s.y);if(!hits.length)break;at.y=Math.max(...hits.map(s=>s.y+s.h+30));}
    change(()=>{cur.nodes.push(node);putLayerPos(node.id,at);curSize()[node.id]=size;
      if(node.image || node.pdf){for(const media of payload.media || [])if(media.id===(node.image || node.pdf) && !(cur.media || []).some(m=>m.id===media.id))(cur.media ||= []).push({...media,sourceMap:media.sourceMap || payload.sourceMap});}
    });select(node.id,true);
    if((node.image || node.pdf) && window.MMFiles) {const mapId=cur.id;window.MMFiles.flush(cur).then(()=>{if(cur?.id===mapId)draw();}).catch(error=>tip(error.message));}
  }
  function pasteTo(id, text) {
    const r = findNode(id || sel); if (!r) return;
    let items = null;
    if (text && /\S/.test(text)) { const t = parseText(text); items = t.isRootOnly ? [t.root] : t.root.children.length && t.fromTitle ? t.root.children : [t.root]; }
    else if (clip) items = clone(clip.nodes || [clip.node]);
    if (!items || !items.length) return;
    const fresh = items.map((n) => { walk(n, (x) => { x.id = nid(); }); return fill(n); });
    const flat = []; for (const n of fresh) walk(n, x => flat.push(x));
    for (const n of flat) n.children = [];
    change(() => { cur.nodes.push(...flat); });
    select(fresh[0].id, true);
  }

  // 改字：节点上面盖一个输入框
  function startEdit(id, selectAll, initial) {
    const s = L && L.nodes.get(id); if (!s || s.x == null) return;
    endEdit(true);
    select(id); editing = id; editingNew = null;
    // 手机上图缩得太小时：先放大到正常大小再改字
    if (isMobile() && view.k < 0.95) { const r = $("mmView").getBoundingClientRect(); view.k = 1; view.x = r.width / 2 - (s.x + s.w / 2); view.y = Math.min(r.height * 0.35, r.height / 2) - (s.y + s.h / 2); applyView(); }
    const el = document.querySelector(`#mmStage .mm-node[data-id="${id}"]`); if (!el) return;
    const ta = document.createElement("textarea");
    ta.className = "mm-edit"; ta.value = initial != null ? initial : s.n.text; ta.spellcheck = false;
    ta.style.cssText = `left:${s.x}px;top:${s.y}px;min-width:${Math.max(s.w, 80)}px;min-height:${s.h}px;font:${s.font};line-height:${lineH(s.depth)}px;padding:${s.padY}px ${s.padX}px;`;
    $("mmStage").appendChild(ta);
    const formatbar=window.MMFormat?.mount(id,ta);
    const preview = window.MMContent ? document.createElement("div") : null;
    const help = window.MMContent ? document.createElement("div") : null;
    if (preview) {
      preview.className = "mm-edit-preview"; help.className = "mm-edit-help";
      help.textContent = "Enter 换行 · Ctrl+Enter 保存 · Esc 取消 · Tab 补全 / 下一项 · Shift+Tab 上一项";
      preview.addEventListener("pointerdown", e => e.preventDefault()); help.addEventListener("pointerdown", e => e.preventDefault());
      $("mmStage").appendChild(preview); $("mmStage").appendChild(help);
    }
    const grow = () => {
      const r = $("mmView").getBoundingClientRect(), k = view.k || 1;
      const available = Math.max(160, (r.width - 32) / k), stacked = available < 450;
      const width = Math.min(360, stacked ? available : (available - 16) / 2);
      const totalWidth = stacked ? width : width * 2 + 16;
      if(formatbar)formatbar.style.width=totalWidth+'px';const barHeight=formatbar?formatbar.offsetHeight+8:0;
      const maxHeight = Math.max(90, Math.min(360, ((r.height - 112) / k-barHeight) / (stacked ? 2 : 1)));
      const x = Math.max((16 - view.x) / k, Math.min(s.x, (r.width - 16 - view.x) / k - totalWidth));
      const top = Math.max((16 - view.y) / k, Math.min(s.y, (r.height - 64 - view.y) / k - maxHeight * (stacked ? 2 : 1)-barHeight)),y=top+barHeight;
      if(formatbar){formatbar.style.left=x+'px';formatbar.style.top=top+'px';}
      if(ta._nodeStyle){ta.style.fontSize=ta._nodeStyle.fontSize+'px';ta.style.lineHeight=ta._nodeStyle.fontSize*1.5+'px';}
      ta.style.left = x + "px"; ta.style.top = y + "px";
      ta.style.minWidth = "0"; ta.style.minHeight = "0"; ta.style.width = width + "px";
      ta.style.height = "auto"; ta.style.height = Math.min(maxHeight, Math.max(s.h, ta.scrollHeight, 140)) + "px";
      if (preview) {
        const active = window.MMContent.completionStatus(ta);
        help.textContent = active ? `${active.label}：第 ${active.index}/${active.total} 项 · ${active.field} · Tab 下一项 / Shift+Tab 上一项` : "Enter 换行 · Ctrl+Enter 保存 · Esc 取消 · Tab 补全 / 下一项 · Shift+Tab 上一项";
        help.style.width = totalWidth + "px"; help.style.whiteSpace = "normal";
        preview.innerHTML = `<div class="mm-edit-preview-title">实时预览</div><div class="mm-rich">${window.MMContent.render(ta.value)}</div>`;
        if(ta._nodeStyle)preview.querySelector('.mm-rich').style.fontSize=ta._nodeStyle.fontSize+'px';
        preview.style.width = width + "px"; preview.style.maxHeight = maxHeight + "px";
        preview.style.left = (stacked ? x : x + width + 16) + "px";
        preview.style.top = (stacked ? y + maxHeight + 12 : y) + "px";
        help.style.left = x + "px"; help.style.top = y + maxHeight * (stacked ? 2 : 1) + (stacked ? 18 : 6) + "px";
      }
    };
    ta.addEventListener("input", grow);
    window.addEventListener("resize", grow);
    ta._resizeHandler = grow;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); endEdit(); }
      else if (e.key === "Tab" && !e.isComposing) {
        e.preventDefault();
        if (!window.MMContent || !window.MMContent.handleTab(ta,e.shiftKey)) {
          if (!e.shiftKey) ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        }
        grow();
      }
      else if (e.key === "Escape") { e.preventDefault(); endEdit(true); }
      e.stopPropagation();
    });
    ta.addEventListener("blur", () => setTimeout(() => {
      // A removed editor can blur after a new editor opens on the same node.
      if (editing === id && document.querySelector("#mmStage .mm-edit") === ta && document.activeElement !== ta && !document.activeElement.closest("#mmShortcuts,#mmDlg,.mm-formatbar")) endEdit();
    }, 0));
    grow(); ta.focus();
    if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function endEdit(cancel) {
    const ta = document.querySelector("#mmStage .mm-edit"); if (!ta) { editing = null; return; }
    const id = editing, v = ta.value, fresh = editingNew === id, draftStyle=ta._nodeStyle;
    if (ta._resizeHandler) window.removeEventListener("resize", ta._resizeHandler);
    editing = null; editingNew = null; ta.remove();
    document.querySelectorAll("#mmStage .mm-edit-preview, #mmStage .mm-edit-help,#mmStage .mm-formatbar").forEach(el => el.remove());
    // 刚新建的主题按 Esc：等于没建（撤销掉那一步）
    if (cancel && fresh && hist.length) { const back = topNode() ? topNode().id : null; redo = []; restoreHistory(hist.pop()); sel = findNode(back) ? back : (topNode() ? topNode().id : null); storeLocal(cur); scheduleCloud(); draw(); $("mmView").focus({ preventScroll: true }); return; }
    const r = findNode(id);
    if (!cancel && r && (v !== r.n.text || draftStyle && JSON.stringify(window.MMFormat.style(r.n))!==JSON.stringify(draftStyle))) change(() => {
      r.n.text = v;
      if(draftStyle)window.MMFormat.apply(r.n,draftStyle);
      fitNode(id);
    });
    else draw();
    $("mmView").focus({ preventScroll: true });
  }

  // ---------------- 文字 ↔ 导图 ----------------
  function toText(n, d) { return "  ".repeat(d) + (d ? "- " : "") + (n.text || "").replace(/\n/g, " ") + "\n" + (n.children || []).map((c) => toText(c, d + 1)).join(""); }
  function toMarkdown(n) {
    const out = [];
    (function w(x, d) {
      const pre = (x.marks || []).map((m) => MARK[m]).join("");
      const t = (pre ? pre + " " : "") + (x.text || "").replace(/\n/g, " ") + (x.progress ? `（${x.progress}%）` : "") + (x.link ? ` [链接](${x.link})` : "");
      if (d <= 2) out.push("#".repeat(d + 1) + " " + t); else out.push("  ".repeat(d - 3) + "- " + t);
      if (x.note) out.push((d <= 2 ? "" : "  ".repeat(d - 2)) + "> " + x.note.replace(/\n/g, " "));
      for (const c of x.children || []) w(c, d + 1);
    })(n, 0);
    return out.join("\n") + "\n";
  }
  // 粘贴的文字（AI 回答、Markdown、缩进列表、1. 1.1 编号…）→ 一棵树
  function parseText(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").map((l) => l.replace(/\t/g, "    ")).filter((l) => l.trim() && !/^\s*(```|---+|\*\*\*+|___+)\s*$/.test(l));
    const items = [];
    for (const raw of lines) {
      const ind = raw.match(/^\s*/)[0].length;
      let t = raw.trim(), lv;
      let m;
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { lv = m[1].length - 1; t = m[2]; items.push({ head: true, lv, t }); continue; }
      if ((m = t.match(/^(\d+(?:\.\d+)+)[.、)]?\s+(.*)$/))) { items.push({ num: m[1].split(".").length, ind, t: m[2] }); continue; }
      if ((m = t.match(/^(?:[-*+•·]|\d+[.、)]|[（(]?\d+[)）]|[一二三四五六七八九十]+[、.]|[a-zA-Z][.)])\s*(.*)$/)) && m[1] !== undefined && t !== m[1]) { items.push({ bullet: true, ind, t: m[1] }); continue; }
      items.push({ plain: true, ind, t });
    }
    const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^\s*[:：]\s*/, "").trim();
    // 层级：标题按 # 个数；标题下面的列表按缩进再往下；没有标题时按缩进
    const hasHead = items.some((x) => x.head), heads = items.filter((x) => x.head).map((x) => x.lv), minH = heads.length ? Math.min(...heads) : 0;
    const indents = [...new Set(items.filter((x) => !x.head).map((x) => x.ind))].sort((a, b) => a - b);
    let lastHead = -1;
    const flat = [];
    for (const x of items) {
      let d;
      if (x.head) { d = x.lv - minH; lastHead = d; }
      else if (x.num) d = (hasHead ? lastHead + 1 : 0) + x.num - 1;
      else d = (hasHead ? lastHead + 1 : 0) + indents.indexOf(x.ind);
      const t = clean(x.t); if (!t) continue;
      flat.push({ d, t, bold: /^\*\*.+\*\*$/.test(x.t.trim()) });
    }
    if (!flat.length) return { root: { id: nid(), text: "", children: [] }, isRootOnly: true };
    // 只有一个最上层（比如一个 # 标题）→ 它就是中心主题
    const top = flat.filter((x) => x.d === Math.min(...flat.map((y) => y.d)));
    let root, fromTitle = false;
    if (top.length === 1 && flat[0] === top[0]) { root = { id: nid(), text: flat[0].t, children: [] }; flat.shift(); }
    else { root = { id: nid(), text: "", children: [] }; fromTitle = true; }
    const base = flat.length ? Math.min(...flat.map((x) => x.d)) : 0;
    const stack = [{ n: root, d: -1 }];
    for (const x of flat) {
      const d = x.d - base;
      while (stack.length > 1 && stack[stack.length - 1].d >= d) stack.pop();
      const n = { id: nid(), text: x.t.slice(0, 500), children: [] };
      stack[stack.length - 1].n.children.push(n);
      stack.push({ n, d });
    }
    return { root, fromTitle, isRootOnly: !root.children.length && !fromTitle };
  }

  // ---------------- 导出 ----------------
  function download(name, data, type) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const safeName = () => (cur.title || "思维导图").replace(/[\\/:*?"<>|\n]/g, "_").slice(0, 40);
  async function exportPng() {
    if (window.htmlToImage && window.MMContent) {
      let wrapper;
      try {
        endEdit();
        await window.MMPDF?.prepareExport();
        await document.fonts.ready;
        const lay = layout(), b = lay.bounds, pad = 48, width = Math.ceil(b.x1 - b.x0 + pad * 2), height = Math.ceil(b.y1 - b.y0 + pad * 2 + 30);
        wrapper = document.createElement("div");
        wrapper.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;background:${lay.th.bg};overflow:hidden;`;
        const stage = $("mmStage").cloneNode(true);
        window.MMScene?.exportContent(stage);
        stage.style.transform = `translate(${pad - b.x0}px,${pad - b.y0}px)`; stage.style.left = "0"; stage.style.top = "0";
        stage.classList.remove("anim");
        stage.querySelectorAll(".mm-magwrap,.mm-linkprev,.mm-edit,.mm-edit-preview,.mm-edit-help,.mm-formatbar,.ghost,[data-preview],.mm-mark-hit,.mm-group-handle").forEach(el => el.remove());
        stage.querySelectorAll(".mm-mark.selected,.mm-group-frame.selected,.mm-group-label.selected").forEach(el=>el.classList.remove("selected"));
        stage.querySelectorAll(".sel,.hot,.hit").forEach(el => { el.classList.remove("sel","hot","hit"); });
        stage.querySelectorAll(".mm-edge").forEach(el => {el.setAttribute("stroke", EDGE_COLOR);el.setAttribute("stroke-width","2");});
        stage.querySelectorAll(".mm-arrow").forEach(el => el.setAttribute("fill", EDGE_COLOR));
        wrapper.appendChild(stage); document.body.appendChild(wrapper);
        // Exclude logical inset/size aliases: copying both aliases and physical styles
        // can retain the offscreen position when the SVG clone is moved to its origin.
        const includeStyleProperties = Array.from(getComputedStyle(wrapper)).filter(name => !/^(inset|block-size|inline-size|(?:min|max)-(?:block|inline)-size|(?:margin|padding|border)-(?:block|inline)|position-visibility)/.test(name));
        const canvas = await window.htmlToImage.toCanvas(wrapper, { width, height, pixelRatio: Math.min(2, 8000 / Math.max(width,height)), preferredFontFormat:"woff2", includeStyleProperties, backgroundColor:lay.th.bg, style:{ position:"relative",left:"0",top:"0",right:"auto",bottom:"auto" } });
        canvas.toBlob(blob => { if (blob) download(safeName()+".png",blob); else tip("图片导出失败"); },"image/png");
      } catch (e) { console.error("PNG 导出失败",e); tip("图片导出失败，请缩小导图后重试"); }
      finally { if (wrapper) wrapper.remove(); }
      return;
    }
    const lay = layout(), th = lay.th, b = lay.bounds, pad = 48, sc = Math.min(2, 8000 / Math.max(b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2));
    const W = Math.ceil((b.x1 - b.x0 + pad * 2) * sc), H = Math.ceil((b.y1 - b.y0 + pad * 2 + 30) * sc);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.scale(sc, sc); g.fillStyle = th.bg; g.fillRect(0, 0, W, H);
    g.translate(pad - b.x0, pad - b.y0);
    for (const e of cur.edges || []) {
      const a = lay.nodes.get(e.from.node), b = lay.nodes.get(e.to.node); if (!a || !b) continue;
      const routed = window.MMEdgeRouter.route(a, b, e), p = routed.points;
      g.strokeStyle = EDGE_COLOR; g.lineWidth = 2; g.lineCap = "round"; g.stroke(new Path2D(routed.path));
      const arrow = (tip, prev) => {
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x), c = Math.cos(angle), sn = Math.sin(angle);
        g.beginPath(); g.moveTo(tip.x, tip.y);
        g.lineTo(tip.x - ARROW * c - ARROW * .45 * sn, tip.y - ARROW * sn + ARROW * .45 * c);
        g.lineTo(tip.x - ARROW * c + ARROW * .45 * sn, tip.y - ARROW * sn - ARROW * .45 * c);
        g.closePath(); g.fillStyle = EDGE_COLOR; g.fill();
      };
      const dir = e.dir || "fwd";
      if (dir === "fwd" || dir === "both") arrow(p[p.length - 1], p[p.length - 2]);
      if (dir === "rev" || dir === "both") arrow(p[0], p[1]);
    }
    g.globalAlpha = 1;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    for (const s of lay.nodes.values()) {
      if (s.x == null) continue;
      const d = s.depth, n = s.n;
      rr(s.x, s.y, s.w, s.h, d === 0 ? 14 : d === 1 ? 10 : 8);
      const paper = cur.theme === 'fresh' && cur.flat;
      g.fillStyle = paper ? mix(s.color,th.sub,.32) : d === 0 ? s.color : d === 1 ? mix(s.color, th.sub, .16) : th.sub; g.fill();
      if (d > 0) { g.strokeStyle = paper ? mix(s.color,th.sub,.92) : d === 1 ? s.color : mix(s.color, th.sub, .55); g.lineWidth = paper ? 1 : d === 1 ? 1.6 : 1.2; g.stroke(); }
      g.fillStyle = d === 0 ? th.rootText : th.text; g.font = s.font; g.textBaseline = "middle";
      s.lines.forEach((l, i) => g.fillText(l, s.x + s.padX, s.y + s.padY + lineH(d) * (i + .5)));
      let ix = s.x + s.w - s.padX - (n.note ? 18 : 0) - (n.link ? 18 : 0) - (n.progress ? 20 : 0);
      g.font = `12px ${FONT}`;
      if (n.progress) { g.beginPath(); g.arc(ix + 9, s.y + s.h / 2, 6.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * n.progress / 100); g.strokeStyle = d === 0 ? th.rootText : s.color; g.lineWidth = 2.4; g.stroke(); ix += 20; }
      if (n.note) { g.fillText("📝", ix, s.y + s.h / 2); ix += 18; }
      if (n.link) g.fillText("🔗", ix, s.y + s.h / 2);
      if (isFold(n) && (n.children || []).length) { const fx = s.side < 0 ? s.x - 10 : s.side > 0 ? s.x + s.w + 10 : s.x + s.w / 2, fy = s.side === 0 ? s.y + s.h + 10 : s.y + s.h / 2; g.beginPath(); g.arc(fx, fy, 9, 0, Math.PI * 2); g.fillStyle = th.sub; g.fill(); g.strokeStyle = s.color; g.lineWidth = 1.5; g.stroke(); g.fillStyle = s.color; g.font = `700 10px ${FONT}`; g.textAlign = "center"; g.fillText(String(hidden(n)), fx, fy + .5); g.textAlign = "left"; }
    }
    g.setTransform(sc, 0, 0, sc, 0, 0); g.font = `12px ${FONT}`; g.fillStyle = th.text; g.globalAlpha = .45; g.textBaseline = "alphabetic";
    g.fillText("捞捞思维导图 · laolaokechengbiao.cn", pad, b.y1 - b.y0 + pad * 2 + 14);
    c.toBlob((blob) => { if (blob) download(safeName() + ".png", blob); else tip("图片太大了，先收起一些分支再导出"); }, "image/png");
  }

  // ---------------- 界面：列表 ----------------
  function homePreview(entry) {
    const map=lsGet(mapKey(entry.id),null), nodes=Array.isArray(map?.nodes)?map.nodes:map?.root?[map.root]:[];
    const boxes=nodes.slice(0,60).map((n,i)=>({id:n.id,x:Number.isFinite(map?.pos?.[n.id]?.x)?map.pos[n.id].x:i%4*180,y:Number.isFinite(map?.pos?.[n.id]?.y)?map.pos[n.id].y:Math.floor(i/4)*110,w:Math.max(50,Number(map?.size?.[n.id]?.w)||140),h:Math.max(30,Number(map?.size?.[n.id]?.h)||70),color:/^#[0-9a-f]{6}$/i.test(n.color || '')?n.color:'#77885e'}));
    if(!boxes.length)return '<span class="mc-preview-empty">从一个想法开始</span>';
    const x0=Math.min(...boxes.map(b=>b.x)),y0=Math.min(...boxes.map(b=>b.y)),w=Math.max(...boxes.map(b=>b.x+b.w))-x0,h=Math.max(...boxes.map(b=>b.y+b.h))-y0,k=Math.min(274/(w+60),114/(h+40));
    const X=x=>(300-w*k)/2+(x-x0)*k,Y=y=>(142-h*k)/2+(y-y0)*k,byId=new Map(boxes.map(b=>[b.id,b]));
    const lines=(map?.edges || []).slice(0,90).map(edge=>{const a=byId.get(edge.from?.node),b=byId.get(edge.to?.node);return a&&b?`<path d="M${X(a.x+a.w/2)} ${Y(a.y+a.h/2)} L${X(b.x+b.w/2)} ${Y(b.y+b.h/2)}"/>`:'';}).join('');
    return `<svg viewBox="0 0 300 142" aria-hidden="true"><g class="mc-preview-lines">${lines}</g>${boxes.map(b=>`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${b.w*k}" height="${b.h*k}" rx="${Math.min(5,b.h*k/5)}" fill="${b.color}" fill-opacity=".32" stroke="${b.color}" stroke-opacity=".92"/>`).join('')}</svg>`;
  }
  function listHtml() {
    const kw = listQ.trim().toLowerCase();
    const items = index.filter((e) => !me() || !e.uid || e.uid === me().id).filter((e) => !kw || String(e.title).toLowerCase().includes(kw));
    return `<section class="mm-home-hero"><div><span class="mm-home-eyebrow">捞捞 / 学习书桌</span><h1>给知识一点<br>生长的空间。</h1><p>把公式、想法与资料铺在一起，<br>慢慢连成自己的理解。</p><button type="button" class="mm-b pri mm-home-create" data-mm="new" data-tpl="blank"><span aria-hidden="true">＋</span> 新建空白导图 <span aria-hidden="true">↗</span></button></div><div class="mm-home-art" aria-hidden="true"><span class="mm-art-kicker">从记录，到理解</span><span class="mm-art-line one"></span><span class="mm-art-line two"></span><span class="mm-art-note one">一个想法<small>让思考发生</small></span><span class="mm-art-note two">一种联系<small>把知识连接起来</small></span><span class="mm-art-note three">自己的理解<small>慢慢积累，逐渐清晰</small></span><span class="mm-art-footer">A LITTLE ROOM FOR THINKING</span></div></section>
      <section class="mm-home-library" aria-label="我的导图"><div class="mm-library-head"><div class="mm-sec"><b>我的导图</b><span>${items.length} 张${kw?'匹配':''} · 保存在本机</span></div><input id="mmListQ" class="mm-search" type="search" aria-label="搜索导图" placeholder="搜索导图名称…" value="${E(listQ)}" maxlength="40"></div>
      ${items.length ? `<div class="mm-cards">${items.map(e=>`<div class="mm-card" data-mm="open" data-id="${E(e.id)}" tabindex="0" role="button" aria-label="打开 ${E(e.title)}"><div class="mc-preview">${homePreview(e)}<span class="mc-open-hint">打开导图 ↗</span></div><div class="mc-details"><div class="mc-top"><b>${E(e.title)}</b><button type="button" class="mm-more" data-mm="menu" data-id="${E(e.id)}" aria-label="更多：${E(e.title)}">⋯</button></div><div class="mc-meta">${e.nodes || 1} 个节点 <span>·</span> ${when(e.updated)}</div>${e.fileMissing || e.hasDraft?`<span class="mc-draft">${e.fileMissing?'文件已移除，草稿已保留':'有未保存草稿'}</span>`:''}</div></div>`).join('')}</div>`:`<div class="mm-empty"><span class="mm-empty-mark" aria-hidden="true">${kw?'⌕':'＋'}</span><b>${kw?'没有找到这张导图':'你的第一张导图，从这里开始'}</b><p>${kw?'试试其他名称，或清空搜索框。':'新建一张空白导图，或导入你已有的笔记。'}</p></div>`}</section>
      <section class="mm-home-start" aria-label="创建导图"><div class="mm-home-import"><span>已经有内容了？</span><button type="button" class="mm-b" data-mm="paste-new">粘贴文字生成 <span aria-hidden="true">↗</span></button><button type="button" class="mm-b" data-mm="import-home">导入文件 <span aria-hidden="true">↗</span></button><small>支持 JSON、Markdown、TXT</small><input type="file" id="mmFileOpen" accept=".json,.md,.markdown,.txt" hidden></div></section>
<footer class="mm-home-footer"><span>捞捞 · 留一张画布给思考</span><span>本地保存 / 自由连接</span></footer>`;
  }
  function renderList() {
    const box = $("mmBox"); if (!box) return;
    $("mmHeadTitle").classList.remove("hidden"); $("mmTitleIn").classList.add("hidden"); $("mmSync").classList.add("hidden");
    $('mmSaveExit')?.classList.add('hidden');$('mmDiscardExit')?.classList.add('hidden');
    box.className = "mm-box list"; box.style.height = "";
    box.innerHTML = listHtml();
    const s = $("mmListQ"); if (s && s.dataset.f) s.focus();
  }

  // ---------------- 界面：编辑器 ----------------
  function editorHtml() {
    return `<div class="mm-tools" role="toolbar" aria-label="导图操作">
        <div class="mm-tg"><button class="mm-b ic" id="mmUndo" data-mm="undo" title="撤销（Ctrl+Z）">↶</button><button class="mm-b ic" id="mmRedo" data-mm="redo" title="重做（Ctrl+Y）">↷</button></div>
        <div class="mm-tg"><button class="mm-b" data-mm="find" title="搜索（Ctrl+F）" aria-label="搜索节点">查找</button></div>
        <div class="mm-tg mm-sel">
          <label title="画布主题"><select id="mmTheme" aria-label="画布主题">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("")}</select></label></div>
        <div class="mm-tg"><button class="mm-b" data-mm="paste-in" title="把文字转换成平级节点">粘贴文字</button><button class="mm-b" data-mm="export" title="导出图片 / Markdown / 备份">导出 ↗</button></div>
      </div>
      <div class="mm-findbar hidden" id="mmFindBar"><input id="mmFindIn" placeholder="搜索主题、备注…" maxlength="60"><span id="mmFindN"></span><button class="mm-b ic" data-mm="fprev">↑</button><button class="mm-b ic" data-mm="fnext">↓</button><button class="mm-b ic" data-mm="fclose">✕</button></div>
      <div class="mm-main">
        <div class="mm-view" id="mmView" tabindex="0" aria-label="思维导图画布"><div class="mm-stage" id="mmStage"></div>
          <div class="mm-zoom"><button data-mm="zout" title="缩小（Ctrl -）">−</button><span id="mmZoom">100%</span><button data-mm="zin" title="放大（Ctrl +）">＋</button><button data-mm="fit" title="适应屏幕（Ctrl 0）">⤢</button></div>
          <div class="mm-hint" id="mmHint">${isMobile() ? "双击改字 · 长按拖动换位置 · 两指缩放" : "双击建点/改字 · Ctrl+点选多选 · 右键拖动扫选 · 左键拖空白平移 · Ctrl+滚轮缩放"}</div></div>
        <aside class="mm-panel hidden" id="mmPanel"></aside>
      </div>`;
  }
  // 编辑器占满屏幕剩下的高度
  function fitBox() { const b = $("mmBox"); if (!b) return; if (!cur) { b.style.height = ""; return; } if (window.scrollY) window.scrollTo(0, 0); b.style.height = Math.max(380, window.innerHeight - b.getBoundingClientRect().top - (isMobile() ? 8 : 16)) + "px"; }
  function renderEditor() {
    const box = $("mmBox");
    $("mmHeadTitle").classList.add("hidden"); $("mmTitleIn").classList.remove("hidden"); $("mmSync").classList.remove("hidden");
    $('mmSaveExit')?.classList.remove('hidden');$('mmDiscardExit')?.classList.remove('hidden');
    box.className = "mm-box edit";
    box.innerHTML = editorHtml();
    $("mmTheme").value = cur.theme || "fresh";
    fitBox(); bindCanvas();
    draw(); fit();
    setSync(!me() ? "只存在这台设备（登录后自动存到账号）" : (idxGet(cur.id) || {}).dirty ? "待同步" : "已存到账号");
    $("mmView").focus({ preventScroll: true });
  }
  function panel() {
    const el = $("mmPanel"); if (!el) return;
    const r = sel && findNode(sel); if (!r) { el.innerHTML = `<div class="mp-h"><b>样式</b><button class="mm-b ic" data-mm="pclose">✕</button></div><p class="mp-tip">先点一个主题</p>`; return; }
    const n = r.n, th = THEMES[cur.theme] || THEMES.fresh;
    el.innerHTML = `<div class="mp-h"><b>${E((n.text || "").split("\n")[0].slice(0, 16))}</b><button class="mm-b ic" data-mm="pclose" aria-label="关闭">✕</button></div>
      <div class="mp-sec">颜色</div><div class="mp-colors"><button class="mp-c auto${n.color ? "" : " on"}" data-mm="color" data-v="" title="跟着分支">自动</button>${th.colors.concat(["#1f2a3d", "#8b96a8"]).map((c) => `<button class="mp-c${n.color === c ? " on" : ""}" data-mm="color" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
      <div class="mp-row"><button class="mm-b${n.bold ? " on" : ""}" data-mm="bold"><b>B</b> 加粗</button></div>
      <div class="mp-sec">标记</div><div class="mp-marks">${MARKS.map(([k, ic, nm]) => `<button class="mp-m${(n.marks || []).includes(k) ? " on" : ""}" data-mm="mark" data-v="${k}" title="${nm}">${ic}<small>${nm}</small></button>`).join("")}</div>
      <div class="mp-sec">进度 <span>${n.progress || 0}%</span></div><div class="mp-prog">${[0, 25, 50, 75, 100].map((v) => `<button class="mm-b${(n.progress || 0) === v ? " on" : ""}" data-mm="prog" data-v="${v}">${v === 0 ? "无" : v + "%"}</button>`).join("")}</div>
      <div class="mp-sec">备注</div><textarea id="mmNote" rows="4" maxlength="4000" placeholder="详细解释、例题、出处…（主题上会显示 📝）">${E(n.note || "")}</textarea>
      <div class="mp-sec">链接</div><div class="mp-link"><input id="mmLink" maxlength="500" placeholder="https://…" value="${E(n.link || "")}">${n.link ? `<a class="mm-b" href="${E(safeUrl(n.link))}" target="_blank" rel="noopener">打开</a>` : ""}</div>
      `;
  }
  const safeUrl = (u) => (/^(https?:)?\/\//i.test(u) ? u : /^[\w.-]+\.[a-z]{2,}/i.test(u) ? "https://" + u : "#");

  // ---------------- 打开 / 关闭 ----------------
  async function openMap(id, fromServer) {
    window.dispatchEvent(new Event("mm:ai-interrupt"));
    const serial=++openSerial;
    let m = lsGet(mapKey(id), null);
    const e = idxGet(id) || {};
    // [独立版] 云同步已停用：不再从账号取导图，只读本机（原 mm_get 分支及 fromServer 语义见 git 历史）
    if (!m) { tip("这张导图在这台设备上找不到了"); return; }
    let migrated = migrateMap(m); // Normalize browser-only legacy documents before the file API sees them.
    try {if(window.MMFiles)m=await window.MMFiles.prepare(m);}catch(error){tip(error.message);return false;}
    if(!m || serial!==openSerial)return false;
    migrated = migrateMap(m) || migrated;
        for (const r of m.nodes) fill(r);
    cur = m; cur.layout ||= "mind"; cur.line ||= "curve"; cur.theme ||= "fresh";
    // Legacy PDF rectangles gain the titlebar once, keeping their reading area.
    if(cur.pdfTitlebarVersion!==1){
      for(const node of cur.nodes)walk(node,n=>{if(n.pdf && Number.isFinite(cur.size?.[n.id]?.h))cur.size[n.id].h=Math.min(8000,cur.size[n.id].h+30);});
      cur.pdfTitlebarVersion=1;migrated=true;
    }
    if (migrated) { try { storeLocal(cur); } catch (e) {} }
    /* 【独立版】读取容错：旧图上可能已经有"表里有、树里没有"的孤儿条目（本次修复之前删出来的）。
       打开时清一次并落盘（治本在 del 的 dropLayer）。清完再播种，免得"只剩孤儿"时被 seedPos 的
       `if (Object.keys(p).length) return false` 误判成"已固化"。 */
    const pruned = pruneLayer();
    if (pruned) { console.log("[独立版] 打开时清理了 " + pruned + " 条不在树上的导图层条目"); try { storeLocal(cur); } catch (e) {} }
    seedPos();          // 【独立版】旧导图第一次打开：算一遍坐标写进 pos（之后不再重算）
    window.MMGroups?.reset(); window.MMCanvasTools?.clearSelection();
    sel = topNode() ? topNode().id : null; selectedNodes = new Set(sel ? [sel] : []); hist = []; redo = []; aiBatches.clear(); found = []; mode = "map"; panelOpen = false;
    document.body.classList.add("mm-editing");
    renderEditor();
    if (panelOpen) { $("mmPanel").classList.remove("hidden"); panel(); }
    try { save("mm_last_v1", id); } catch (err) {}
  }
  function closeMap(skipEdit) { window.dispatchEvent(new Event("mm:ai-interrupt")); if(skipEdit){const ta=document.querySelector('.mm-edit');if(ta?._resizeHandler)window.removeEventListener('resize',ta._resizeHandler);editing=null;editingNew=null;}else endEdit();window.MMAlign?.clear();window.MMPDF?.close();openSerial++;cur = null; L = null;window.MMAI?.close();window.dispatchEvent(new Event('mm:close-shortcuts'));document.body.classList.remove("mm-editing");refreshHome();try { save("mm_last_v1", ""); } catch (e) {} }
  async function create(tpl, title, rootObj) {
    const m = newMap(tpl, title);
    if (rootObj) { m.nodes = [fill(rootObj)]; m.title = ((m.nodes[0] || {}).text || "未命名导图").slice(0, 80); }
    storeLocal(m); idxPut({ id: m.id, local: true });
    scheduleCloud();
    await openMap(m.id);
    if ((tpl !== "blank" || title) && m.nodes[0] && cur?.id===m.id) startEdit(m.nodes[0].id, true);
  }

  // ---------------- 弹窗 ----------------
  function dlg(html) { const d = $("mmDlg"); $("mmDlgBody").innerHTML = html; if (!d.open) d.showModal(); return d; }
  const closeDlg = () => { const d = $("mmDlg"); if (d.open) d.close(); };
  function pasteDlg(intoMap) {
    dlg(`<form id="mmPasteF"><h3>${intoMap ? "把文字加到「" + E((findNode(sel).n.text || "").slice(0, 12)) + "」下面" : "粘贴文字生成导图"}</h3>
      <p class="meta">支持 AI 回答、Markdown（# 标题、- 列表）、缩进列表、1. / 1.1 编号。每一行是一个主题，层级按标题和缩进来。</p>
      <textarea id="mmPasteIn" rows="12" placeholder="# 函数的极限&#10;## 定义&#10;- ε-δ 定义&#10;- 左右极限&#10;## 计算方法&#10;- 四则运算&#10;- 两个重要极限&#10;  - sinx/x → 1&#10;  - (1+1/x)^x → e"></textarea>
      <div class="mm-prev" id="mmPrev"></div>
      <div class="nd-actions"><span class="spacer"></span><button type="button" class="small" data-mm="dclose">取消</button><button type="submit" class="btn ink sm">${intoMap ? "加进去" : "生成导图"}</button></div></form>`);
    const ta = $("mmPasteIn");
    const prev = () => { const v = ta.value; if (!v.trim()) { $("mmPrev").textContent = ""; return; } const t = parseText(v); const n = count(t.root) - (t.fromTitle ? 1 : 0); $("mmPrev").textContent = `会生成 ${n} 个主题` + (t.fromTitle && !intoMap ? "（没有总标题，中心主题叫「新导图」）" : t.root.text ? `，中心主题「${t.root.text.slice(0, 20)}」` : ""); };
    ta.addEventListener("input", prev);
    $("mmPasteF").onsubmit = (e) => {
      e.preventDefault(); const v = ta.value; if (!v.trim()) { ta.focus(); return; }
      closeDlg();
      if (intoMap) { pasteTo(sel, v); return; }
      const t = parseText(v); if (t.fromTitle) t.root.text = "新导图";
      create("blank", null, t.root);
    };
    setTimeout(() => ta.focus(), 50);
  }
  function exportDlg() {
    dlg(`<form method="dialog"><h3>导出「${E(cur.title)}」</h3><div class="mm-menu">
      <button type="button" data-mm="ex-png">🖼 PNG 图片<small>发给同学、打印、放进笔记</small></button>
      <button type="button" data-mm="ex-md">📝 Markdown<small>可以贴到笔记软件、文档里</small></button>
      <button type="button" data-mm="ex-txt">📋 复制大纲文字<small>缩进列表，直接粘贴</small></button>
      <button type="button" data-mm="ex-json">💾 备份文件（.json）<small>以后可以「打开文件」恢复，颜色标记都在</small></button>
      <button type="button" data-mm="dup">📄 复制一份新导图</button></div>
      <div class="nd-actions"><span class="spacer"></span><button type="button" class="small" data-mm="dclose">关闭</button></div></form>`);
  }
  function mapMenu(id) {
    const e = idxGet(id); if (!e) return;
    dlg(`<form method="dialog"><h3>${E(e.title)}</h3><div class="mm-menu">
      <button type="button" data-mm="ren" data-id="${id}">✎ 改名</button>
      <button type="button" data-mm="dupid" data-id="${id}">📄 复制一份</button>
      <button type="button" data-mm="delmap" data-id="${id}" class="danger">🗑 删除</button></div>
      <div class="nd-actions"><span class="spacer"></span><button type="button" class="small" data-mm="dclose">取消</button></div></form>`);
  }
  /* 【独立版·平级】一条边的菜单内容：四种指向 + 删除。写成"→ 指向「第二章」"这种话，
     用户不用理解 fwd/rev/none/both；当前那一项打勾。 */
  function edgeMenuHtml(e) {
    const a = findNode(e.from.node), b = findNode(e.to.node);
    const na = a ? a.n.text.split("\n")[0].slice(0, 14) : "?", nb = b ? b.n.text.split("\n")[0].slice(0, 14) : "?";
    const now = e.dir || "fwd";
    const item = (v, label) => `<button type="button" data-mm="edir" data-id="${e.id}" data-dir="${v}">${now === v ? "✓ " : ""}${label}</button>`;
    return `<button type="button" data-mm="edge-label" data-id="${e.id}">▣ ${e.label ? "修改文字标记" : "添加文字标记"}</button>` + item("none", "— 没有箭头") + item("fwd", "→ 指向「" + E(nb) + "」") + item("rev", "← 指向「" + E(na) + "」") +
      item("both", "↔ 两头都有箭头") + `<button type="button" data-mm="edel" data-id="${e.id}" class="danger">🗑 删除这条线</button>`;
  }
  /* 浮层菜单：**跟着指针出现**（不是弹窗），点空白/Esc/滚轮就收掉。
     挂在 #mmBox 里 —— 文档级 click 委派的门禁是 closest("#mmBox, #mmDlg, .mm-head")。 */
  function hideEdgeMenu() { const m = $("mmEdgeMenu"); if (m) m.classList.add("hidden"); }
  function hideNodeMenu() { const m = $("mmNodeMenu"); if (m) m.classList.add("hidden"); }
  document.addEventListener("click",e=>{const b=e.target.closest("[data-node-color]");if(b && b.closest("#mmNodeMenu")){setProp("color",b.dataset.nodeColor);hideNodeMenu();}});
  document.addEventListener("pointerdown", e => { if (!e.target.closest("#mmNodeMenu")) hideNodeMenu(); });
  function showNodeMenu(id, cx, cy) {
    window.MMContextMenus?.hideAll();hideEdgeMenu(); hideNodeMenu(); if (!selectedNodes.has(id)) select(id);
    const box = $("mmBox"); let m = $("mmNodeMenu");
    if (!m) { m = document.createElement("div"); m.id = "mmNodeMenu"; m.className = "mm-ctx"; box.appendChild(m); }
    const n=findNode(id).n,C=window.MMContextMenus;
    m.innerHTML = C.branch("颜色",`<button data-mm="color" data-v="">默认颜色</button>`+C.palette('data-node-color',n.color)+`<label class="mm-ctx-custom">自选颜色 <input type="color" id="mmNodeColorPick" value="${/^#[0-9a-f]{6}$/i.test(n.color || "")?n.color:"#4f8df5"}" aria-label="节点自选颜色"></label>`,"node-color")+
      C.branch("标记",`<div class="mm-ctx-marks">${MARKS.map(([k,ic,nm])=>`<button data-mm="mark" data-v="${k}">${(n.marks || []).includes(k)?"✓ ":""}${ic} ${E(nm)}</button>`).join("")}</div><button class="danger" data-mm="clear-marks">删除所有标记</button>`,"node-marks")+
      C.branch("进度",[0,25,50,75,100].map(v=>`<button data-mm="prog" data-v="${v}">${(n.progress || 0)===v?"✓ ":""}${v?v+"%":"无进度"}</button>`).join(""),"node-progress")+
      (window.MMAlign?.menu() || '')+(window.MMFormat?.menu() || '')+
      (n.image || n.pdf?`<button data-mm="media-rename" data-id="${E(id)}">重命名文件</button>`:'')+
      `<button data-mm="auto-size">恢复内容自适应</button><button data-mm="new-group">添加到新组</button><button data-mm="node-ask" data-id="${esc(id)}">✦ 提问</button><button class="danger" data-mm="del">删除${selectedNodes.size > 1 ? "选中的 " + selectedNodes.size + " 个节点" : "节点"}</button>`;
    C.place(m,cx,cy);
  }
  function showEdgeMenu(e, cx, cy) {
    const box = $("mmBox"); if (!box) return;
    let m = $("mmEdgeMenu");
    if (!m) {                                            // 懒创建：不用改外壳模板，重渲染后会自动补回来
      m = document.createElement("div"); m.id = "mmEdgeMenu"; m.className = "mm-ctx hidden";
      box.appendChild(m);
      /* 不要 stopPropagation：菜单项要靠**文档级 click 委派**（data-mm="edir"/"edel"）才生效。
         它挂在 #mmBox 里、不在 #mmView 的祖先链上，所以画布的 pointerdown 也看不到它。 */
    }
    m.innerHTML = edgeMenuHtml(e);
    m.classList.remove("hidden");
    const r = box.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 180;
    const x = Math.max(4, Math.min(cx - r.left, (r.width || 0) - mw - 4));
    const y = Math.max(4, Math.min(cy - r.top, (r.height || 0) - mh - 4));   // 别让菜单跑出可视区
    m.style.left = x + "px"; m.style.top = y + "px";
  }
  /* 选中的那条边（selEdge 可能指向已被删掉的边 → 找不到就返回 null） */
  const selEdgeObj = () => (cur && Array.isArray(cur.edges) ? cur.edges.find((e) => e.id === selEdge) || null : null);
  function delSelEdge() {
    const e = selEdgeObj(); if (!e) return false;
    change(() => { cur.edges = cur.edges.filter((x) => x !== e); selEdge = null; });
    return true;
  }
  /* 【独立版·平级】挂接节点时**同时连一条边** —— 这里的每个调用点都来自"层级操作"
     （Tab/Enter/新建子主题/新建同级/粘贴/大纲 Enter：新节点与被挂接的节点之间**本来就该有关系**），
     契约要求这些入口自动出线（层级在边上）。
     注意**不是**为了"让节点看得见"：没有边的节点本来就可见（见 visibleIds 的孤岛种子），
     所以双击空白新建那种"自由点"**不**走这里。 */
  function attachEdge(pid, cid) {
    if (!cur || !pid || !cid) return null;
    const sd = (cur.layout === "down") ? { from: "s", to: "n" } : { from: "e", to: "w" };
    const e = { id: eid(), from: { node: pid, side: sd.from }, to: { node: cid, side: sd.to }, dir: "fwd" };
    (cur.edges ||= []).push(e);
    return e;
  }
  async function duplicate(id) {    const m = id === (cur && cur.id) ? clone(cur) : lsGet(mapKey(id), null);
    let src = m;
    // [独立版] 云同步已停用：不再从账号取导图（原 mm_get 分支见 git 历史）
    if (!src) { tip("这张图还没下载到这台设备，先打开一次再复制"); return; }
    const c = { ...clone(src), id: uid(), title: (src.title || "导图") + " 副本" };
    /* 【独立版·平级】重发节点 id 的同时**必须重映射导图层**：pos/size/fold 的键 + edges 的端点。
       不重映射的后果：副本一打开就被 pruneLayer 当孤儿清掉（位置全丢），边指向原图节点（跨图引用）。 */
    migrateMap(c);                    // 旧格式来源（只有 root）先成容器，否则下面没有可遍历的节点
    const old2new = new Map();
    for (const r of (c.nodes || [])) walk(r, (n) => { const nw = nid(); old2new.set(n.id, nw); n.id = nw; });
    for (const t of LAYER_MAPS) {
      const d = c[t]; if (!d || typeof d !== "object") continue;
      const out = {};
      for (const k of Object.keys(d)) { const nw = old2new.get(k); if (nw) out[nw] = d[k]; }
      c[t] = out;
    }
    if (Array.isArray(c.edges)) {
      c.edges = c.edges.map((e) => {
        const a = old2new.get(e && e.from && e.from.node), b = old2new.get(e && e.to && e.to.node);
        if (!a || !b) return null;
        return { ...e, id: eid(), from: { ...e.from, node: a }, to: { ...e.to, node: b }, dir: e.dir };
      }).filter(Boolean);
    }
    if (Array.isArray(c.groups)) c.groups = c.groups.map(g => ({...g, id: eid()}));
    const c0 = (c.nodes || [])[0]; if (c0) c0.text = c.title;
    storeLocal(c); idxPut({ id: c.id, title: c.title, local: true }); scheduleCloud();   // 带上标题：不带的话列表里显示旧标题
    closeDlg(); if (cur) openMap(c.id); else renderList(); tip("已复制");
  }
  async function renameMap(id,title){
    await pullList();
    const entry=idxGet(id);if(!entry)return;
    fileListRevision++;
    try{
      if(entry.fileBacked && !entry.fileMissing){
        if((await browserDraft(id,entry.fileBaseHash)).changed)throw new Error('此导图有浏览器草稿，请先打开并保存或放弃草稿，再改名');
        await window.MMFiles?.forget(id);
        const result=await fileRequest('/api/maps/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':entry.fileBaseHash},body:JSON.stringify({title})});
        if(!lsSet(mapKey(id),result.map))throw new Error('浏览器存储空间不足');
        lsDel(recoveryKey(id));await noteFile(result.map);
      }else{
        const map=lsGet(mapKey(id),null);if(map){map.title=title;lsSet(mapKey(id),map);}
        const recovery=lsGet(recoveryKey(id),null);if(recovery?.map){recovery.map.title=title;lsSet(recoveryKey(id),recovery);}
      }
      idxPut({id,title,updated:Date.now()});refreshHome();
    }catch(error){tip(error.message,5000);refreshHome();}
  }
  async function deleteMap(id) {
    await pullList();
    const entry=idxGet(id);if(!entry || !confirm(`删除「${entry.title}」及其导图文件、图片、PDF 和未保存草稿？`))return;
    closeDlg();fileListRevision++;
    try{
      await window.MMFiles?.forget(id);
      if(entry.fileBacked)await fileRequest('/api/maps/'+encodeURIComponent(id),{method:'DELETE',headers:entry.fileMissing?{}:{'If-Match':entry.fileBaseHash}});
      lsDel(mapKey(id));lsDel(recoveryKey(id));index=index.filter(e=>e.id!==id);idxSave();
      if(cur?.id===id)closeMap(true);else refreshHome();
    }catch(error){tip(error.message,5000);refreshHome();}
  }
  async function readFile(file) {
    if (!file) return;
    if (file.size > 3e6) { tip("文件太大了"); return; }
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      try {
        const o = JSON.parse(text); const m = (o.root || Array.isArray(o.nodes)) ? o : (o.data && (o.data.root || Array.isArray(o.data.nodes))) ? o.data : null;
        if (!m) throw new Error();
        /* 容器列表：旧格式（root）与新格式（nodes 数组）都认。
           **多容器不静默丢** —— 原来只取 [0]，其余容器无声消失（连提示都没有）。现在全部导入，
           并把"当前版本只画第一个容器"讲清楚（与 openMap 的多容器提示同口径：宁可吵，不要安静丢）。 */
        const rootsIn = Array.isArray(m.nodes) && m.nodes.length ? m.nodes : (m.root ? [m.root] : []);
        if (!rootsIn.length && !Array.isArray(m.nodes)) throw new Error();
        const imported={...newMap('blank'),...clone(m),id:uid(),nodes:rootsIn.map(n=>fill(clone(n)))};
        delete imported.root;imported.title=String(m.title || imported.nodes[0]?.text || '未命名导图').slice(0,80);
        if(Array.isArray(m.media))imported.media=clone(m.media).map(f=>({...f,sourceMap:f.sourceMap || m.id}));
        storeLocal(imported);idxPut({id:imported.id,local:true});await openMap(imported.id);
        tip('已导入导图，节点、位置、分组和媒体引用已保留',1600);
        return;
      } catch (e) { tip("这个 JSON 不是思维导图备份"); return; }
    }
    const t = parseText(text); if (t.fromTitle) t.root.text = file.name.replace(/\.[^.]+$/, "");
    create("blank", null, t.root);
  }

  // ---------------- 搜索 ----------------
  let fi = 0;
  function doFind() {
    q = $("mmFindIn").value.trim().toLowerCase(); found = [];
    /* 【独立版·平级】搜索覆盖**全部容器**（原来只走 topNode()，第二个容器里的节点永远搜不到）。 */
    if (q) for (const r of nodesArr()) walk(r, (n) => { if ((n.text + " " + (n.note || "")).toLowerCase().includes(q)) found.push(n.id); });
    /* 搜到的在收起的分支里：沿路展开它的上级。**必须走 change** —— 写在 change 外的话，
       这次展开既不进撤销栈、也不落盘（doFind 末尾那两句 draw/storeLocal 拿不到它）。
       先收集"确实要展开的"，避免一次什么都没改的空 change 白占一格撤销。 */
    const toOpen = new Set();
    for (const id of found) for (const f of foldPathTo(cur, id)) toOpen.add(f);   // 按**边**找路，不靠 children 父子链
    if (toOpen.size) change(() => { for (const fid of toOpen) delete cur.fold[fid]; });
    fi = 0; $("mmFindN").textContent = q ? (found.length ? `1 / ${found.length}` : "没找到") : "";
    draw(); if (found.length) select(found[0], true);
  }
  function stepFind(d) { if (!found.length) return; fi = (fi + d + found.length) % found.length; $("mmFindN").textContent = `${fi + 1} / ${found.length}`; select(found[fi], true); }

  // ---------------- 画布：平移、缩放、拖动节点 ----------------
  function zoomAt(k, cx, cy) {
    const r = $("mmView").getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const nk = Math.max(0.15, Math.min(3, k));
    /* 【独立版】非有限值必须在这儿挡掉：`Math.min(3, NaN)` 是 NaN，`NaN` 一旦写进 view.x
       就**永久污染**画布（transform 变成 translate(NaNpx,NaNpx)，之后所有几何命中全落空，
       而且不会报错、只是"点哪儿都不对"）。多指手势的比值/中心可能退化成非有限值，所以两道都守。 */
    if (!isFinite(nk) || !isFinite(cx) || !isFinite(cy)) return;
    view.x = cx - (cx - view.x) * (nk / view.k); view.y = cy - (cy - view.y) * (nk / view.k); view.k = nk; applyView();
  }
  let lastScroll=null,resetScroll=()=>{};
  function bindCanvas() {
    const vw = $("mmView");
    // Keep a continuous wheel/touchpad gesture with its starting surface. The
    // transformed canvas can otherwise move an overflowing node under the cursor.
    let wheelGesture = null;
    resetScroll=()=>{wheelGesture=null;lastScroll=null;};resetScroll();
    vw.addEventListener('pointerdown',resetScroll,true);
    vw.addEventListener('keydown',resetScroll,true);
    const pts = new Map(); let drag = null, pinch = null, lastTap = { t: 0, id: null }, press = 0;
    vw.addEventListener("keydown", e => {
      if (!drag || e.target.closest("input,textarea")) return;
      if (e.key !== "Escape") { e.preventDefault(); e.stopImmediatePropagation(); return; }
      e.preventDefault(); e.stopImmediatePropagation(); const d = drag; drag = null; pts.clear(); pinch = null; clearTimeout(press);
      if (d.resize?.raf) cancelAnimationFrame(d.resize.raf);
      commitPreview(d.resize?.snap || d.snap, true); select(null);
    }, true);
    const local = (e) => { const r = vw.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k, cx: e.clientX - r.left, cy: e.clientY - r.top }; };
    /* 【独立版】八方向缩放的命中判定（全部按**屏幕像素**算，阈值不随 view.k 变形）：
       优先级：角（短路）→ 边（两边都满足取更近的一条）→ 否则视为内部拖动（返回 null）。
       小节点保护：m 取屏幕 w/h 的较小者；cornerEff=clamp(round(m*0.25),4,12)、edgeEff=clamp(round(m*0.15),3,8) 且 edgeEff ≤ cornerEff。
       判定直接使用节点盒的边与角，无需可见手柄。 */
    const RZ = { edge: 16, corner: 22, slop: 7 };
    const CURSOR = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
    /* 【独立版】方向光标必须加在**指针下的节点元素**上（用类，不用 #mmView 的行内 style）：
       .mm-node{cursor:grab} 是 (0,1,0)，而写在 #mmView 上的行内值**赢不了后代自己的选择器**
       —— 落在节点盒内（正是要缩放的区域）用户只会看到抓手。.mm-node.rz-x 是 (0,2,0)，压得过。
       顺带把 #mmView 的行内值彻底去掉：它就是"内部区域仍读到上一次 nwse-resize"的来源。 */
    const RZCLS = ["rz-n", "rz-s", "rz-e", "rz-w", "rz-nw", "rz-ne", "rz-sw", "rz-se"];
    let rzEl = null;
    /* 拖动中的连线预览：起点 = 按下那个磁吸点，终点 = 指针（吸附到候选磁吸点时吸附过去）。
       坐标都在**舞台坐标系**里画（预览 svg 与连线 svg 同一坐标空间），所以缩放变更时不用重算。 */
    function drawLinkPrev(cx, cy, hover) {
      const svg = document.querySelector("#mmStage .mm-linkprev");
      if (!svg || !link || !L) return;
      const s0 = L.nodes.get(link.from.node); if (!s0) return;
      const a = magPos(s0, link.from.side);
      const hs = hover && (hover.id !== link.from.node || hover.side !== link.from.side) ? L.nodes.get(hover.id) : null;
      const t = hs ? magPos(hs, hover.side) : local({ clientX: cx, clientY: cy });
      svg.innerHTML = `<path d="M${a.x},${a.y} L${t.x},${t.y}" stroke="#2f7cf6" stroke-width="2" stroke-dasharray="6 5" fill="none" stroke-linecap="round"/>`
        + (hs ? `<circle cx="${t.x}" cy="${t.y}" r="4" fill="none" stroke="#2f7cf6" stroke-width="2"/>` : "");   // 目标端空心圆 = "松手就连到这里"
    }
    const clearLinkPrev = () => { const svg = document.querySelector("#mmStage .mm-linkprev"); if (svg) svg.innerHTML = ""; };
    /* 磁吸点的视觉：源节点加 .linking（四个点常亮），当前候选节点加 .hot（高亮）。
       命中仍然是 magnetAt() 的几何算 —— 这里只改类名。
       目标选择器是**覆盖层** .mm-magwrap[data-id=…]（圆点不在 .mm-node 里）。 */
    function markLink(onId, hotId) {
      for (const el of document.querySelectorAll("#mmStage .mm-magwrap")) {
        el.classList.toggle("mag-on", !!onId && el.dataset.id === onId);
        el.classList.toggle("linking", !!onId && el.dataset.id === onId);
        el.classList.toggle("hot", !!hotId && el.dataset.id === hotId);
      }
    }
    /* 靠近淡入：指针离节点屏幕矩形 MAG_DIST 以内 → 亮出那一个节点的磁吸点。
       只亮"最近的一个"，否则节点密集时一片圆点同时淡入。 */
    function hoverMagnets(cx, cy, exclude) {
      if (!L || !cur) return;
      const r = $("mmView").getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
      let best = null, bestD = Infinity;
      for (const s of L.nodes.values()) {
        if (s.n.id === exclude) continue;
        if (s.x == null || s.y == null) continue;
        const x0 = s.x * view.k + view.x, y0 = s.y * view.k + view.y, w = s.w * view.k, h = s.h * view.k;
        if (px < x0 - MAG_DIST || px > x0 + w + MAG_DIST || py < y0 - MAG_DIST || py > y0 + h + MAG_DIST) continue;
        const d = Math.hypot(px - (x0 + w / 2), py - (y0 + h / 2));
        if (d < bestD) { bestD = d; best = s.n.id; }
      }
      for (const el of document.querySelectorAll("#mmStage .mm-magwrap.mag-on")) if (el.dataset.id !== best) el.classList.remove("mag-on");
      if (best) { const el = document.querySelector(`#mmStage .mm-magwrap[data-id="${best}"]`); if (el) el.classList.add("mag-on"); }
    }
    function markZone(id, dir) {
      const el = id ? document.querySelector(`#mmStage .mm-node[data-id="${id}"]`) : null;
      if (rzEl && rzEl !== el) RZCLS.forEach((c) => rzEl.classList.remove(c));
      if (!el) { rzEl = null; return; }
      RZCLS.forEach((c) => el.classList.remove(c));
      if (dir) el.classList.add("rz-" + dir);
      rzEl = el;
    }
    function zoneAt(cx, cy) {
      if (!L || !cur) return null;
      const r = vw.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
      const list = [...L.nodes.values()];
      const si = list.findIndex((s) => s.n.id === sel);
      if (si > 0) { const s = list.splice(si, 1)[0]; list.unshift(s); }   // 选中节点优先
      for (const s of list) {
        if (s.x == null || s.y == null) continue;
        const x0 = s.x * view.k + view.x, y0 = s.y * view.k + view.y, w = s.w * view.k, h = s.h * view.k;   // 屏幕坐标
        if (px < x0 - RZ.slop || px > x0 + w + RZ.slop || py < y0 - RZ.slop || py > y0 + h + RZ.slop) continue;
        const m = Math.min(w, h);
        /* 短边缩放的**下限抬到 10px**：典型子节点只有 ~40px 高，若下限压到 4–6px，
           命中区会窄到必须精细挪鼠标（用户在浏览器实测反馈的正是这条）。 */
        const cornerEff = Math.min(RZ.corner, Math.max(10, Math.round(m * 0.25)));
        const edgeEff = Math.min(cornerEff, Math.min(RZ.edge, Math.max(10, Math.round(m * 0.15))));
        const dL = px - x0, dR = x0 + w - px, dT = py - y0, dB = y0 + h - py;
        if ((dL <= cornerEff || dR <= cornerEff) && (dT <= cornerEff || dB <= cornerEff)) {
          return { id: s.n.id, dir: (dT <= dB ? "n" : "s") + (dL <= dR ? "w" : "e") };   // 角优先，短路
        }
        const cand = [[dL, "w"], [dR, "e"], [dT, "n"], [dB, "s"]].filter((c) => c[0] <= edgeEff).sort((a, b) => a[0] - b[0]);
        if (cand.length) return { id: s.n.id, dir: cand[0][1] };                          // 边：取更近的那条
      }
      return null;
    }
    vw.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      hideNodeMenu();
      /* 【独立版】收起按钮走**指针**路径，不再只靠 click 的 target：
         click 的 target 是 mousedown / mouseup 的**共同祖先** —— 按下落在按钮上、松手偏一点落到节点上，
         target 就变成 .mm-node，文档级 click 委托收到时 closest("[data-mm]") 是 null，这次折叠整条丢掉。
         真实浏览器实测的"第一次点按钮没用、要点第二次"就是这个形态。
         按下记下来 → 松手没怎么动才算一次点击（拖开 = 取消），折叠在这一步完成。 */
      const fb = e.target.closest("[data-mm=fold]");
      hideEdgeMenu();               // 在画布上按下 = 收起浮层菜单（菜单自己的点击不经过这里）
      vw.classList.remove("mag-pointer");
      foldDown = null;              // 每次按下都从干净状态开始：万一上一次按下没等到 pointerup（指针跑到窗口外），陈旧值不会误折
      /* 【独立版】foldSwallow 也是"上一次手势"的残留：指针路径设了它，而紧随的 click 如果没被委派
         路由到那个按钮（click 的 target 解析成 .mm-node 时 closest("[data-mm]") 是 null，早退），
         它就**留着吞掉下一次点击**——现象就是"点了没反应、再点一次才折叠"。
         新的按下 = 新手势开始，这里一并清掉。 */
      foldSwallow = null;
      if (fb) {
        foldDown = { id: fb.dataset.id, sx: e.clientX, sy: e.clientY, moved: false };
        try { vw.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        return;
      }
      if (e.target.closest(".mm-zoom, .mm-edit, .mm-edit-preview, .mm-edit-help, .mm-ic,.mm-formatbar,.mm-task")) return;
      const imageLabel=e.target.closest('[data-image-label]');
      const ctrlNode = e.target.closest(".mm-node") || (imageLabel && document.querySelector(`.mm-node[data-id="${imageLabel.dataset.imageLabel}"]`));
      if ((e.ctrlKey || e.metaKey) && ctrlNode) {
        const id = ctrlNode.dataset.id, ids = new Set(selectedNodes); ids.has(id) ? ids.delete(id) : ids.add(id);
        selectNodes([...ids]); vw.focus({preventScroll:true}); e.preventDefault(); return;
      }
      /* 【独立版·平级】磁吸点**优先于缩放**：指针落在某个磁吸点的命中半径内 → 进入连线模式，
         不触发八方向缩放；出了半径、仍在边缘带内 → 才是缩放（下面那段 zoneAt）。
         这与 A3/A4 的口径一致：圆内是连线、圆外才是缩放，二者互斥。 */
      const mg0 = imageLabel ? null : magnetAt(e.clientX, e.clientY);
      if (mg0) {
        vw.classList.add("mag-pointer"); markZone(null, null);
        link = { from: { node: mg0.id, side: mg0.side }, sx:e.clientX, sy:e.clientY };
        select(mg0.id);                                  // select 会重画（预览 svg 被重建），所以先 select 再画预览
        markLink(mg0.id, null);
        drawLinkPrev(e.clientX, e.clientY, null);
        try { vw.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        return;
      }
      /* 【独立版】八方向缩放：命中按屏幕几何算（zoneAt） */
      if (cur && !imageLabel) {
        const hz = zoneAt(e.clientX, e.clientY), s0 = hz && L && L.nodes.get(hz.id);        if (hz && s0) {
          if (sel !== hz.id) select(hz.id);
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          drag = { moved: true, resize: { id: hz.id, dir: hz.dir, w0: s0.w, h0: s0.h, x0: s0.x, y0: s0.y,
            mx: e.clientX, my: e.clientY, snap: JSON.stringify(cur),
            ratio: s0.w / Math.max(1, s0.h), raf: 0 } };
          markZone(hz.id, hz.dir);                          // 拖动过程中锁住方向光标（加在节点元素上，离开也不跳回）
          try { vw.setPointerCapture(e.pointerId); } catch (err) {}
          return;
        }
      }
      vw.focus({ preventScroll: true });
      /* 【独立版·平级】点空白处**线**：节点优先于边 —— 所以只有在"指针没落在任何节点上"时才问边
         （落在节点上又想去点边，那是用户自己没对准）。命中带 10px 屏幕像素，线本身仍然只有 2px。 */
      if (!ctrlNode && cur) {
        const eh = edgeAt(e.clientX, e.clientY);
        if (eh) {
          select(null); selEdge = eh.id;
          document.querySelectorAll("#mmStage .mm-node.sel").forEach((x) => x.classList.remove("sel"));
          draw();
          e.preventDefault();
          return;
        }
      }
      if (selEdge) { selEdge = null; draw(); }               // 点别处 = 取消选中这条线（与节点选中同口径）
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; clearTimeout(press); return; }
      const nd = ctrlNode;
      if (editing && (!nd || nd.dataset.id !== editing)) endEdit();
      drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, id: nd ? nd.dataset.id : null, moved: false, node: false, mediaLabel:!!imageLabel,touch: e.pointerType === "touch" };
      if (nd && e.pointerType === "touch") press = setTimeout(() => { if (drag && !drag.moved) { drag.node = true; buzz(15); startNodeDrag(drag, e); } }, 380);
      try { vw.setPointerCapture(e.pointerId); } catch (err) {}
    });
    vw.addEventListener("pointermove", (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      /* 收起按钮：拖开超过阈值就算取消（与节点拖动同一套 6px 阈值） */
      if (foldDown && !foldDown.moved && Math.hypot(e.clientX - foldDown.sx, e.clientY - foldDown.sy) > 6) foldDown.moved = true;
      if (pinch && pts.size >= 2 && isFinite(pinch.d) && pinch.d > 0) { const [a, b] = [...pts.values()]; const r = vw.getBoundingClientRect(); zoomAt(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, pinch.cx - r.left, pinch.cy - r.top); return; }
      /* 连线拖动中：预览线跟手；落在候选磁吸点上就吸附过去（目标端空心圆提示"会连到这里"） */
      if (link) {
        const mg = magnetAt(e.clientX, e.clientY);
        vw.classList.toggle("mag-pointer", !!mg);
        const target=mg && (mg.id!==link.from.node || mg.side!==link.from.side)?mg:null;
        markLink(link.from.node, target?.id);
        hoverMagnets(e.clientX,e.clientY,link.from.node);
        drawLinkPrev(e.clientX, e.clientY, target);
        return;
      }
      if (drag && drag.resize) {
        const z = drag.resize, k = view.k || 1;
        const dx = (e.clientX - z.mx) / k, dy = (e.clientY - z.my) / k;
        const W = z.dir.indexOf("w") >= 0, E = z.dir.indexOf("e") >= 0, N = z.dir.indexOf("n") >= 0, S = z.dir.indexOf("s") >= 0;
        let w = z.w0 + (E ? dx : W ? -dx : 0);        // 边只改一个维度
        let h = z.h0 + (S ? dy : N ? -dy : 0);
        if (e.shiftKey) { if (Math.abs(w - z.w0) >= Math.abs(h - z.h0)) h = w / z.ratio; else w = h * z.ratio; }
        const s0 = L && L.nodes.get(z.id);
        const cs = clampSize(w, h, s0 ? s0.measW : z.w0, s0 ? s0.measH : z.h0);
        curSize()[z.id] = cs;
        const manual=((cur.sizing ||= {})[z.id] ||= {});
        if (E || W || e.shiftKey) manual.w=true;
        if (N || S || e.shiftKey) manual.h=true;
        if (!manual.h && !findNode(z.id)?.n.image && !findNode(z.id)?.n.pdf) cs.h=clampSize(cs.w,measure(findNode(z.id).n,1,cs.w).h).h;
        /* 西/北方向：左上角要跟着走，否则是从中心缩、不是从边缘缩。
           这里在拖动**过程中**写坐标（松手时才由 up 里的 resize 分支落盘 + 进撤销），所以不走 change；但写入口统一走 putLayerPos。 */
        if (W || N) {
          const p = curPos()[z.id] || { x: z.x0, y: z.y0 };
          putLayerPos(z.id, { x: W ? Math.round(z.x0 + (z.w0 - cs.w)) : p.x, y: N ? Math.round(z.y0 + (z.h0 - cs.h)) : p.y });
        }
        if (z.raf) cancelAnimationFrame(z.raf);
        z.raf = requestAnimationFrame(() => { try { draw(true); } catch (err) {} });
        return;
      }
      /* 未在拖动：指针进入某方向命中区就给**那个节点**加方向类（角 > 边；内部维持原光标） */
      if (!drag) {
        if(e.target.closest('[data-image-label]')){vw.classList.remove('mag-pointer');markZone(null,null);return;}
        if (e.target.closest(".mm-zoom, .mm-edit, .mm-edit-preview, .mm-edit-help, .mm-ic,.mm-formatbar,.mm-task")) {
          vw.classList.remove("mag-pointer"); markZone(null, null); return;
        }
        const mg = magnetAt(e.clientX, e.clientY);
        vw.classList.toggle("mag-pointer", !!mg);
        const hz = mg ? null : zoneAt(e.clientX, e.clientY);
        markZone(hz && hz.id, hz && hz.dir);
        hoverMagnets(e.clientX, e.clientY);
        /* 边悬停：**节点优先于边** —— 只有指针没落在任何节点上时才看线（与点击同一口径）。 */
        markEdgeHot(hz || e.target.closest(".mm-node") ? null : (edgeAt(e.clientX, e.clientY) || {}).id || null);
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) { drag.moved = true; clearTimeout(press); if (drag.id && !drag.touch) { drag.node = true; startNodeDrag(drag, e); } }
      if (drag.node) moveNodeDrag(drag, e, local(e));
      else { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); vw.classList.add("panning"); }
    });
    const up = (e) => {
      pts.delete(e.pointerId); clearTimeout(press);
      /* 【独立版·平级】连线：松手位置落在一个磁吸点上就建边（默认单指向 fwd）；
         松在空白 = 静默取消；松回自己 = addEdge 给一句确定原因的提示（不静默）。
         一条边一次 change —— 一次撤销撤掉的就是这条边。 */
      if (link) {
        const l = link; link = null;
        clearLinkPrev(); markLink(null, null);
        if (e.type !== "pointercancel") {
          const mg = magnetAt(e.clientX, e.clientY);
          if (mg) addEdge(l.from, { node: mg.id, side: mg.side }, "fwd");
          else {
            const p=local(e), r=vw.getBoundingClientRect();
            const occupied=[...L.nodes.values()].some(s=>p.x>=s.x && p.x<=s.x+s.w && p.y>=s.y && p.y<=s.y+s.h);
            if(!occupied && e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom && Math.hypot(e.clientX-l.sx,e.clientY-l.sy)>8 && !e.target.closest(".mm-zoom,.mm-hint,.mm-edge-label")) {
              const node={id:nid(),text:"",children:[]}, box=measure(node,1), at={x:Math.round(p.x-box.w/2),y:Math.round(p.y-box.h/2)};
              const source=L.nodes.get(l.from.node), toSide=Math.abs(p.x-(source.x+source.w/2))>=Math.abs(p.y-(source.y+source.h/2))?(p.x>source.x+source.w/2?"w":"e"):(p.y>source.y+source.h/2?"n":"s");
              change(()=>{cur.nodes.push(node);putLayerPos(node.id,at);curSize()[node.id]={w:box.w,h:box.h};(cur.edges ||= []).push({id:eid(),from:l.from,to:{node:node.id,side:toSide},dir:"fwd"});});
              select(node.id);
            }
          }
        }
        return;
      }
      if (foldDown) {                                   // 收起按钮：按下→原地松手 才折叠（拖开/取消都不算）
        const f = foldDown; foldDown = null;
        if (e.type === "pointercancel" || f.moved) return;
        foldSwallow = f.id; toggleFold(f.id);
        return;
      }
      if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
      if (!drag) return;
      vw.classList.remove("panning");
      const d = drag; drag = null;
      if (d.resize) {
        /* 【独立版】松手才落盘：整段拖拽只进一条撤销历史（快照在按下时拍的） */
        markZone(null, null); vw.style.cursor = "";        // 解锁方向光标（并清掉旧版遗留在 #mmView 上的行内值）
        if (d.resize.raf) cancelAnimationFrame(d.resize.raf);
        commitPreview(d.resize.snap, e.type === "pointercancel");
        return;
      }
      if (d.node) { endNodeDrag(d, e.type === "pointercancel"); return; }
      if (d.moved) return;
      if (d.id) {
        const now = Date.now();
        // Touch needs a double-tap fallback; mouse editing is handled only by dblclick.
        if (d.touch && lastTap.id === d.id && now - lastTap.t < 350) { if(d.mediaLabel)window.MMFiles?.renameNode(d.id);else if(findNode(d.id)?.n.pdf)window.MMPDF?.activate(d.id);else if(!findNode(d.id)?.n.image)startEdit(d.id);lastTap = { t: 0, id: null }; return; }
        lastTap = d.touch ? { t: now, id: d.id } : { t: 0, id: null };
        select(d.id);
      } else { lastTap = { t: 0, id: null }; if (!e.ctrlKey && !e.metaKey) select(null); }
    };
    vw.addEventListener("pointerup", up); vw.addEventListener("pointercancel", up);
    vw.addEventListener("pointerleave", () => {
      vw.classList.remove("mag-pointer");
      if (!drag && !link) {
        markZone(null, null);
        document.querySelectorAll("#mmStage .mm-magwrap.mag-on").forEach(el => el.classList.remove("mag-on"));
      }
    });
    /* 【独立版·平级】右键：只接管**线**上的右键（节点优先于边；别处留给浏览器）。
       菜单四项写成"→ 指向 XX / ← 指向 XX"，用户不用理解 fwd/rev 这类枚举值。 */
    vw.addEventListener("contextmenu", (e) => {
      if (!cur) return;
      if (e.target.closest(".mm-edit,.mm-edit-preview")) return;
      e.preventDefault();
      const nd = e.target.closest(".mm-node");
      const p = local(e);
      const hit = e.target.closest('[data-image-label]')?.dataset.imageLabel || (nd ? nd.dataset.id : (L && [...L.nodes.values()].reverse().find(s => p.x >= s.x && p.x <= s.x+s.w && p.y >= s.y && p.y <= s.y+s.h) || {}).n?.id);
      if (hit) { e.preventDefault(); showNodeMenu(hit, e.clientX, e.clientY); return; }
      hideNodeMenu();
      const eh = edgeAt(e.clientX, e.clientY);
      if (!eh) return;
      e.preventDefault();
      selEdge = eh.id; draw();
      showEdgeMenu(eh, e.clientX, e.clientY);
    });
    vw.addEventListener("wheel", (e) => {
      hideNodeMenu(); hideEdgeMenu();
      e.preventDefault();
      const r = vw.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {resetScroll();zoomAt(view.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);}
      else {
        const findScroll=target=>{
          const candidates=[],node=target.closest('.mm-node');
          for(let el=target;el && el!==vw;el=el.parentElement)if(el.matches('.mm-edit,.mm-edit-preview,.mm-rich,pre,.katex-display,.mm-pdf-scroll'))candidates.push(el);
          const rich=node?.querySelector('.mm-rich');if(rich && !candidates.includes(rich))candidates.push(rich);
          const horizontal=!!e.deltaX || e.shiftKey;
          return candidates.find(el=>horizontal?el.scrollWidth>el.clientWidth+1:el.scrollHeight>el.clientHeight+1) || candidates.find(el=>el.scrollHeight>el.clientHeight+1 || el.scrollWidth>el.clientWidth+1);
        };
        const now=performance.now();
        if(!wheelGesture || now-wheelGesture.at>220 || (wheelGesture.owner && !wheelGesture.owner.isConnected)){
          const first=findScroll(e.target);
          wheelGesture={at:now,owner:first?.closest('.mm-node,.mm-edit,.mm-edit-preview') || first || null,target:e.target};
        }
        wheelGesture.at=now;
        const owner=wheelGesture.owner;
        lastScroll={at:now,owner:owner?.closest('.mm-node')?.dataset.id || (owner?'editor':'canvas')};
        if(owner?.contains(e.target))wheelGesture.target=e.target;
        const scroll=owner?findScroll(wheelGesture.target):null;
        if(scroll){
          const unit=e.deltaMode===1?24:e.deltaMode===2?scroll.clientHeight:1,k=view.k || 1;
          let dx=e.deltaX*unit/k,dy=e.deltaY*unit/k;if(e.shiftKey && !dx){dx=dy;dy=0;}
          scroll.scrollTop+=dy;scroll.scrollLeft+=dx;return;
        }
        if(owner)return; // A content gesture never chains to the canvas at its boundary.
        view.x -= e.deltaX; view.y -= e.deltaY; applyView();
      }
    }, { passive: false });
    /* 【独立版】双击：节点 → 选中并进编辑（不再靠上条 350ms 判定当主路径）；
       空白 → 在**鼠标位置**新建一个节点（中心落在鼠标点），出生即固化坐标。
       新节点挂到**根节点**下：数据是纯树、渲染从 topNode() 递归开始，没有父节点的节点不会被画出来；
       挂根既满足"不挂到当前选中节点下面"（自由画布上到处双击不该都长在选中节点下），又保证它能被渲染。 */
    vw.addEventListener("dblclick", (e) => {
      if (e.target.closest(".mm-zoom, .mm-edit, .mm-edit-preview, .mm-edit-help,.mm-formatbar,.mm-task")) return;
      if (!cur) return;
      const label=e.target.closest('[data-image-label]') || document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-image-label]');
      if(label){e.preventDefault();const point=document.elementFromPoint(e.clientX,e.clientY);if(label.classList.contains('mm-pdf-titlebar') && !e.target.closest('.mm-pdf-title') && !point?.closest('.mm-pdf-title'))return;select(label.dataset.imageLabel);window.MMFiles?.renameNode(label.dataset.imageLabel);return;}
      // Pointer capture or a redraw may retarget dblclick to the stage/view.
      // Use the rendered boxes as well as the DOM target to distinguish nodes from blank canvas.
      const nd = e.target.closest(".mm-node");
      const p = local(e);
      const hit = e.target.closest('[data-image-label]')?.dataset.imageLabel || (nd ? nd.dataset.id : (L && [...L.nodes.values()].reverse().find(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) || {}).n?.id);
      if (hit) { e.preventDefault(); select(hit); if(findNode(hit)?.n.pdf){window.MMPDF?.activate(hit);return;}if (!findNode(hit)?.n.image && editing !== hit) startEdit(hit); return; }
      /* 【独立版】盒子必须用 measure() 量出来，不能用 estSize() 的文字估算：
         estSize("分支主题",1) 给 100×38，实际量出来是 96×40 —— 差 (Δw/2, Δh/2) 就是"中心没落在鼠标点上"的偏差
         （浏览器实测 dx=-2）。这里和布局用的是同一个 measure()，尺寸完全一致，中心就精确落在鼠标点。
         坐标换算的基准是 **#mmView 的 rect**（不是 #mmBox）：view.x/view.y 就是相对 #mmView 的，
         两者之间隔着工具条（实测 47px），基准取错就会整块偏移工具条的高度。 */
      const k = { id: nid(), text: "", children: [] }, m = measure(k, 1);
      const at = birthPos(null, { x: Math.round(p.x - m.w / 2), y: Math.round(p.y - m.h / 2) });   // 一次 dblclick 只建一个
      change(() => {
        putLayerPos(k.id, at);                     // 坐标写进 change 的 fn 内（与 endNodeDrag 的 putPos 同构）
        /* **不建边**：双击空白建的是"自由点"，本来就没有边 —— 这是合法状态。
           （可见性修对之后，没有边的节点照样画得出来；为了"看得见"硬塞一条边等于凭空造关系。） */
        cur.nodes.push(k);
      });
      sel = k.id; draw(); startEdit(k.id, true); editingNew = k.id;
    });
  }
  // 拖节点：**只落坐标**（位置就是数据）。换父子那套已删 —— 层级现在由边表达。
  function startNodeDrag(d, e) {
    if (!selectedNodes.has(d.id)) select(d.id);
    d.original = [...selectedNodes].map(id => { const s = L.nodes.get(id); return {id,x:s.x,y:s.y,w:s.w,h:s.h}; });
    d.snap = JSON.stringify(cur); d.dx = d.dy = 0;
  }
  function moveNodeDrag(d, e, p) {
    if (!d.original) return;
    d.dx = Math.round((e.clientX-d.sx)/view.k); d.dy = Math.round((e.clientY-d.sy)/view.k);
    if(window.MMAlign){const aligned=window.MMAlign.snap(d.original,d.dx,d.dy,e.altKey);d.dx=aligned.dx;d.dy=aligned.dy;}
    for (const s of d.original) putLayerPos(s.id, {x:s.x+d.dx,y:s.y+d.dy});
    draw(true);
  }
  function commitPreview(snapshot, cancel) {
    window.MMAlign?.clear();
    if (!snapshot || !cur) return;
    if (cancel) restoreHistory(snapshot);
    else if (JSON.stringify(cur) !== snapshot) { hist.push(historyJSON(JSON.parse(snapshot))); if (hist.length > 120) {hist.shift();for(const batch of aiBatches)batch.historyIndex--;} redo = []; storeLocal(cur); scheduleCloud(); }
    draw();
  }
  function endNodeDrag(d, cancel) {
    commitPreview(d.snap, cancel);
  }

  // ---------------- 键盘 ----------------
  function nav(key) {
    const a = L && L.nodes.get(sel); if (!a) return;
    const dx = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    const dy = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    let best = null, score = Infinity;
    for (const b of L.nodes.values()) { if (a === b) continue;
      const x = b.x + b.w / 2 - a.x - a.w / 2, y = b.y + b.h / 2 - a.y - a.h / 2;
      if (x * dx + y * dy <= 0) continue;
      const cost = Math.hypot(x,y) + Math.abs(dx ? y : x);
      if (cost < score) { best = b; score = cost; }
    } if (best) select(best.n.id, true);
  }
  document.addEventListener("keydown", (e) => {
    if (!cur || currentView() !== "mindmap" || $("mmDlg").open) return;
    const t = e.target;
    if (t.closest && t.closest("#mmShortcuts,#mmAI")) return;
    if (t.closest && (t.closest("#mmPanel, #mmFindBar,.mm-ctx") || (t.closest(".mm-tools") && t.closest("input,select,textarea"))) && !(e.key === "Escape")) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
      return;
    }
    if (t.id === "mmTitleIn" || editing) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;
    /* 【独立版·平级】Esc：取消正在拖出的连线 / 收起浮层菜单；Delete/Backspace：删掉选中的那条线。 */
    if (k === "Escape") {
      if (link) {
        link=null;const preview=document.querySelector('#mmStage .mm-linkprev');if(preview)preview.innerHTML='';
        document.querySelectorAll('#mmStage .mm-magwrap').forEach(el=>el.classList.remove('linking','mag-on','hot'));
        $('mmView').classList.remove('mag-pointer');return;
      }
      const em = $("mmEdgeMenu");
      const nm = $("mmNodeMenu"); if (nm && !nm.classList.contains("hidden")) { hideNodeMenu(); return; }
      if (em && !em.classList.contains("hidden")) { hideEdgeMenu(); return; }
    }
    if ((k === "Delete" || k === "Backspace") && selEdgeObj()) { e.preventDefault(); delSelEdge(); return; }
    if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redoIt() : undo(); return; }
    if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); redoIt(); return; }
    if (ctrl && k.toLowerCase() === "f") { e.preventDefault(); openFind(); return; }
    if (ctrl && ["c","x"].includes(k.toLowerCase())) return;
    if (ctrl && k.toLowerCase() === "b") { e.preventDefault(); const r = findNode(sel); if (r) setProp("bold", !r.n.bold); return; }
    if (ctrl && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(view.k * 1.2); return; }
    if (ctrl && k === "-") { e.preventDefault(); zoomAt(view.k / 1.2); return; }
    if (ctrl && k === "0") { e.preventDefault(); fit(true); return; }
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); window.MMFiles?.save(); return; }
    if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); const r = findNode(sel); if (r) { const c = clone(r.n); c.id = nid(); change(() => cur.nodes.push(c)); select(c.id, true); } return; }
    if (ctrl) return;
    if (k === "Tab" || k === "Enter") { e.preventDefault(); return; }
    if (k === "Insert") { e.preventDefault(); addChild(); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); del(); return; }
    if (k === " ") { e.preventDefault(); toggleFold(); return; }
    if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); moveSib(k === "ArrowUp" ? -1 : 1); return; }
    if (k.startsWith("Arrow")) { e.preventDefault(); nav(k); return; }
    if (k === "Escape") { select(null); if (panelOpen) togglePanel(false); return; }
  });
  for(const action of ["copy","cut"]) document.addEventListener(action,e=>{
    if(!cur || editing || currentView()!=="mindmap" || $("mmDlg").open || e.target.closest?.("input,textarea,[contenteditable=true],#mmAI,#mmShortcuts,.mm-ctx"))return;
    copySel(action==="cut",e);
  });
  document.addEventListener("paste", (e) => {
    if (!cur || currentView() !== "mindmap" || editing || $("mmDlg").open) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const data=e.clipboardData || window.clipboardData,text=data.getData("text/plain") || data.getData("text");
    e.preventDefault();
    let payload;try{payload=JSON.parse(data.getData(NODE_CLIP_TYPE));}catch {}
    if(payload?.version===2 && Array.isArray(payload.nodes))pasteSelection(payload);
    else if(payload?.node && typeof payload.node.text==="string")pasteNode(payload);
    else if(clip && String(text).replace(/\r\n/g,"\n")===String(clip.text ?? clip.node?.text).replace(/\r\n/g,"\n")) {if(clip.version===2)pasteSelection(clip);else pasteNode(clip);}
    else if(text && text.trim())pasteNode({node:{text,children:[]}});
  });

  function openFind() {
    const b = $("mmFindBar"); b.classList.remove("hidden"); const i = $("mmFindIn"); i.focus(); i.select();
  }
  function togglePanel(on) { panelOpen = on; $("mmPanel").classList.toggle("hidden", !on); if (!isMobile()) lsSet("mm_panel_v1", on); if (on) panel(); }

  document.addEventListener("click", async (e) => {
    /* 【独立版】foldSwallow 是"这一次指针手势的 click 由指针路径处理过了"的一次性标记：
       任何一次 click（哪怕下面因为 target 落成 .mm-node 而早退）都要把它**消耗掉** ——
       否则它会留到下一次激活上，把那次折叠吞掉（"点了没反应、要点第二次"）。 */
    const pendFoldSwallow = foldSwallow; foldSwallow = null;
    const b = e.target.closest("[data-mm]");
    if (!b || !b.closest("#mmBox, #mmDlg, .mm-head")) return;
    const a = b.dataset.mm, id = b.dataset.id;
    if (b.tagName !== "A") e.preventDefault();
    switch (a) {
      case "new": await create(b.dataset.tpl); break;
      case "import-home": $('mmFileOpen')?.click(); break;
      case "paste-new": pasteDlg(false); break;
      case "open": if (!e.target.closest(".mm-more")) openMap(id); break;
      case "menu": mapMenu(id); break;
      case "ren": { const e2=idxGet(id);closeDlg();const v=prompt("导图名称",e2.title);if(v?.trim())await renameMap(id,v.trim().slice(0,80));break; }
      case "dupid": duplicate(id); break;
      case "delmap": deleteMap(id); break;
      case "dclose": closeDlg(); break;
      case "child": addChild(); break;
      case "sib": addSibling(); break;
      case "del": del(); hideNodeMenu(); break;
      case "clear-marks": setProp("marks", undefined); hideNodeMenu(); break;
      case "new-group": window.MMGroups?.create(); hideNodeMenu(); break;
      case "auto-size": change(()=>{for(const id of selectedNodes)fitNode(id,true);});hideNodeMenu();break;
      case "foldsel": toggleFold(); break;
      case "edir": {                                            // 改这条线的指向（走 change：可撤销、落盘）
        const eg = (cur.edges || []).find((x) => x.id === id);
        if (eg) { const d2 = b.dataset.dir; change(() => { eg.dir = d2; }); selEdge = eg.id; }
        hideEdgeMenu(); break;
      }
      case "edel": {                                            // 删这条线（一条边一条撤销）
        const eg = (cur.edges || []).find((x) => x.id === id);
        if (eg) change(() => { cur.edges = cur.edges.filter((x) => x !== eg); selEdge = null; });
        hideEdgeMenu(); break;
      }
      case "edge-label": hideEdgeMenu(); window.MMCanvasTools?.editEdgeLabel(id); break;
      case "fold": { const sw = pendFoldSwallow === id; if (!sw) toggleFold(id); break; }   // 指针路径已折过就跳过
      case "undo": undo(); break;
      case "redo": redoIt(); break;
      case "node-style": break;
      case "media-rename": hideNodeMenu();window.MMFiles?.renameNode(id);break;
      case "node-ask": endEdit(); select(id); hideNodeMenu(); togglePanel(false); window.MMAI?.open(id); break;
      case "style": togglePanel(!panelOpen); break;
      case "pclose": togglePanel(false); break;
      case "find": openFind(); break;
      case "fnext": stepFind(1); break;
      case "fprev": stepFind(-1); break;
      case "fclose": $("mmFindBar").classList.add("hidden"); found = []; q = ""; draw(); break;
      case "paste-in": pasteDlg(true); break;
      case "export": exportDlg(); break;
      case "ex-png": closeDlg(); exportPng(); break;
      case "ex-md": closeDlg(); download(safeName() + ".md", nodesArr().map(n => {
        const text=window.MMContent && window.MMContent.isRich(n.text)?n.text:toMarkdown(n),record=n.aiEntry && cur.aiMemory?.turns?.find(t=>t.id===n.aiTurnId);
        return text+(record && window.MMAILearning?'\n\n'+window.MMAILearning.markdown(record.learning):'');
      }).join("\n\n---\n\n"), "text/markdown"); break;
      case "ex-txt": { closeDlg(); const text = nodesArr().map(n => n.text).join("\n\n"); try { await navigator.clipboard.writeText(text); tip("节点列表已复制，可以直接粘贴"); } catch (err) { download(safeName() + ".txt", text, "text/plain"); } break; }
      case "ex-json": closeDlg(); download(safeName() + ".json", JSON.stringify({ app: "laolao-mindmap", ...cur }, null, 1), "application/json"); break;
      case "dup": duplicate(cur.id); break;
      case "zin": zoomAt(view.k * 1.2); break;
      case "zout": zoomAt(view.k / 1.2); break;
      case "fit": fit(true); break;
      case "lv": { let any = false; walk(topNode(), (n, p, d) => { if (d >= 2 && !isFold(n) && (n.children || []).length) any = true; }); foldLevel(any ? 2 : 0); break; }
      case "lv1": foldLevel(1); break;
      case "lv2": foldLevel(2); break;
      case "lv0": foldLevel(0); break;
      case "color": setProp("color", b.dataset.v || undefined); hideNodeMenu(); break;
      case "bold": { const r = findNode(sel); if (r) setProp("bold", !r.n.bold); break; }
      case "mark": toggleMark(b.dataset.v); hideNodeMenu(); break;
      case "prog": setProp("progress", +b.dataset.v || undefined); hideNodeMenu(); break;
      case "parent": addParent(); break;
      case "side": { const r = findNode(sel), s = L.nodes.get(sel); if (r) change(() => { r.n.side = s.side > 0 ? "l" : "r"; }); break; }
      case "back": if (cur && window.MMFiles) window.MMFiles.exit(true); else if(cur)closeMap(); else showView("tools"); break;
      case "note": case "link": { const nd = b.closest(".mm-node"); if (nd) { select(nd.dataset.id); if (a === "link") { const n = findNode(nd.dataset.id).n; window.open(safeUrl(n.link), "_blank", "noopener"); } else togglePanel(true); } break; }
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!cur && t.id !== "mmFileOpen") return;
    if(t.id==="mmNodeColorPick") {setProp("color",t.value);hideNodeMenu();}
    if (t.id === "mmLayout" || t.id === "mmLine" || t.id === "mmTheme") {
      const k = { mmLayout: "layout", mmLine: "line", mmTheme: "theme" }[t.id];
      change(() => { cur[k] = t.value; if (k === "layout") walk(topNode(), (n) => { delete n.side; }); });
      pref[k] = t.value; lsSet(LS_PREF, pref);
      if (k === "layout") setTimeout(() => fit(true), 20);
    }
    if (t.id === "mmNote") setProp("note", t.value.trim() ? t.value : undefined);
    if (t.id === "mmLink") setProp("link", t.value.trim() || undefined);
    if (t.id === "mmFileOpen") { readFile(t.files[0]); t.value = ""; }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "mmFindIn") { clearTimeout(findTimer); findTimer = setTimeout(doFind, 200); }
    if (t.id === "mmListQ") { listQ = t.value; t.dataset.f = 1; renderList(); const s = $("mmListQ"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  });
  let findTimer = 0;
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "mmFindIn") { if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } if (e.key === "Escape") { e.preventDefault(); $("mmFindBar").classList.add("hidden"); found = []; draw(); $("mmView").focus(); } }
    if (e.target.id === "mmTitleIn" && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    if (e.target.classList && e.target.classList.contains("mm-card") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.target.click(); }
  }, true);
  // 改标题 = 改中心主题
  document.addEventListener("focusout", (e) => {
    if (e.target.id !== "mmTitleIn" || !cur) return;
    const v = e.target.value.trim(); if (v && v !== cur.title) change(() => { cur.title = v.slice(0, 80); });
  });
  $("mmDlg").addEventListener("click", (e) => { if (e.target === $("mmDlg")) closeDlg(); });
  window.addEventListener("resize", () => { if (cur && currentView() === "mindmap") { fitBox(); applyView(); } });
  // 顶部提示条出现 / 消失时，画布高度跟着变（不然底部的缩放按钮会被挤到屏幕外）
  try { new ResizeObserver(() => { if (cur && currentView() === "mindmap") fitBox(); }).observe($("banner")); } catch (e) {}

  // ---------------- 进入 / 离开这个页面；别的设备改了 ----------------
  window.renderMindmap = () => {
    if (cur) { document.body.classList.add("mm-editing"); setTimeout(() => { fitBox(); draw(); }, 30); return; }
    refreshHome();
  };
  window.mmLeave = () => { document.body.classList.remove("mm-editing"); if (cur) { endEdit(); pushDirty(); } };
  window.addEventListener('focus',()=>{if(!cur && currentView()==='mindmap')refreshHome();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && !cur && currentView()==='mindmap')refreshHome();});
  /* ===== [独立版] 云同步停用：跨设备变更订阅（Sync.onChange）+ 登录后自动上传 =====
  try {
    Sync.onChange((set) => {
      if (!set || !set.has || !set.has(LS_REV)) return;
      pullList().then(async () => {
        if (cur) { const e = idxGet(cur.id); if (!e) { tip("这张导图在别的设备上被删了"); closeMap(); return; } if (e.server > (e.version || 0) && !e.dirty) { const s = sel, v = { ...view }; await openMap(cur.id, true); sel = findNode(s) ? s : topNode().id; view = v; draw(); tip("别的设备改了这张图，已更新", 1800); } }
        else if (currentView() === "mindmap") renderList();
      });
    });
  } catch (e) {}
  // 登录后：把没登录时画的图传到账号里
  let lastUid = me() ? me().id : null;
  setInterval(() => { const u = me() ? me().id : null; if (u !== lastUid) { lastUid = u; if (u) { index.forEach((e) => { if (!e.uid) { e.uid = u; e.dirty = true; } }); idxSave(); pullList(); } if (currentView() === "mindmap" && !cur) renderList(); } }, 2000);
  window.addEventListener("beforeunload", () => { if (index.some((x) => x.dirty) && me()) pushDirty(); });
  ===== [独立版] 云同步停用结束 ===== */
  window.Mindmap = {
    noteFile,
    finishEditing: () => {window.dispatchEvent(new Event("mm:ai-interrupt"));window.MMPDF?.capture();const title=$('mmTitleIn')?.value;endEdit();if(cur && title?.trim() && title.trim()!==cur.title)change(()=>{cur.title=title.trim().slice(0,80);});},
    editingSnapshot: () => {if(!cur)return null;const map=clone(cur),ta=document.querySelector('.mm-edit');if(ta && editing){const node=map.nodes.find(n=>n.id===editing);if(node){node.text=ta.value;if(ta._nodeStyle)window.MMFormat.apply(node,ta._nodeStyle);}}const title=$('mmTitleIn')?.value?.trim();if(title)map.title=title;return map;},
    fitNode,
    scrollGesture:()=>lastScroll,
    resetScroll:()=>resetScroll(),
    toggleTask: (id,line,checked) => {const n=findNode(id)?.n;if(!n || n.image || n.pdf || !Number.isInteger(line))return;const text=window.MMFormat.taskText(n.text,line,checked);if(text!==n.text)change(()=>{n.text=text;fitNode(id);});},
    replaceDocument: map => {cur=clone(map);storeLocal(cur);draw();},
    leaveDocument: map => {if(map){cur=clone(map);storeLocal(cur);}closeMap(true);},
    zoom: zoomAt,
    editMap: fn => change(fn),
    syncMedia: files => {
      if(!cur)return;let dirty=false;
      for(const file of files){let old=(cur.media ||= []).find(m=>m.id===file.id);if(!old){cur.media.push(clone(file));dirty=true;}
        else {const next={...old,...file};if(JSON.stringify(old)!==JSON.stringify(next)){Object.assign(old,next);dirty=true;}}
      }
      if(dirty){storeLocal(cur);draw();}
    },
    selectNode: id => select(id,true),
    selectNodes: ids => selectNodes(ids),
    commitPreview,
    preview: () => draw(true),
    revealBox: box => { const r=$("mmView").getBoundingClientRect(); view.x=r.width/2-(box.x+box.w/2)*view.k; view.y=r.height/2-(box.y+box.h/2)*view.k; applyView(); },
    ensureVisible: box => {const r=$("mmView").getBoundingClientRect(),left=view.x+box.x*view.k,top=view.y+box.y*view.k,right=left+box.w*view.k,bottom=top+box.h*view.k;view.x+=left<12?12-left:right>r.width-12?r.width-12-right:0;view.y+=top<12?12-top:bottom>r.height-12?r.height-12-bottom:0;applyView();},
    view: () => ({...view}),
    clientPoint: (cx,cy) => {const r=$("mmView").getBoundingClientRect();return {x:(cx-r.left-view.x)/view.k,y:(cy-r.top-view.y)/view.k};},
    openDocument: m => { if(!m || !m.id || !Array.isArray(m.nodes)) throw new Error("无效的导图文件"); storeLocal(m); return openMap(m.id); },
    addImage: (media,at) => {
      const node={id:nid(),text:"",image:media.id,children:[]};
      change(()=>{const files=(cur.media ||= []);if(!files.some(m=>m.id===media.id)) files.push(media);cur.nodes.push(node);putLayerPos(node.id,at || {x:0,y:0});});select(node.id,true);return node.id;
    },
    addPDF: (media,at) => {const node={id:nid(),text:'',pdf:media.id,children:[]};change(()=>{if(!(cur.media ||= []).some(m=>m.id===media.id))cur.media.push(media);cur.nodes.push(node);putLayerPos(node.id,at || {x:0,y:0});(cur.pdfViews ||= {})[node.id]={page:1,scale:'page-width'};});select(node.id,true);return node.id;},
    updatePDFView: (id,value) => {if(!cur || !findNode(id)?.n.pdf)return;const views=(cur.pdfViews ||= {});if(JSON.stringify(views[id])===JSON.stringify(value))return;views[id]=clone(value);storeLocal(cur);},
    pushAISummary,
    pushAISummaries,
    pushAIGraph,
    pushAIPresentation,
    appendAIResult,
    endAIBatch: batch => aiBatches.delete(batch),
    saveAIRecord: (record,ownership) => {
      if(!cur || !window.MMAIMemory)return;
      window.MMAIMemory.merge(cur,record,ownership);
      storeLocal(cur);scheduleCloud();draw();
    },
    setAILearning: (turnId,patch) => {
      const record=cur?.aiMemory?.turns?.find(t=>t.id===turnId);if(!record || !patch || !window.MMAILearning)return false;
      const state=window.MMAILearning.normalize(record.learning);
      if(typeof patch.expanded==='boolean')state.expanded=patch.expanded;
      if(Array.isArray(patch.checked))state.checked=window.MMAILearning.normalize(patch).checked;
      if(JSON.stringify(record.learning)===JSON.stringify(state))return true;
      record.learning=state;storeLocal(cur);scheduleCloud();draw();return true;
    },
    measureAINode: text => measure({text},0),
    refresh: () => { if (cur) draw(); },
    parseText, toMarkdown,
    /* 【独立版】**"扫哪些表"的唯一真相来源**：del 清理 / 读取容错 / 导入 / 自测台孤儿判据
       全部读这两个数组（自测台不许再写一份字面量）。加新表只改上面那两行。 */
    LAYER_MAPS, LAYER_LISTS,
    state: () => ({ cur, sel, selected: [...selectedNodes], editing, mode, index, L }), open: openMap, create,
    /* 【独立版】导出给断言读**同一处**：多容器下 findNode 必须能找到非第一个容器里的节点，
       断言不能自己再写一份遍历（自写遍历只是证明"夹具里有那个节点"，证明不了产品路径）。 */
    findNode,
    /* 【独立版】数据形状的唯一权威与"全部容器"的遍历入口：tools/ 下的脚本（含 verify-ui.mjs 的
       页内片段）一律调它们，不许自己抄 `Array.isArray(...nodes) ? ... : [.root]`。 */
    nodesOf, liveIds,
    /* 【独立版·平级】"谁看得见"的唯一权威（同 nodesOf 的地位）：tools 与渲染都读这一处。 */
    visibleIds, hiddenIds,
  };
})();
