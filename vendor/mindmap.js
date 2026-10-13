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
    fresh: { name: "清爽", bg: "#f7f9fc", grid: "#e9eef6", root: "#4f63e8", rootText: "#fff", text: "#1f2a3d", sub: "#ffffff", line: 2,
      colors: ["#4f8df5", "#2bb98a", "#f2a20c", "#8a6cf0", "#f2724b", "#e4589a", "#18a9b8", "#7aa33c"] },
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
    { id: "blank", icon: "⚪", name: "空白导图", tip: "只有一个中心主题", make: () => ({ text: "中心主题", children: [] }) },
    { id: "course", icon: "📚", name: "课程复习", tip: "章节 → 重点 / 难点 / 例题 / 易错", make: () => T("课程名", [T("第一章", [T("重点"), T("难点"), T("例题"), T("易错点")]), T("第二章", [T("重点"), T("难点")]), T("公式汇总"), T("考试范围")]) },
    { id: "exam", icon: "🎯", name: "考试准备", tip: "考点、题型、时间安排", make: () => T("期末考试", [T("考试信息", [T("时间"), T("地点"), T("题型分值")]), T("必考知识点"), T("薄弱环节"), T("复习计划", [T("第一周"), T("第二周"), T("考前一天")])]) },
    { id: "question", icon: "❓", name: "解决一个问题", tip: "问题 → 需要的知识 → 步骤", make: () => T("我遇到的问题", [T("问题是什么"), T("需要先懂的知识", [T("知识点 1"), T("知识点 2")]), T("解决步骤", [T("第一步"), T("第二步")]), T("答案 / 结论"), T("还不懂的")]) },
    { id: "book", icon: "📖", name: "读书笔记", tip: "作者、主要观点、金句、感想", make: () => T("书名", [T("作者与背景"), T("主要观点", [T("观点 1"), T("观点 2")]), T("精彩句子"), T("我的感想"), T("可以用在哪")]) },
    { id: "project", icon: "🚀", name: "项目计划", tip: "目标、分工、进度、风险", make: () => T("项目名", [T("目标"), T("分工", [T("成员 A"), T("成员 B")]), T("时间节点"), T("需要的资源"), T("风险")]) },
  ];
  function T(text, children) { return { text, children: children || [] }; }

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
  const walk = (n, f, p = null, depth = 0) => { f(n, p, depth); if (n.children) for (const c of n.children) walk(c, f, n, depth + 1); };
  const count = (n) => { let k = 0; walk(n, () => k++); return k; };
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
    return { id: uid(), title: title || root.text, layout: pref.layout, line: pref.line, theme: pref.theme, root, v: 1 };
  }
  function storeLocal(m) {
    const e = idxGet(m.id) || {};
    const ok = lsSet(mapKey(m.id), m);
    idxPut({ id: m.id, title: m.title, updated: Date.now(), nodes: count(m.root), version: e.version || 0, local: e.local ?? true, dirty: true, uid: me() ? me().id : e.uid || null });
    if (!ok) tip("这台设备的存储空间满了：登录后导图会存到账号里", 4000);
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
        const r = await rpc("mm_save", { p_id: m.id, p_title: m.title, p_data: m, p_base: e.local ? null : e.version || null, p_nodes: count(m.root) });
        if (r && r.ok) { e.version = r.version; e.local = false; e.dirty = false; e.uid = me().id; }
        else if (r && r.conflict) {
          // 别的设备先改了：我这份另存为「冲突副本」，当前打开的换成账号里的最新版
          const copy = { ...clone(m), id: uid(), title: m.title + "（冲突副本）" };
          lsSet(mapKey(copy.id), copy); index.unshift({ id: copy.id, title: copy.title, updated: Date.now(), nodes: count(copy.root), version: 0, local: true, dirty: true, uid: me().id });
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
  async function pullList() {}

  // ---------------- 状态 ----------------
  let cur = null, sel = null, editing = null, editingNew = null, hist = [], redo = [], view = { x: 0, y: 0, k: 1 }, mode = "map", q = "", found = [], clip = null, panelOpen = false, listQ = "";
  /* 【独立版】收起按钮的指针路径状态（见 bindCanvas 的 pointerdown / up）：
     foldDown = 按下时命中的收起按钮；foldSwallow = 这次折叠已经由指针路径处理过，
     浏览器随后还会补发一次 click，别在 click 委托里再折一次（否则一按一展开、净效果为零）。 */
  let foldDown = null, foldSwallow = null;
  let L = null;   // 最近一次布局：{nodes: Map(id → {n, x, y, w, h, depth, side, color, parent}), bounds}
  const node = (id) => (L && L.nodes.get(id) ? L.nodes.get(id).n : null);
  function findNode(id, n = cur && cur.root, p = null) { if (!n) return null; if (n.id === id) return { n, p }; for (const c of n.children || []) { const r = findNode(id, c, n); if (r) return r; } return null; }
  const isAncestor = (a, b) => { let r = findNode(b); while (r && r.p) { if (r.p.id === a) return true; r = findNode(r.p.id); } return false; };

  function change(fn, keepSel) {
    if (!cur) return;
    hist.push(JSON.stringify(cur)); if (hist.length > 120) hist.shift(); redo = [];
    fn();
    cur.title = String(cur.root.text || "未命名导图").split("\n")[0].slice(0, 80) || "未命名导图";
    storeLocal(cur); scheduleCloud(); draw();
  }
  function undo() { if (!hist.length) return; redo.push(JSON.stringify(cur)); cur = JSON.parse(hist.pop()); if (!findNode(sel)) sel = cur.root.id; storeLocal(cur); scheduleCloud(); draw(); tip("已撤销", 1200); }
  function redoIt() { if (!redo.length) return; hist.push(JSON.stringify(cur)); cur = JSON.parse(redo.pop()); if (!findNode(sel)) sel = cur.root.id; storeLocal(cur); scheduleCloud(); draw(); }

  // ---------------- 量字 + 布局 ----------------
  const cvs = document.createElement("canvas").getContext("2d");
  const fontOf = (depth, bold) => depth === 0 ? `700 20px ${FONT}` : depth === 1 ? `${bold ? 800 : 650} 15.5px ${FONT}` : `${bold ? 700 : 400} 14px ${FONT}`;
  const lineH = (depth) => (depth === 0 ? 28 : depth === 1 ? 22 : 20);
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
  function measure(n, depth) {
    const font = fontOf(depth, n.bold), maxW = depth === 0 ? 300 : depth === 1 ? 260 : 240;
    const pre = (n.marks || []).map((m) => MARK[m] || "").join("");
    const wr = wrapLines((pre ? pre + " " : "") + (n.text || " "), font, maxW);
    const extra = (n.note ? 20 : 0) + (n.link ? 20 : 0) + (n.progress ? 22 : 0);
    const padX = depth === 0 ? 22 : depth === 1 ? 14 : 10, padY = depth === 0 ? 12 : depth === 1 ? 8 : 6;
    // +6：边框和字体渲染的误差，免得最后一个字被挤到下一行
    return { w: Math.ceil(Math.max(depth === 0 ? 90 : 34, wr.w + extra) + padX * 2 + 6), h: wr.lines.length * lineH(depth) + padY * 2 + 2, lines: wr.lines, font, padX, padY };
  }
  function layoutAuto() {
    const th = THEMES[cur.theme] || THEMES.fresh, nodes = new Map(), lay = cur.layout || "mind";
    const HG = lay === "down" ? 26 : 46, VG = lay === "down" ? 56 : 14;
    // 1) 量大小、记颜色
    (function prep(n, depth, color, parent) {
      const m = measure(n, depth);
      const c = n.color || (depth === 0 ? th.root : color);
      /* 【独立版】尺寸在这里合并（measure 之后、nodes.set 之前）：让 span() 的缓存从一开始就按最终尺寸算 */
      const z = curSize()[n.id];
      const pinned = !!(z && Number.isFinite(z.w) && Number.isFinite(z.h) && z.w > 0 && z.h > 0);
      const cs = clampSize(pinned ? z.w : m.w, pinned ? z.h : m.h, m.w, m.h);
      if (!pinned || cs.w !== z.w || cs.h !== z.h) { curSize()[n.id] = cs; sizeDirty = true; }
      nodes.set(n.id, { n, depth, ...m, w: cs.w, h: cs.h, measW: m.w, measH: m.h, color: c, parent: parent ? parent.id : null, kids: n.fold ? [] : n.children || [] });
      /* 【独立版】折叠就**不再往下建 box**：折叠后代不进 L.nodes，于是 draw / span / nudgeFree / bounds
         全都只看得见可见节点 —— 修掉"收起后连线没了、子节点还在"（原来只有连线消失，后代照样画）。
         cur.pos / cur.size 里这些后代的条目**故意保留**：它们是"用户摆过的位置"，展开时直接用回去。 */
      if (!n.fold) (n.children || []).forEach((k, i) => prep(k, depth + 1, depth === 0 ? (k.color || th.colors[i % th.colors.length]) : c, n));
    })(cur.root, 0, th.root, null);
    const S = (id) => nodes.get(id);
    // 2) 子树大小
    const span = (n) => { const s = S(n.id); if (s.span != null) return s.span;
      const ks = s.kids; const own = lay === "down" ? s.w : s.h;
      s.span = !ks.length ? own : Math.max(own, ks.reduce((a, k) => a + span(k), 0) + VG * (ks.length - 1) * (lay === "down" ? 0 : 1) + (lay === "down" ? HG * (ks.length - 1) : 0));
      return s.span; };
    // 横向：x 往 dir 方向长，y 在 [top, top+span] 内居中
    function placeH(n, x, top, dir) {
      const s = S(n.id); span(n);
      s.side = dir; s.x = dir > 0 ? x : x - s.w; s.y = top + s.span / 2 - s.h / 2;
      const tot = s.kids.reduce((a, k) => a + span(k), 0) + VG * Math.max(0, s.kids.length - 1);
      let y = top + (s.span - tot) / 2;
      for (const k of s.kids) { placeH(k, dir > 0 ? s.x + s.w + HG : s.x - HG, y, dir); y += span(k) + VG; }
    }
    function placeV(n, left, y) {
      const s = S(n.id); span(n);
      s.side = 0; s.x = left + s.span / 2 - s.w / 2; s.y = y;
      const tot = s.kids.reduce((a, k) => a + span(k), 0) + HG * Math.max(0, s.kids.length - 1);
      let x = left + (s.span - tot) / 2;
      const rowH = Math.max(...s.kids.map((k) => S(k.id).h), 0);
      for (const k of s.kids) { placeV(k, x, y + s.h + VG + (rowH - S(k.id).h) * 0); x += span(k) + HG; }
    }
    const root = cur.root, rs = S(root.id);
    if (lay === "down") placeV(root, 0, 0);
    else if (lay === "right") placeH(root, 0, 0, 1);
    else {
      // 左右分布：按高度把一级主题分成两边（右边先放、尽量各一半）；可以手动指定 side
      const ks = rs.kids, total = ks.reduce((a, k) => a + span(k), 0);
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
  // 把这次布局里所有有坐标的节点的最终位置写回 cur.pos（只补新出现的，不删旧的）
  function syncPosFromLayout(lay) {
    const p = curPos();
    lay = lay || L || layoutWithPos();
    for (const [id, s] of lay.nodes) { if (s.x != null && s.y != null) p[id] = { x: Math.round(s.x), y: Math.round(s.y) }; }
    return p;
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
  const deltaOf = (d, id) => (d[id] || (d[id] = { dx: 0, dy: 0 }));

  /* 【独立版】节点尺寸：与坐标同层、同生命周期 —— 存在导图层 cur.size = { 节点id: {w,h} }，
     绝不写进节点字段（安卓 normalizeNode() 是白名单式过滤，会静默丢掉）。
     不变量：
       1) cur.size 里没有记录的节点，用"现有文本测量结果"落一次盘，之后不再重算（F5 重开不重算）；
       2) 最小 60×40；最大不超过该节点文本测量尺寸的 4 倍（clampSize 里换算）。 */
  const SIZE_MIN_W = 60, SIZE_MIN_H = 40, SIZE_MAX_MUL = 4;
  const curSize = () => (cur.size ||= {});
  const finNum = (v, d) => (Number.isFinite(v) ? v : d);   // 显式挡 NaN / Infinity：Math.max(60, NaN) 还是 NaN
  function clampSize(w, h, measW, measH) {
    const mw = Number.isFinite(measW) && measW > 0 ? measW : SIZE_MIN_W;
    const mh = Number.isFinite(measH) && measH > 0 ? measH : SIZE_MIN_H;
    const maxW = Math.max(SIZE_MIN_W, Math.round(mw * SIZE_MAX_MUL));
    const maxH = Math.max(SIZE_MIN_H, Math.round(mh * SIZE_MAX_MUL));
    return {
      w: Math.min(maxW, Math.max(SIZE_MIN_W, Math.round(finNum(w, SIZE_MIN_W)))),
      h: Math.min(maxH, Math.max(SIZE_MIN_H, Math.round(finNum(h, SIZE_MIN_H)))),
    };
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
    // 1) 有坐标的：直接用坐标，并记下相对旧布局的位移
    const delta = {};
    for (const [id, s] of lay.nodes) {
      if (!fixed.has(id)) continue;
      const p = pos[id], ds = deltaOf(delta, id);
      ds.dx = p.x - s.x; ds.dy = p.y - s.y;
      s.x = p.x; s.y = p.y;
    }
    // 2) 父节点有坐标的子节点：跟着父节点一起挪（父节点没动就一点不动）
    const kidsOf = {};
    for (const [id, s] of lay.nodes) {
      const pid = s.parent;
      if (!pid || !fixed.has(pid)) continue;
      (kidsOf[pid] || (kidsOf[pid] = [])).push([id, s]);
    }
    (function move(depth) {
      if (depth > 200) return;
      let moved = false;
      for (const pid of Object.keys(kidsOf)) {
        const ps = lay.nodes.get(pid);
        if (ps.done) continue;
        ps.done = true; moved = true;
        const pd = deltaOf(delta, pid);
        for (const [id, s] of kidsOf[pid]) {
          if (fixed.has(id)) continue;
          const ds = deltaOf(delta, id);
          ds.dx = pd.dx; ds.dy = pd.dy;
          s.x += ds.dx; s.y += ds.dy;
        }
      }
      if (moved) move(depth + 1);
    })(0);
    // 3) 没有坐标的节点：让开已经摆好的
    nudgeFree(lay.nodes, pos);
    // 4) 重新算外框
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of lay.nodes.values()) { if (s.x == null) continue; x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
    lay.bounds = { x0, y0, x1, y1 };
    return lay;
  }

  // 迁移播种：旧导图第一次打开（没有 pos）→ 用旧布局算法算一遍写进 pos
  // 坐标原点对齐到中心主题：根节点落在 (0,0)，整张图往左上方长也一样能看清
  function seedPos() {
    const p = curPos();
    if (Object.keys(p).length) return false;
    const lay = layoutAuto(), rs = lay.nodes.get(cur.root.id);
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
  function giveBirth(k, anchor, at) {
    const p = at || spawnPos(anchor);
    if (p) curPos()[k.id] = p;
    return k;
  }
  const layout = layoutWithPos;

  // 两个点之间的连线
  function linkPath(a, b, side, style) {
    let sx, sy, ex, ey;
    if (side === 0) { sx = a.x + a.w / 2; sy = a.y + a.h; ex = b.x + b.w / 2; ey = b.y; }
    else { sx = side > 0 ? a.x + a.w : a.x; sy = a.y + a.h / 2; ex = side > 0 ? b.x : b.x + b.w; ey = b.y + b.h / 2; }
    if (style === "straight") return `M${sx},${sy} L${ex},${ey}`;
    if (side === 0) { const my = (sy + ey) / 2; return style === "elbow" ? `M${sx},${sy} V${my} H${ex} V${ey}` : `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`; }
    const mx = sx + (ex - sx) / 2;
    return style === "elbow" ? `M${sx},${sy} H${mx} V${ey} H${ex}` : `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`;
  }
  const hidden = (n) => { let k = 0; for (const c of n.children || []) walk(c, () => k++); return k; };

  // ---------------- 画 ----------------
  const E = (s) => esc(s);
  function draw() {
    if (!cur) return;
    L = layout();
    const th = L.th, st = $("mmStage"), svg = [], html = [];
    for (const s of L.nodes.values()) {
      if (s.x == null) continue;
      for (const k of s.kids) {
        const t = L.nodes.get(k.id); if (!t || t.x == null) continue;
        svg.push(`<path d="${linkPath(s, t, t.side, cur.line)}" stroke="${t.color}" stroke-width="${s.depth === 0 ? th.line + 1 : th.line}" fill="none" stroke-linecap="round" opacity="${s.depth === 0 ? .9 : .75}"/>`);
      }
    }
    for (const s of L.nodes.values()) {
      if (s.x == null) continue;
      const n = s.n, d = s.depth, isSel = n.id === sel, hit = found.includes(n.id);
      const style = d === 0 ? `background:${s.color};color:${th.rootText};` : d === 1 ? `background:${mix(s.color, th.sub, .16)};border-color:${s.color};color:${th.text};` : `border-color:${mix(s.color, th.sub, .55)};color:${th.text};background:${th.sub};`;
      const prog = n.progress ? `<svg class="mm-prog" viewBox="0 0 16 16" title="${n.progress}%"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" opacity=".25" stroke-width="2"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="${d === 0 ? "currentColor" : s.color}" stroke-width="2.4" stroke-dasharray="${(n.progress / 100) * 40.8} 41" transform="rotate(-90 8 8)" stroke-linecap="round"/></svg>` : "";
      html.push(`<div class="mm-node d${Math.min(d, 2)}${isSel ? " sel" : ""}${hit ? " hit" : ""}${n.bold ? " b" : ""}" data-id="${n.id}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;${style}font:${s.font};line-height:${lineH(d)}px;padding:${s.padY}px ${s.padX}px">`
        + `<span class="mm-t">${E(s.lines.join("\n"))}</span>${prog}${n.note ? `<b class="mm-ic" data-mm="note" title="${E(n.note.slice(0, 100))}">📝</b>` : ""}${n.link ? `<b class="mm-ic" data-mm="link" title="${E(n.link)}">🔗</b>` : ""}`
        + ((n.children || []).length && d > 0 || (d === 0 && n.fold) ? `<button class="mm-fold${n.fold ? " on" : ""} s${s.side}" data-mm="fold" data-id="${n.id}" style="--c:${s.color}" title="${n.fold ? "展开" : "收起"}">${n.fold ? hidden(n) : "−"}</button>` : "")
        + (isSel ? `<span class="mm-rs" data-rs="1" data-id="${n.id}" title="拖动改大小（按住 Shift 锁比例）"></span>` : "")
        + `</div>`);
    }
    const b = L.bounds, pad = 400;
    st.innerHTML = `<svg class="mm-links" style="left:${b.x0 - pad}px;top:${b.y0 - pad}px;width:${b.x1 - b.x0 + pad * 2}px;height:${b.y1 - b.y0 + pad * 2}px" viewBox="${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}">${svg.join("")}</svg>${html.join("")}`;
    const vw = $("mmView");
    vw.style.background = th.bg; vw.style.setProperty("--grid", th.grid); vw.dataset.theme = cur.theme;
    applyView();
    $("mmTitleIn").value = cur.title;
    toolbarState();
    if (panelOpen) panel();
    if (mode === "outline") outline();
  }
  function mix(hex, base, a) {
    const p = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
    try { const x = p(hex), y = p(base); return "rgb(" + x.map((v, i) => Math.round(v * a + y[i] * (1 - a))).join(",") + ")"; } catch (e) { return base; }
  }
  function applyView() { const st = $("mmStage"); if (st) st.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; const z = $("mmZoom"); if (z) z.textContent = Math.round(view.k * 100) + "%"; }
  function fit(anim) {
    if (!L) return;
    const vw = $("mmView"), r = vw.getBoundingClientRect(), b = L.bounds, pad = 40;
    const w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
    const want = Math.min(r.width / w, r.height / h), minK = isMobile() ? 0.6 : 0.2;
    view.k = Math.max(minK, Math.min(1.4, want));
    if (want < minK) {
      // 手机上整张图放不下：不缩得看不清，以中心主题为准，其余的左右拖着看
      const s = L.nodes.get(cur.root.id), lay = cur.layout;
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
  function select(id, show) { sel = id; document.querySelectorAll("#mmStage .mm-node.sel").forEach((x) => x.classList.remove("sel")); const el = document.querySelector(`#mmStage .mm-node[data-id="${id}"]`); if (el) el.classList.add("sel"); toolbarState(); if (panelOpen) panel(); if (show) reveal(id); }
  function toolbarState() {
    const r = sel && findNode(sel), isRoot = !r || !r.p;
    for (const [id, off] of [["mmSib", isRoot], ["mmDel", isRoot], ["mmUndo", !hist.length], ["mmRedo", !redo.length], ["mmFold", !r || !(r.n.children || []).length]]) { const b = $(id); if (b) b.disabled = !!off; }
    const f = $("mmFold"); if (f && r) f.textContent = r.n.fold ? "▸ 展开" : "▾ 收起";
  }

  // ---------------- 编辑操作 ----------------
  function addChild(id, text) {
    const r = findNode(id || sel); if (!r) return;
    const k = { id: nid(), text: text || (r.p ? "子主题" : "分支主题"), children: [] };
    const ps = L && L.nodes.get(r.n.id);
    /* 【独立版】锚点必须用**真实盒子**（含 cur.size 固化后的尺寸），不能用 estSize 的文本估算：
       父节点被放大过时，估算宽度偏小 → 出生点算在父节点内部 → "新节点压父节点"。
       这里与 addSibling / addParent 的写法对齐（它们一开始就用 ps）。 */
    giveBirth(k, { x: ps ? ps.x : 0, y: ps ? ps.y : 0, w: ps ? ps.w : estSize(r.n.text, 1).w, h: ps ? ps.h : estSize(r.n.text, 1).h });
    change(() => { r.n.fold = false; (r.n.children ||= []).push(k); });
    sel = k.id; draw(); reveal(k.id); startEdit(k.id, true); editingNew = k.id;
  }
  function addSibling(id, before) {
    const r = findNode(id || sel); if (!r || !r.p) return addChild(id);
    const k = { id: nid(), text: r.p === cur.root ? "分支主题" : "子主题", children: [] };
    const ps = L && L.nodes.get(r.n.id);
    giveBirth(k, { x: ps ? ps.x : 0, y: ps ? ps.y : 0, w: ps ? ps.w : 150, h: ps ? ps.h : 32 });   // 【独立版】出生位置立刻固化
    change(() => { const i = r.p.children.indexOf(r.n); r.p.children.splice(before ? i : i + 1, 0, k); });
    sel = k.id; draw(); reveal(k.id); startEdit(k.id, true); editingNew = k.id;
  }
  function addParent() {
    const r = findNode(sel); if (!r || !r.p) return;
    const k = { id: nid(), text: "主题", children: [] };
    const ps = L && L.nodes.get(r.n.id);
    giveBirth(k, { x: ps ? ps.x : 0, y: ps ? ps.y : 0, w: ps ? ps.w : 150, h: ps ? ps.h : 32 });   // 【独立版】出生位置立刻固化
    change(() => { const i = r.p.children.indexOf(r.n); r.p.children.splice(i, 1, k); k.children.push(r.n); });
    sel = k.id; draw(); startEdit(k.id, true);
  }
  function del(id) {
    const r = findNode(id || sel); if (!r || !r.p) return;
    const i = r.p.children.indexOf(r.n), nx = r.p.children[i + 1] || r.p.children[i - 1] || r.p;
    /* 【独立版】删除是**整棵子树**：被删节点及全部后代的 pos / size 必须一起清。
       不清的后果：① 永久残留在导图层，随每次 change() → storeLocal 反复写回 localStorage；
       ② 残留 id 会污染 spawnPos 的判重（ids = Object.keys(pos)，351 那个 30×26 检查会误让位）。 */
    const kill = [];
    walk(r.n, (n) => kill.push(n.id));
    change(() => {
      r.p.children.splice(i, 1);
      const pos = curPos(), size = curSize();
      for (const k of kill) { delete pos[k]; delete size[k]; }
    });
    select(nx.id, true);
  }
  function moveSib(dir) {
    const r = findNode(sel); if (!r || !r.p) return;
    const a = r.p.children, i = a.indexOf(r.n), j = i + dir; if (j < 0 || j >= a.length) return;
    change(() => { a.splice(i, 1); a.splice(j, 0, r.n); }); select(r.n.id, true);
  }
  function toggleFold(id) {
    const r = findNode(id || sel); if (!r || !(r.n.children || []).length) return;
    change(() => { r.n.fold = !r.n.fold; });
    /* 【独立版】折叠后若"选中的节点"正好被藏起来（已不在 L.nodes 里），把选中挪到折叠节点上：
       否则 onL.nodes 拿不到布局项，键盘导航 / 面板 / 新建子节点的锚点都会落空。 */
    if (!(L && L.nodes.get(sel))) { sel = r.n.id; draw(); }
  }
  function foldLevel(lv) { change(() => walk(cur.root, (n, p, d) => { if ((n.children || []).length) n.fold = lv > 0 && d >= lv; })); setTimeout(() => fit(true), 20); }
  function setProp(k, v) { const r = findNode(sel); if (!r) return; change(() => { if (v === undefined || v === "" || v === false || v === null) delete r.n[k]; else r.n[k] = v; }); }
  function toggleMark(m) {
    const r = findNode(sel); if (!r) return;
    change(() => {
      let a = (r.n.marks || []).slice();
      if (a.includes(m)) a = a.filter((x) => x !== m);
      else { if (/^p\d$/.test(m)) a = a.filter((x) => !/^p\d$/.test(x)); a.unshift(m); }
      if (a.length) r.n.marks = a; else delete r.n.marks;
    });
  }
  // 复制 / 粘贴整枝（也能贴到别的导图）；系统剪贴板里是多行文字时，按大纲贴进来
  function copySel(cut) {
    const r = findNode(sel); if (!r) return;
    clip = clone(r.n);
    try { navigator.clipboard.writeText(toText(r.n, 0)); } catch (e) {}
    if (cut && r.p) del(r.n.id); else tip("已复制这一枝" + (cut ? "" : "（Ctrl+V 粘贴到别的主题下）"), 1600);
  }
  function pasteTo(id, text) {
    const r = findNode(id || sel); if (!r) return;
    let items = null;
    if (text && /\S/.test(text)) { const t = parseText(text); items = t.isRootOnly ? [t.root] : t.root.children.length && t.fromTitle ? t.root.children : [t.root]; }
    else if (clip) items = [clone(clip)];
    if (!items || !items.length) return;
    const fresh = items.map((n) => { walk(n, (x) => { x.id = nid(); }); return fill(n); });
    change(() => { r.n.fold = false; (r.n.children ||= []).push(...fresh); });
    select(fresh[0].id, true);
  }

  // 改字：节点上面盖一个输入框
  function startEdit(id, selectAll, initial) {
    const s = L && L.nodes.get(id); if (!s || s.x == null) return;
    endEdit(true);
    editing = id; sel = id; editingNew = null;
    // 手机上图缩得太小时：先放大到正常大小再改字
    if (isMobile() && view.k < 0.95) { const r = $("mmView").getBoundingClientRect(); view.k = 1; view.x = r.width / 2 - (s.x + s.w / 2); view.y = Math.min(r.height * 0.35, r.height / 2) - (s.y + s.h / 2); applyView(); }
    const el = document.querySelector(`#mmStage .mm-node[data-id="${id}"]`); if (!el) return;
    const ta = document.createElement("textarea");
    ta.className = "mm-edit"; ta.value = initial != null ? initial : s.n.text; ta.spellcheck = false;
    ta.style.cssText = `left:${s.x}px;top:${s.y}px;min-width:${Math.max(s.w, 80)}px;min-height:${s.h}px;font:${s.font};line-height:${lineH(s.depth)}px;padding:${s.padY}px ${s.padX}px;`;
    $("mmStage").appendChild(ta);
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; ta.style.width = "auto"; cvs.font = s.font; const w = Math.max(...ta.value.split("\n").map((l) => cvs.measureText(l).width)) + s.padX * 2 + 24; ta.style.width = Math.min(Math.max(s.w, w), 420) + "px"; };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const was = editing; endEdit(); if (e.ctrlKey || e.metaKey) return; if (findNode(was) && findNode(was).p) addSibling(was); }
      else if (e.key === "Tab" && !e.isComposing) { e.preventDefault(); const was = editing; endEdit(); addChild(was); }
      else if (e.key === "Escape") { e.preventDefault(); endEdit(true); }
      e.stopPropagation();
    });
    ta.addEventListener("blur", () => setTimeout(() => { if (editing === id && document.activeElement !== ta) endEdit(); }, 0));
    grow(); ta.focus();
    if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function endEdit(cancel) {
    const ta = document.querySelector("#mmStage .mm-edit"); if (!ta) { editing = null; return; }
    const id = editing, v = ta.value.replace(/\s+$/g, ""), fresh = editingNew === id;
    editing = null; editingNew = null; ta.remove();
    // 刚新建的主题按 Esc：等于没建（撤销掉那一步）
    if (cancel && fresh && hist.length) { const fr = findNode(id), back = fr && fr.p ? fr.p.id : cur.root.id; redo = []; cur = JSON.parse(hist.pop()); sel = findNode(back) ? back : cur.root.id; storeLocal(cur); scheduleCloud(); draw(); $("mmView").focus({ preventScroll: true }); return; }
    const r = findNode(id);
    if (!cancel && r && v !== r.n.text) change(() => { r.n.text = v || (r.p ? "主题" : "中心主题"); });
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
    if (!flat.length) return { root: { id: nid(), text: "中心主题", children: [] }, isRootOnly: true };
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
  function exportPng() {
    const lay = layout(), th = lay.th, b = lay.bounds, pad = 48, sc = Math.min(2, 8000 / Math.max(b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2));
    const W = Math.ceil((b.x1 - b.x0 + pad * 2) * sc), H = Math.ceil((b.y1 - b.y0 + pad * 2 + 30) * sc);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.scale(sc, sc); g.fillStyle = th.bg; g.fillRect(0, 0, W, H);
    g.translate(pad - b.x0, pad - b.y0);
    for (const s of lay.nodes.values()) {
      if (s.x == null) continue;
      for (const k of s.kids) { const t = lay.nodes.get(k.id); if (!t || t.x == null) continue; g.strokeStyle = t.color; g.lineWidth = s.depth === 0 ? th.line + 1 : th.line; g.globalAlpha = s.depth === 0 ? .9 : .75; g.lineCap = "round"; g.stroke(new Path2D(linkPath(s, t, t.side, cur.line))); }
    }
    g.globalAlpha = 1;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    for (const s of lay.nodes.values()) {
      if (s.x == null) continue;
      const d = s.depth, n = s.n;
      rr(s.x, s.y, s.w, s.h, d === 0 ? 14 : d === 1 ? 10 : 8);
      g.fillStyle = d === 0 ? s.color : d === 1 ? mix(s.color, th.sub, .16) : th.sub; g.fill();
      if (d > 0) { g.strokeStyle = d === 1 ? s.color : mix(s.color, th.sub, .55); g.lineWidth = d === 1 ? 1.6 : 1.2; g.stroke(); }
      g.fillStyle = d === 0 ? th.rootText : th.text; g.font = s.font; g.textBaseline = "middle";
      s.lines.forEach((l, i) => g.fillText(l, s.x + s.padX, s.y + s.padY + lineH(d) * (i + .5)));
      let ix = s.x + s.w - s.padX - (n.note ? 18 : 0) - (n.link ? 18 : 0) - (n.progress ? 20 : 0);
      g.font = `12px ${FONT}`;
      if (n.progress) { g.beginPath(); g.arc(ix + 9, s.y + s.h / 2, 6.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * n.progress / 100); g.strokeStyle = d === 0 ? th.rootText : s.color; g.lineWidth = 2.4; g.stroke(); ix += 20; }
      if (n.note) { g.fillText("📝", ix, s.y + s.h / 2); ix += 18; }
      if (n.link) g.fillText("🔗", ix, s.y + s.h / 2);
      if (n.fold && (n.children || []).length) { const fx = s.side < 0 ? s.x - 10 : s.side > 0 ? s.x + s.w + 10 : s.x + s.w / 2, fy = s.side === 0 ? s.y + s.h + 10 : s.y + s.h / 2; g.beginPath(); g.arc(fx, fy, 9, 0, Math.PI * 2); g.fillStyle = th.sub; g.fill(); g.strokeStyle = s.color; g.lineWidth = 1.5; g.stroke(); g.fillStyle = s.color; g.font = `700 10px ${FONT}`; g.textAlign = "center"; g.fillText(String(hidden(n)), fx, fy + .5); g.textAlign = "left"; }
    }
    g.setTransform(sc, 0, 0, sc, 0, 0); g.font = `12px ${FONT}`; g.fillStyle = th.text; g.globalAlpha = .45; g.textBaseline = "alphabetic";
    g.fillText("捞捞思维导图 · laolaokechengbiao.cn", pad, b.y1 - b.y0 + pad * 2 + 14);
    c.toBlob((blob) => { if (blob) download(safeName() + ".png", blob); else tip("图片太大了，先收起一些分支再导出"); }, "image/png");
  }

  // ---------------- 界面：列表 ----------------
  function listHtml() {
    const kw = listQ.trim().toLowerCase();
    const items = index.filter((e) => !me() || !e.uid || e.uid === me().id).filter((e) => !kw || String(e.title).toLowerCase().includes(kw));
    return `<div class="mm-list-head"><p>把知识点、问题、计划画成一张图：一个中心，一层层展开。登录后存在账号里，手机电脑都能改。</p>
      ${index.length > 6 ? `<input id="mmListQ" class="mm-search" placeholder="🔍 找导图" value="${E(listQ)}" maxlength="40">` : ""}</div>
      <div class="mm-sec"><b>新建</b><span>选一个开头，也可以把 AI 的回答直接粘贴进来</span></div>
      <div class="mm-tpls">${TEMPLATES.map((t) => `<button class="mm-tpl surface" data-mm="new" data-tpl="${t.id}"><span>${t.icon}</span><b>${t.name}</b><small>${t.tip}</small></button>`).join("")}
        <button class="mm-tpl surface" data-mm="paste-new"><span>📋</span><b>粘贴文字生成</b><small>AI 回答、Markdown、缩进列表</small></button>
        <label class="mm-tpl surface"><span>📂</span><b>打开文件</b><small>.json / .md / .txt</small><input type="file" id="mmFileOpen" accept=".json,.md,.markdown,.txt" hidden></label></div>
      <div class="mm-sec"><b>我的导图</b><span>${items.length ? items.length + " 张" : ""}${me() ? "" : " · 没登录：只存在这台设备"}</span></div>
      ${items.length ? `<div class="mm-cards">${items.map((e) => `<div class="mm-card surface" data-mm="open" data-id="${e.id}" tabindex="0" role="button">
          <div class="mc-top"><b>${E(e.title)}</b><button class="mm-more" data-mm="menu" data-id="${e.id}" aria-label="更多">⋯</button></div>
          <div class="mc-meta">${e.nodes || 1} 个主题 · ${when(e.updated)}${e.dirty && me() ? " · <i>待同步</i>" : ""}</div></div>`).join("")}</div>`
        : `<div class="mm-empty surface">${kw ? "没有找到" : "还没有导图，从上面选一个开始吧"}</div>`}`;
  }
  function renderList() {
    const box = $("mmBox"); if (!box) return;
    $("mmHeadTitle").classList.remove("hidden"); $("mmTitleIn").classList.add("hidden"); $("mmSync").classList.add("hidden");
    box.className = "mm-box list"; box.style.height = "";
    box.innerHTML = listHtml();
    const s = $("mmListQ"); if (s && s.dataset.f) s.focus();
  }

  // ---------------- 界面：编辑器 ----------------
  function editorHtml() {
    return `<div class="mm-tools" role="toolbar">
        <div class="mm-tg"><button class="mm-b pri" id="mmChild" data-mm="child" title="子主题（Tab）">＋ 子主题</button><button class="mm-b" id="mmSib" data-mm="sib" title="同级主题（Enter）">＋ 同级</button><button class="mm-b" id="mmDel" data-mm="del" title="删除（Delete）">删除</button><button class="mm-b" id="mmFold" data-mm="foldsel" title="收起 / 展开（空格）">▾ 收起</button></div>
        <div class="mm-tg"><button class="mm-b ic" id="mmUndo" data-mm="undo" title="撤销（Ctrl+Z）">↶</button><button class="mm-b ic" id="mmRedo" data-mm="redo" title="重做（Ctrl+Y）">↷</button></div>
        <div class="mm-tg"><button class="mm-b" data-mm="style" title="颜色、标记、进度、备注、链接">🎨 样式</button><button class="mm-b" data-mm="outline" id="mmOutBtn" title="大纲视图">☰ 大纲</button><button class="mm-b" data-mm="find" title="搜索（Ctrl+F）">🔍</button></div>
        <div class="mm-tg mm-sel">
          <label title="结构"><select id="mmLayout">${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
          <label title="连线"><select id="mmLine">${Object.entries(LINES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
          <label title="主题"><select id="mmTheme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("")}</select></label></div>
        <div class="mm-tg"><button class="mm-b" data-mm="paste-in" title="把一段文字加到选中的主题下面">📋 粘贴文字</button><button class="mm-b" data-mm="export" title="导出图片 / Markdown / 备份">⬇ 导出</button></div>
      </div>
      <div class="mm-findbar hidden" id="mmFindBar"><input id="mmFindIn" placeholder="搜索主题、备注…" maxlength="60"><span id="mmFindN"></span><button class="mm-b ic" data-mm="fprev">↑</button><button class="mm-b ic" data-mm="fnext">↓</button><button class="mm-b ic" data-mm="fclose">✕</button></div>
      <div class="mm-main">
        <div class="mm-view" id="mmView" tabindex="0" aria-label="思维导图画布"><div class="mm-stage" id="mmStage"></div>
          <div class="mm-zoom"><button data-mm="zout" title="缩小（Ctrl -）">−</button><span id="mmZoom">100%</span><button data-mm="zin" title="放大（Ctrl +）">＋</button><button data-mm="fit" title="适应屏幕（Ctrl 0）">⤢</button><button data-mm="lv" title="只看前两层 / 全部展开">◎</button></div>
          <div class="mm-hint" id="mmHint">${isMobile() ? "双击改字 · 长按拖动换位置 · 两指缩放" : "Tab 子主题 · Enter 同级 · F2 改字 · 拖动节点换位置 · 拖空白处移动画布 · Ctrl+滚轮缩放"}</div></div>
        <div class="mm-outline hidden" id="mmOutline"></div>
        <aside class="mm-panel hidden" id="mmPanel"></aside>
      </div>`;
  }
  // 编辑器占满屏幕剩下的高度
  function fitBox() { const b = $("mmBox"); if (!b) return; if (!cur) { b.style.height = ""; return; } if (window.scrollY) window.scrollTo(0, 0); b.style.height = Math.max(380, window.innerHeight - b.getBoundingClientRect().top - (isMobile() ? 8 : 16)) + "px"; }
  function renderEditor() {
    const box = $("mmBox");
    $("mmHeadTitle").classList.add("hidden"); $("mmTitleIn").classList.remove("hidden"); $("mmSync").classList.remove("hidden");
    box.className = "mm-box edit";
    box.innerHTML = editorHtml();
    $("mmLayout").value = cur.layout || "mind"; $("mmLine").value = cur.line || "curve"; $("mmTheme").value = cur.theme || "fresh";
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
      <div class="mp-row"><button class="mm-b${n.bold ? " on" : ""}" data-mm="bold"><b>B</b> 加粗</button>${r.p && !r.p.p && cur.layout === "mind" ? `<button class="mm-b" data-mm="side">⇄ 换到${(L.nodes.get(n.id) || {}).side > 0 ? "左边" : "右边"}</button>` : ""}<button class="mm-b" data-mm="parent" ${r.p ? "" : "disabled"}>⤴ 加上级</button></div>
      <div class="mp-sec">标记</div><div class="mp-marks">${MARKS.map(([k, ic, nm]) => `<button class="mp-m${(n.marks || []).includes(k) ? " on" : ""}" data-mm="mark" data-v="${k}" title="${nm}">${ic}<small>${nm}</small></button>`).join("")}</div>
      <div class="mp-sec">进度 <span>${n.progress || 0}%</span></div><div class="mp-prog">${[0, 25, 50, 75, 100].map((v) => `<button class="mm-b${(n.progress || 0) === v ? " on" : ""}" data-mm="prog" data-v="${v}">${v === 0 ? "无" : v + "%"}</button>`).join("")}</div>
      <div class="mp-sec">备注</div><textarea id="mmNote" rows="4" maxlength="4000" placeholder="详细解释、例题、出处…（主题上会显示 📝）">${E(n.note || "")}</textarea>
      <div class="mp-sec">链接</div><div class="mp-link"><input id="mmLink" maxlength="500" placeholder="https://…" value="${E(n.link || "")}">${n.link ? `<a class="mm-b" href="${E(safeUrl(n.link))}" target="_blank" rel="noopener">打开</a>` : ""}</div>
      <div class="mp-sec">整张图</div><div class="mp-row"><button class="mm-b" data-mm="lv1">只看一级</button><button class="mm-b" data-mm="lv2">看到二级</button><button class="mm-b" data-mm="lv0">全部展开</button></div>`;
  }
  const safeUrl = (u) => (/^(https?:)?\/\//i.test(u) ? u : /^[\w.-]+\.[a-z]{2,}/i.test(u) ? "https://" + u : "#");

  // 大纲：像写列表一样编辑（Enter 新一行、Tab 缩进、Shift+Tab 退回、空行退格删除）
  function outline(focusId) {
    const box = $("mmOutline"); if (!box) return;
    const rows = [];
    (function w(n, d) { rows.push(`<div class="mo-row" style="--d:${d}" data-id="${n.id}">${(n.children || []).length ? `<button class="mo-tog" data-mm="ofold" data-id="${n.id}">${n.fold ? "▸" : "▾"}</button>` : `<span class="mo-dot">•</span>`}<input class="mo-in${d === 0 ? " root" : ""}" data-id="${n.id}" value="${E(n.text.replace(/\n/g, " "))}" maxlength="500"></div>`); if (!n.fold) for (const c of n.children || []) w(c, d + 1); })(cur.root, 0);
    box.innerHTML = `<div class="mo-tip">Enter 新建一行 · Tab 缩进 · Shift+Tab 退回 · 空行按退格删除 · ↑↓ 换行</div>` + rows.join("");
    const f = focusId && box.querySelector(`.mo-in[data-id="${focusId}"]`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }
  function setMode(m) {
    mode = m;
    $("mmOutline").classList.toggle("hidden", m !== "outline"); $("mmView").classList.toggle("hidden", m === "outline");
    $("mmOutBtn").classList.toggle("on", m === "outline"); $("mmOutBtn").textContent = m === "outline" ? "🧠 导图" : "☰ 大纲";
    if (m === "outline") outline(sel); else { draw(); fit(); }
  }

  // ---------------- 打开 / 关闭 ----------------
  async function openMap(id, fromServer) {
    let m = lsGet(mapKey(id), null);
    const e = idxGet(id) || {};
    // [独立版] 云同步已停用：不再从账号取导图，只读本机（原 mm_get 分支及 fromServer 语义见 git 历史）
    if (!m) { tip("这张导图在这台设备上找不到了"); return; }
    fill(m.root);
    cur = m; cur.layout ||= "mind"; cur.line ||= "curve"; cur.theme ||= "fresh";
    seedPos();          // 【独立版】旧导图第一次打开：算一遍坐标写进 pos（之后不再重算）
    sel = cur.root.id; hist = []; redo = []; found = []; mode = "map"; panelOpen = !isMobile() && lsGet("mm_panel_v1", false);
    document.body.classList.add("mm-editing");
    renderEditor();
    if (panelOpen) { $("mmPanel").classList.remove("hidden"); panel(); }
    try { save("mm_last_v1", id); } catch (err) {}
  }
  function closeMap() { endEdit(); cur = null; L = null; document.body.classList.remove("mm-editing"); renderList(); try { save("mm_last_v1", ""); } catch (e) {} }
  function create(tpl, title, rootObj) {
    const m = newMap(tpl, title);
    if (rootObj) { m.root = fill(rootObj); m.title = (m.root.text || "未命名导图").slice(0, 80); }
    storeLocal(m); idxPut({ id: m.id, local: true });
    scheduleCloud();
    openMap(m.id);
    if (tpl !== "blank" || title) setTimeout(() => startEdit(m.root.id, true), 120);
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
  async function duplicate(id) {
    const m = id === (cur && cur.id) ? clone(cur) : lsGet(mapKey(id), null);
    let src = m;
    // [独立版] 云同步已停用：不再从账号取导图（原 mm_get 分支见 git 历史）
    if (!src) { tip("这张图还没下载到这台设备，先打开一次再复制"); return; }
    const c = { ...clone(src), id: uid(), title: (src.title || "导图") + " 副本" };
    walk(c.root, (n) => { n.id = nid(); }); c.root.text = c.title;
    storeLocal(c); idxPut({ id: c.id, local: true }); scheduleCloud();
    closeDlg(); if (cur) openMap(c.id); else renderList(); tip("已复制");
  }
  async function deleteMap(id) {
    const e = idxGet(id); if (!e || !confirm(`删除「${e.title}」？删除后不能恢复。`)) return;
    closeDlg();
    // [独立版] 云同步已停用：删除只作用于本机（原 mm_del 分支见 git 历史）
    lsDel(mapKey(id)); index = index.filter((x) => x.id !== id); idxSave();
    if (cur && cur.id === id) closeMap(); else renderList();
  }
  async function readFile(file) {
    if (!file) return;
    if (file.size > 3e6) { tip("文件太大了"); return; }
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      try {
        const o = JSON.parse(text); const m = o.root ? o : o.data && o.data.root ? o.data : null;
        if (!m) throw new Error();
        create("blank", null, clone(m.root));
        if (m.layout) cur.layout = m.layout; if (m.theme) cur.theme = m.theme; if (m.line) cur.line = m.line;
        storeLocal(cur); draw(); fit(); return;
      } catch (e) { tip("这个 JSON 不是思维导图备份"); return; }
    }
    const t = parseText(text); if (t.fromTitle) t.root.text = file.name.replace(/\.[^.]+$/, "");
    create("blank", null, t.root);
  }

  // ---------------- 搜索 ----------------
  let fi = 0;
  function doFind() {
    q = $("mmFindIn").value.trim().toLowerCase(); found = [];
    if (q) walk(cur.root, (n) => { if ((n.text + " " + (n.note || "")).toLowerCase().includes(q)) found.push(n.id); });
    // 搜到的在收起的分支里：展开它的上级
    for (const id of found) { let r = findNode(id); while (r && r.p) { r.p.fold = false; r = findNode(r.p.id); } }
    fi = 0; $("mmFindN").textContent = q ? (found.length ? `1 / ${found.length}` : "没找到") : "";
    draw(); if (found.length) select(found[0], true);
  }
  function stepFind(d) { if (!found.length) return; fi = (fi + d + found.length) % found.length; $("mmFindN").textContent = `${fi + 1} / ${found.length}`; select(found[fi], true); }

  // ---------------- 画布：平移、缩放、拖动节点 ----------------
  function zoomAt(k, cx, cy) {
    const r = $("mmView").getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const nk = Math.max(0.15, Math.min(3, k));
    view.x = cx - (cx - view.x) * (nk / view.k); view.y = cy - (cy - view.y) * (nk / view.k); view.k = nk; applyView();
  }
  function bindCanvas() {
    const vw = $("mmView");
    const pts = new Map(); let drag = null, pinch = null, lastTap = { t: 0, id: null }, press = 0;
    const local = (e) => { const r = vw.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k, cx: e.clientX - r.left, cy: e.clientY - r.top }; };
    /* 【独立版】八方向缩放的命中判定（全部按**屏幕像素**算，阈值不随 view.k 变形）：
       优先级：角（短路）→ 边（两边都满足取更近的一条）→ 否则视为内部拖动（返回 null）。
       小节点保护：m 取屏幕 w/h 的较小者；cornerEff=clamp(round(m*0.25),4,12)、edgeEff=clamp(round(m*0.15),3,8) 且 edgeEff ≤ cornerEff。
       判定挂在**节点盒**上，不把 .mm-rs 当命中目标（8px 的 CSS 目标不可靠，且它钉在 right:0;bottom:0 只覆盖一个方向）。 */
    const RZ = { edge: 16, corner: 22, slop: 7 };
    const CURSOR = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
    /* 【独立版】方向光标必须加在**指针下的节点元素**上（用类，不用 #mmView 的行内 style）：
       .mm-node{cursor:grab} 是 (0,1,0)，而写在 #mmView 上的行内值**赢不了后代自己的选择器**
       —— 落在节点盒内（正是要缩放的区域）用户只会看到抓手。.mm-node.rz-x 是 (0,2,0)，压得过。
       顺带把 #mmView 的行内值彻底去掉：它就是"内部区域仍读到上一次 nwse-resize"的来源。 */
    const RZCLS = ["rz-n", "rz-s", "rz-e", "rz-w", "rz-nw", "rz-ne", "rz-sw", "rz-se"];
    let rzEl = null;
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
      /* 【独立版】收起按钮走**指针**路径，不再只靠 click 的 target：
         click 的 target 是 mousedown / mouseup 的**共同祖先** —— 按下落在按钮上、松手偏一点落到节点上，
         target 就变成 .mm-node，文档级 click 委托收到时 closest("[data-mm]") 是 null，这次折叠整条丢掉。
         真实浏览器实测的"第一次点按钮没用、要点第二次"就是这个形态。
         按下记下来 → 松手没怎么动才算一次点击（拖开 = 取消），折叠在这一步完成。 */
      const fb = e.target.closest("[data-mm=fold]");
      foldDown = null;              // 每次按下都从干净状态开始：万一上一次按下没等到 pointerup（指针跑到窗口外），陈旧值不会误折
      if (fb) {
        foldDown = { id: fb.dataset.id, sx: e.clientX, sy: e.clientY, moved: false };
        try { vw.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        return;
      }
      if (e.target.closest(".mm-zoom, .mm-edit, .mm-ic")) return;
      /* 【独立版】八方向缩放：命中按屏幕几何算（zoneAt），不再依赖 .mm-rs 元素 */
      if (cur) {
        const hz = zoneAt(e.clientX, e.clientY), s0 = hz && L && L.nodes.get(hz.id);
        if (hz && s0) {
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
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; clearTimeout(press); return; }
      const nd = e.target.closest(".mm-node");
      if (editing && (!nd || nd.dataset.id !== editing)) endEdit();
      drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, id: nd ? nd.dataset.id : null, moved: false, node: false, touch: e.pointerType === "touch" };
      if (nd && e.pointerType === "touch") press = setTimeout(() => { if (drag && !drag.moved) { drag.node = true; buzz(15); startNodeDrag(drag, e); } }, 380);
      try { vw.setPointerCapture(e.pointerId); } catch (err) {}
    });
    vw.addEventListener("pointermove", (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      /* 收起按钮：拖开超过阈值就算取消（与节点拖动同一套 6px 阈值） */
      if (foldDown && !foldDown.moved && Math.hypot(e.clientX - foldDown.sx, e.clientY - foldDown.sy) > 6) foldDown.moved = true;
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const r = vw.getBoundingClientRect(); zoomAt(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, pinch.cx - r.left, pinch.cy - r.top); return; }
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
        /* 西/北方向：左上角要跟着走，否则是从中心缩、不是从边缘缩 */
        if (W || N) {
          const p = curPos()[z.id] || { x: z.x0, y: z.y0 };
          curPos()[z.id] = { x: W ? Math.round(z.x0 + (z.w0 - cs.w)) : p.x, y: N ? Math.round(z.y0 + (z.h0 - cs.h)) : p.y };
        }
        if (z.raf) cancelAnimationFrame(z.raf);
        z.raf = requestAnimationFrame(() => { try { draw(); } catch (err) {} });   // 重画：连线端点跟着尺寸一起重锚
        return;
      }
      /* 未在拖动：指针进入某方向命中区就给**那个节点**加方向类（角 > 边；内部维持原光标） */
      if (!drag) { const hz = zoneAt(e.clientX, e.clientY); markZone(hz && hz.id, hz && hz.dir); return; }
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) { drag.moved = true; clearTimeout(press); if (drag.id && !drag.touch && drag.id !== cur.root.id) { drag.node = true; startNodeDrag(drag, e); } }
      if (drag.node) moveNodeDrag(drag, e, local(e));
      else { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); vw.classList.add("panning"); }
    });
    const up = (e) => {
      pts.delete(e.pointerId); clearTimeout(press);
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
        hist.push(d.resize.snap); if (hist.length > 120) hist.shift(); redo = [];
        try { storeLocal(cur); } catch (e) {}
        try { scheduleCloud(); } catch (e) {}
        draw();
        return;
      }
      if (d.node) { endNodeDrag(d); return; }
      if (d.moved) return;
      if (d.id) {
        const now = Date.now();
        if (lastTap.id === d.id && now - lastTap.t < 350) { startEdit(d.id); lastTap = { t: 0, id: null }; return; }
        lastTap = { t: now, id: d.id };
        select(d.id);
      }
    };
    vw.addEventListener("pointerup", up); vw.addEventListener("pointercancel", up);
    vw.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = vw.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
    }, { passive: false });
    /* 【独立版】双击：节点 → 选中并进编辑（不再靠上条 350ms 判定当主路径）；
       空白 → 在**鼠标位置**新建一个节点（中心落在鼠标点），出生即固化坐标。
       新节点挂到**根节点**下：数据是纯树、渲染从 cur.root 递归开始，没有父节点的节点不会被画出来；
       挂根既满足"不挂到当前选中节点下面"（自由画布上到处双击不该都长在选中节点下），又保证它能被渲染。 */
    vw.addEventListener("dblclick", (e) => {
      if (e.target.closest(".mm-zoom")) return;
      const nd = e.target.closest(".mm-node");
      if (nd) { const id = nd.dataset.id; if (id) { select(id); startEdit(id); } return; }
      if (!cur) return;
      const p = local(e), k = { id: nid(), text: "分支主题", children: [] }, m = estSize("分支主题", 1);
      giveBirth(k, null, { x: Math.round(p.x - m.w / 2), y: Math.round(p.y - m.h / 2) });   // 一次 dblclick 只建一个
      change(() => { (cur.root.children ||= []).push(k); });
      sel = k.id; draw(); startEdit(k.id, true); editingNew = k.id;
    });
  }
  // 拖节点：放到别的主题中间 = 成为它的子主题；放到上 / 下边缘 = 插到它前面 / 后面
  function startNodeDrag(d, e) {
    if (d.id === cur.root.id) { d.node = false; return; }
    const el = document.querySelector(`#mmStage .mm-node[data-id="${d.id}"]`); if (!el) return;
    d.ghost = el.cloneNode(true); d.ghost.classList.add("ghost"); d.ghost.classList.remove("sel"); $("mmStage").appendChild(d.ghost);
    el.classList.add("dragging"); select(d.id);
  }
  function moveNodeDrag(d, e, p) {
    if (!d.ghost) return;
    const s = L.nodes.get(d.id); d.ghost.style.left = p.x - s.w / 2 + "px"; d.ghost.style.top = p.y - s.h / 2 + "px";
    document.querySelectorAll("#mmStage .drop-in, #mmStage .drop-before, #mmStage .drop-after").forEach((x) => x.classList.remove("drop-in", "drop-before", "drop-after"));
    d.target = null;
    for (const t of L.nodes.values()) {
      if (t.x == null || t.n.id === d.id || isAncestor(d.id, t.n.id)) continue;
      if (p.x < t.x - 6 || p.x > t.x + t.w + 6 || p.y < t.y - 10 || p.y > t.y + t.h + 10) continue;
      const rel = (cur.layout === "down" ? (p.x - t.x) / t.w : (p.y - t.y) / t.h), isRoot = !t.parent;
      const where = isRoot ? "in" : rel < .25 ? "before" : rel > .75 ? "after" : "in";
      d.target = { id: t.n.id, where };
      document.querySelector(`#mmStage .mm-node[data-id="${t.n.id}"]`).classList.add("drop-" + where);
      break;
    }
  }
  function endNodeDrag(d) {
    if (d.ghost) d.ghost.remove();
    /* 【独立版】松手时把坐标落地：拖到哪，位置就是数据（写进导图层 cur.pos，不写节点字段）
     * 先按拖到的位置记坐标，再走原来的"换父子关系"；最后统一重画。 */
    const g = d.ghost;
    const px = g ? Math.round(parseFloat(g.style.left) || 0) : null;
    const py = g ? Math.round(parseFloat(g.style.top) || 0) : null;
    const tg = d.target;
    const src0 = findNode(d.id);
    /* 【独立版】坐标写入必须发生在 change() 的 fn 内部：
       change() 会先快照当前 cur，再执行 fn —— 先写坐标再进 change 的话，快照里已经含新坐标，撤销就回不去。 */
    const putPos = () => { if (px != null && py != null) curPos()[d.id] = { x: px, y: py }; };
    // 拖到空白：只落坐标、不改父子关系。走 change() 才会进撤销栈（并负责 storeLocal / draw）
    if (!tg) { if (px != null) change(putPos); else draw(); return; }
    const src = src0, dst = findNode(tg.id);
    if (!src || !dst || !src.p) { if (px != null) change(putPos); else draw(); return; }
    change(() => {
      putPos();
      src.p.children.splice(src.p.children.indexOf(src.n), 1);
      if (tg.where === "in") { dst.n.fold = false; (dst.n.children ||= []).push(src.n); }
      else { const a = dst.p.children, i = a.indexOf(dst.n); a.splice(tg.where === "before" ? i : i + 1, 0, src.n); }
      delete src.n.side;
    });
    select(d.id, true);
  }

  // ---------------- 键盘 ----------------
  function nav(key) {
    const s = L && L.nodes.get(sel); if (!s) return;
    const r = findNode(sel), lay = cur.layout, side = s.side;
    const toParent = () => r.p && select(r.p.id, true);
    const toChild = (dir) => { const ks = s.kids.filter((k) => dir == null || (L.nodes.get(k.id) || {}).side === dir); if (ks.length) select(ks[Math.floor((ks.length - 1) / 2)].id, true); };
    const sib = (d) => { if (!r.p) return; const a = r.p.children.filter((x) => lay !== "mind" || r.p !== cur.root || (L.nodes.get(x.id) || {}).side === side); const i = a.indexOf(r.n); if (a[i + d]) select(a[i + d].id, true); };
    if (lay === "down") { if (key === "ArrowUp") toParent(); else if (key === "ArrowDown") toChild(); else sib(key === "ArrowLeft" ? -1 : 1); return; }
    if (key === "ArrowUp" || key === "ArrowDown") { sib(key === "ArrowUp" ? -1 : 1); return; }
    const right = key === "ArrowRight";
    if (!r.p) { toChild(right ? 1 : -1); return; }
    if ((side > 0) === right) { if (r.n.fold) toggleFold(); else toChild(); } else toParent();
  }
  document.addEventListener("keydown", (e) => {
    if (!cur || currentView() !== "mindmap" || $("mmDlg").open) return;
    const t = e.target;
    if (t.classList && t.classList.contains("mo-in")) { outlineKey(e); return; }
    if (t.closest && t.closest("#mmPanel, #mmFindBar, .mm-tools") && !(e.key === "Escape")) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
      return;
    }
    if (t.id === "mmTitleIn" || editing || mode === "outline") return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;
    if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redoIt() : undo(); return; }
    if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); redoIt(); return; }
    if (ctrl && k.toLowerCase() === "f") { e.preventDefault(); openFind(); return; }
    if (ctrl && k.toLowerCase() === "c") { e.preventDefault(); copySel(false); return; }
    if (ctrl && k.toLowerCase() === "x") { e.preventDefault(); copySel(true); return; }
    if (ctrl && k.toLowerCase() === "b") { e.preventDefault(); const r = findNode(sel); if (r) setProp("bold", !r.n.bold); return; }
    if (ctrl && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(view.k * 1.2); return; }
    if (ctrl && k === "-") { e.preventDefault(); zoomAt(view.k / 1.2); return; }
    if (ctrl && k === "0") { e.preventDefault(); fit(true); return; }
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); pushDirty(); tip("已保存", 1200); return; }
    if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); const r = findNode(sel); if (r && r.p) { const c = clone(r.n); walk(c, (x) => { x.id = nid(); }); change(() => r.p.children.splice(r.p.children.indexOf(r.n) + 1, 0, c)); select(c.id, true); } return; }
    if (ctrl) return;
    if (k === "Tab") { e.preventDefault(); if (e.shiftKey) { const r = findNode(sel); if (r && r.p) select(r.p.id, true); } else addChild(); return; }
    if (k === "Enter") { e.preventDefault(); if (e.shiftKey) addSibling(sel, true); else { const r = findNode(sel); if (r && r.p) addSibling(); else startEdit(sel); } return; }
    if (k === "Insert") { e.preventDefault(); addChild(); return; }
    if (k === "F2") { e.preventDefault(); startEdit(sel); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); del(); return; }
    if (k === " ") { e.preventDefault(); toggleFold(); return; }
    if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); moveSib(k === "ArrowUp" ? -1 : 1); return; }
    if (k.startsWith("Arrow")) { e.preventDefault(); nav(k); return; }
    if (k === "Escape") { if (panelOpen) togglePanel(false); return; }
    if (k.length === 1 && !e.altKey && sel) { e.preventDefault(); startEdit(sel, false, k); }
  });
  document.addEventListener("paste", (e) => {
    if (!cur || currentView() !== "mindmap" || editing || mode === "outline" || $("mmDlg").open) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    e.preventDefault();
    if (text && text.trim() && (!clip || text.trim() !== toText(clip, 0).trim())) pasteTo(sel, text); else if (clip) pasteTo(sel);
  });
  function openFind() { const b = $("mmFindBar"); b.classList.remove("hidden"); const i = $("mmFindIn"); i.focus(); i.select(); }
  function togglePanel(on) { panelOpen = on; $("mmPanel").classList.toggle("hidden", !on); if (!isMobile()) lsSet("mm_panel_v1", on); if (on) panel(); }

  // 大纲的键盘
  function outlineKey(e) {
    const id = e.target.dataset.id, r = findNode(id); if (!r) return;
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const k = { id: nid(), text: "", children: [] };
      change(() => { if (!r.p || (r.n.children.length && !r.n.fold)) r.n.children.unshift(k); else r.p.children.splice(r.p.children.indexOf(r.n) + 1, 0, k); });
      sel = k.id; outline(k.id);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) { if (!r.p || !findNode(r.p.id).p) return; const gp = findNode(r.p.id).p; change(() => { r.p.children.splice(r.p.children.indexOf(r.n), 1); gp.children.splice(gp.children.indexOf(r.p) + 1, 0, r.n); }); }
      else { if (!r.p) return; const i = r.p.children.indexOf(r.n); if (i < 1) return; const prev = r.p.children[i - 1]; change(() => { r.p.children.splice(i, 1); prev.fold = false; (prev.children ||= []).push(r.n); }); }
      outline(id);
    } else if (e.key === "Backspace" && !e.target.value && r.p && !(r.n.children || []).length) {
      e.preventDefault();
      const rows = [...document.querySelectorAll("#mmOutline .mo-in")], i = rows.indexOf(e.target), prev = rows[i - 1];
      change(() => r.p.children.splice(r.p.children.indexOf(r.n), 1));
      outline(prev ? prev.dataset.id : null);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const rows = [...document.querySelectorAll("#mmOutline .mo-in")], i = rows.indexOf(e.target), n = rows[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (n) { e.preventDefault(); n.focus(); }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); outline(); }
  }

  // ---------------- 点击 ----------------
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mm]");
    if (!b || !b.closest("#mmBox, #mmDlg, .mm-head")) return;
    const a = b.dataset.mm, id = b.dataset.id;
    if (b.tagName !== "A") e.preventDefault();
    switch (a) {
      case "new": create(b.dataset.tpl); break;
      case "paste-new": pasteDlg(false); break;
      case "open": if (!e.target.closest(".mm-more")) openMap(id); break;
      case "menu": mapMenu(id); break;
      case "ren": { const e2 = idxGet(id); closeDlg(); const v = prompt("导图名称", e2.title); if (!v || !v.trim()) break;
        const m = lsGet(mapKey(id), null); if (m) { m.title = v.trim().slice(0, 80); m.root.text = m.title; lsSet(mapKey(id), m); }
        idxPut({ id, title: v.trim().slice(0, 80), updated: Date.now(), dirty: !!m });
        scheduleCloud();   // [独立版] 云同步已停用：只改本机（原 mm_rename 分支见 git 历史）
        renderList(); break; }
      case "dupid": duplicate(id); break;
      case "delmap": deleteMap(id); break;
      case "dclose": closeDlg(); break;
      case "child": addChild(); break;
      case "sib": addSibling(); break;
      case "del": del(); break;
      case "foldsel": toggleFold(); break;
      case "fold": { const sw = foldSwallow === id; foldSwallow = null; if (!sw) toggleFold(id); break; }   // 指针路径已折过就跳过
      case "undo": undo(); break;
      case "redo": redoIt(); break;
      case "style": togglePanel(!panelOpen); break;
      case "pclose": togglePanel(false); break;
      case "outline": setMode(mode === "outline" ? "map" : "outline"); break;
      case "ofold": { const r = findNode(id); if (r) { change(() => { r.n.fold = !r.n.fold; }); outline(id); } break; }
      case "find": openFind(); break;
      case "fnext": stepFind(1); break;
      case "fprev": stepFind(-1); break;
      case "fclose": $("mmFindBar").classList.add("hidden"); found = []; q = ""; draw(); break;
      case "paste-in": pasteDlg(true); break;
      case "export": exportDlg(); break;
      case "ex-png": closeDlg(); exportPng(); break;
      case "ex-md": closeDlg(); download(safeName() + ".md", toMarkdown(cur.root), "text/markdown"); break;
      case "ex-txt": closeDlg(); try { await navigator.clipboard.writeText(toText(cur.root, 0)); tip("大纲已复制，可以直接粘贴"); } catch (err) { download(safeName() + ".txt", toText(cur.root, 0), "text/plain"); } break;
      case "ex-json": closeDlg(); download(safeName() + ".json", JSON.stringify({ app: "laolao-mindmap", v: 1, ...cur }, null, 1), "application/json"); break;
      case "dup": duplicate(cur.id); break;
      case "zin": zoomAt(view.k * 1.2); break;
      case "zout": zoomAt(view.k / 1.2); break;
      case "fit": fit(true); break;
      case "lv": { let any = false; walk(cur.root, (n, p, d) => { if (d >= 2 && !n.fold && (n.children || []).length) any = true; }); foldLevel(any ? 2 : 0); break; }
      case "lv1": foldLevel(1); break;
      case "lv2": foldLevel(2); break;
      case "lv0": foldLevel(0); break;
      case "color": setProp("color", b.dataset.v || undefined); break;
      case "bold": { const r = findNode(sel); if (r) setProp("bold", !r.n.bold); break; }
      case "mark": toggleMark(b.dataset.v); break;
      case "prog": setProp("progress", +b.dataset.v || undefined); break;
      case "parent": addParent(); break;
      case "side": { const r = findNode(sel), s = L.nodes.get(sel); if (r) change(() => { r.n.side = s.side > 0 ? "l" : "r"; }); break; }
      case "back": if (cur) closeMap(); else showView("tools"); break;
      case "note": case "link": { const nd = b.closest(".mm-node"); if (nd) { select(nd.dataset.id); if (a === "link") { const n = findNode(nd.dataset.id).n; window.open(safeUrl(n.link), "_blank", "noopener"); } else togglePanel(true); } break; }
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!cur && t.id !== "mmFileOpen") return;
    if (t.id === "mmLayout" || t.id === "mmLine" || t.id === "mmTheme") {
      const k = { mmLayout: "layout", mmLine: "line", mmTheme: "theme" }[t.id];
      change(() => { cur[k] = t.value; if (k === "layout") walk(cur.root, (n) => { delete n.side; }); });
      pref[k] = t.value; lsSet(LS_PREF, pref);
      if (k === "layout") setTimeout(() => fit(true), 20);
    }
    if (t.id === "mmNote") setProp("note", t.value.trim() ? t.value : undefined);
    if (t.id === "mmLink") setProp("link", t.value.trim() || undefined);
    if (t.id === "mmFileOpen") { readFile(t.files[0]); t.value = ""; }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains("mo-in")) { const r = findNode(t.dataset.id); if (r) { r.n.text = t.value; clearTimeout(outlineTimer); outlineTimer = setTimeout(() => { hist.push(JSON.stringify(cur)); cur.title = (cur.root.text || "未命名导图").slice(0, 80); $("mmTitleIn").value = cur.title; storeLocal(cur); scheduleCloud(); }, 500); } }
    if (t.id === "mmFindIn") { clearTimeout(findTimer); findTimer = setTimeout(doFind, 200); }
    if (t.id === "mmListQ") { listQ = t.value; t.dataset.f = 1; renderList(); const s = $("mmListQ"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  });
  let outlineTimer = 0, findTimer = 0;
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "mmFindIn") { if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } if (e.key === "Escape") { e.preventDefault(); $("mmFindBar").classList.add("hidden"); found = []; draw(); $("mmView").focus(); } }
    if (e.target.id === "mmTitleIn" && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    if (e.target.classList && e.target.classList.contains("mm-card") && e.key === "Enter") e.target.click();
  }, true);
  // 改标题 = 改中心主题
  document.addEventListener("focusout", (e) => {
    if (e.target.id !== "mmTitleIn" || !cur) return;
    const v = e.target.value.trim(); if (v && v !== cur.title) change(() => { cur.root.text = v; });
  });
  $("mmDlg").addEventListener("click", (e) => { if (e.target === $("mmDlg")) closeDlg(); });
  window.addEventListener("resize", () => { if (cur && currentView() === "mindmap") { fitBox(); applyView(); } });
  // 顶部提示条出现 / 消失时，画布高度跟着变（不然底部的缩放按钮会被挤到屏幕外）
  try { new ResizeObserver(() => { if (cur && currentView() === "mindmap") fitBox(); }).observe($("banner")); } catch (e) {}

  // ---------------- 进入 / 离开这个页面；别的设备改了 ----------------
  window.renderMindmap = () => {
    if (cur) { document.body.classList.add("mm-editing"); setTimeout(() => { fitBox(); draw(); }, 30); return; }
    renderList();
    pullList().then(() => { if (!cur && currentView() === "mindmap") renderList(); });
  };
  window.mmLeave = () => { document.body.classList.remove("mm-editing"); if (cur) { endEdit(); pushDirty(); } };
  /* ===== [独立版] 云同步停用：跨设备变更订阅（Sync.onChange）+ 登录后自动上传 =====
  try {
    Sync.onChange((set) => {
      if (!set || !set.has || !set.has(LS_REV)) return;
      pullList().then(async () => {
        if (cur) { const e = idxGet(cur.id); if (!e) { tip("这张导图在别的设备上被删了"); closeMap(); return; } if (e.server > (e.version || 0) && !e.dirty) { const s = sel, v = { ...view }; await openMap(cur.id, true); sel = findNode(s) ? s : cur.root.id; view = v; draw(); tip("别的设备改了这张图，已更新", 1800); } }
        else if (currentView() === "mindmap") renderList();
      });
    });
  } catch (e) {}
  // 登录后：把没登录时画的图传到账号里
  let lastUid = me() ? me().id : null;
  setInterval(() => { const u = me() ? me().id : null; if (u !== lastUid) { lastUid = u; if (u) { index.forEach((e) => { if (!e.uid) { e.uid = u; e.dirty = true; } }); idxSave(); pullList(); } if (currentView() === "mindmap" && !cur) renderList(); } }, 2000);
  window.addEventListener("beforeunload", () => { if (index.some((x) => x.dirty) && me()) pushDirty(); });
  ===== [独立版] 云同步停用结束 ===== */
  window.Mindmap = { parseText, toMarkdown, state: () => ({ cur, sel, index, L }), open: openMap, create };
})();
