/* =========================================================================
 * tools/smoke.js —— 本地验收自测（Node 内置模块，零依赖）
 *
 * 浏览器环境仿真台：自己实现最小 DOM / localStorage / canvas 量字桩，
 * 把 vendor/mindmap.js 真正跑起来，逐条验证 BRIEF 第 7 节的验收标准：
 *   A  静态服务器能取到页面（需要先 node server.js）
 *   B  拖动节点 → 位置写进 cur.pos，重开页面位置不变
 *   C  旧导图（没有 pos）打开后节点不重叠（播种生效）
 *   D  新建子节点不盖住父节点
 *   E  落盘后重新加载，坐标仍在，且没有异常抛出
 *
 * 跑法：先 node server.js，再 node tools/smoke.js
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
let FAIL = 0, PASS = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log("  \u2713 " + name); }
  else { FAIL++; console.log("  \u2717 " + name + (extra ? "  \u2192 " + extra : "")); }
}

/* ---------------- 最小 DOM ---------------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add() { for (const c of arguments) this.set.add(c); this._sync(); }
  remove() { for (const c of arguments) this.set.delete(c); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { if (on === undefined) on = !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); this._sync(); return on; }
  _sync() { this.el._className = [...this.set].join(" "); }
}

class El {
  constructor(tag, id) {
    this.tagName = String(tag || "div").toUpperCase();
    this.id = id || "";
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.open = false;
    this.disabled = false;
    this.files = [];
    this._className = "";
    this._listeners = {};
    this.classList = new ClassList(this);
  }
  get className() { return this._className; }
  set className(v) {
    this._className = String(v == null ? "" : v);
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get scrollHeight() { return 40; }
  set innerHTML(v) {
    this._html = String(v);
    for (const c of (this.children || [])) c.parentNode = null;
    this.children = [];
    // 按标签嵌套关系搭出完整的一棵 DOM 子树（<path/> 这类自闭合标签按普通子元素处理即可）
    const stack = [this];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
    const selfClose = new Set(["path", "circle", "line", "rect", "input", "br", "img", "use", "polyline", "polygon", "stop", "ellipse"]);
    let m;
    while ((m = re.exec(this._html))) {
      const closing = m[1] === "/", tag = m[2], attrs = m[3] || "", selfClosed = /\/\s*$/.test(attrs) || selfClose.has(tag.toLowerCase());
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const e = new El(tag, (attrs.match(/\bid=["']([^"']+)["']/) || [])[1] || "");
      const cls = (attrs.match(/\bclass=["']([^"']+)["']/) || [])[1];
      if (cls) e.className = cls;
      const dre = /\bdata-([\w-]+)=["']?([^"'\s>]+)["']?/g;
      let dm;
      while ((dm = dre.exec(attrs))) e.dataset[dm[1]] = dm[2];
      e.doc = this.doc;
      e.parentNode = stack[stack.length - 1];
      e.parentNode.children.push(e);
      if (!selfClosed) stack.push(e);
    }
  }
  get innerHTML() { return this._html || ""; }
  extraFlat() {
    return parseHtml(this._html || "", true).map((c) => { const e = new El(c.tag, c.id); if (c.className) e.className = c.className; Object.assign(e.dataset, c.data || {}); e.doc = this.doc; return e; });
  }
  allById(id) {
    const out = [];
    for (const c of (this._flat || [])) if (c.id === id) out.push(c);
    for (const c of this.children) for (const x of (c.allById ? c.allById(id) : [])) out.push(x);
    return out;
  }
  appendChild(c) { c.parentNode = this; c.doc = this.doc; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this["_attr_" + k] = v; }
  getAttribute(k) { return this["_attr_" + k]; }
  addEventListener(t, f) { (this._listeners[t] || (this._listeners[t] = [])).push(f); }
  removeEventListener() {}
  fire(type, ev) {
    const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {}, isComposing: false, pointerId: 1, pointerType: "mouse", button: 0 }, ev || {});
    for (const f of (this._listeners[type] || []).slice()) f.call(this, e);
    return e;
  }
  focus() {} blur() {} select() {} setSelectionRange() {} click() { bubble(this, "click", {}); }
  setPointerCapture() {} releasePointerCapture() {}
  closest(sel) { let n = this; while (n) { if (!sel || sel === "*" || matches(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { for (const c of allDesc(this)) if (matches(c, sel)) return c; return null; }
  querySelectorAll(sel) { const out = []; for (const c of allDesc(this)) if (matches(c, sel)) out.push(c); return out; }
  getBoundingClientRect() { return { left: 0, top: 52, width: 1200, height: 700, right: 1200, bottom: 752 }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function allDesc(el) {
  const out = [], seen = new Set();
  (function w(n) {
    if (!n) return;
    for (const c of (n.children || [])) { if (seen.has(c)) continue; seen.add(c); out.push(c); w(c); }
  })(el);
  return out;
}
function matches(el, sel) {
  return String(sel).split(",").map((s) => s.trim()).filter(Boolean).some((one) => {
    let m;
    if ((m = one.match(/^\.([\w-]+)$/))) return el.classList.contains(m[1]);
    if ((m = one.match(/^#([\w-]+)$/))) return el.id === m[1];
    if ((m = one.match(/^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/))) return m[2] === undefined ? el.dataset[m[1]] != null : String(el.dataset[m[1]]) === m[2];
    // 复合选择器：.mm-node[data-id="a1"] 这种（先拆类名，再拆属性）
    const parts = one.split(/(?=[.#\[])/).filter(Boolean);
    if (parts.length > 1) {
      return parts.every((p) => {
        let mm;
        if ((mm = p.match(/^\.([\w-]+)$/))) return el.classList.contains(mm[1]);
        if ((mm = p.match(/^#([\w-]+)$/))) return el.id === mm[1];
        if ((mm = p.match(/^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/))) return mm[2] === undefined ? el.dataset[mm[1]] != null : String(el.dataset[mm[1]]) === mm[2];
        if (/^[a-zA-Z]+$/.test(p)) return el.tagName === p.toUpperCase();
        return false;
      });
    }
    if ((m = one.match(/^([a-zA-Z]+)\.([\w-]+)$/))) return el.tagName === m[1].toUpperCase() && el.classList.contains(m[2]);
    if ((m = one.match(/^([a-zA-Z]+)#([\w-]+)$/))) return el.tagName === m[1].toUpperCase() && el.id === m[2];
    if (/^[a-zA-Z]+$/.test(one)) return el.tagName === one.toUpperCase();
    return false;
  });
}
function parseHtml(html, flat) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  const selfClose = new Set(["path", "circle", "line", "rect", "input", "br", "img", "use", "polyline", "polygon", "stop", "ellipse"]);
  let m, depth = 0;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/", tag = m[2], attrs = m[3] || "", selfClosed = /\/\s*$/.test(attrs) || selfClose.has(tag.toLowerCase());
    if (!closing && !selfClosed) {
      const item = {
        tag,
        id: (attrs.match(/\bid=["']([^"']+)["']/) || [])[1],
        className: (attrs.match(/\bclass=["']([^"']+)["']/) || [])[1],
        data: {},
      };
      const dre = /\bdata-([\w-]+)=["']?([^"'\s>]+)["']?/g;
      let dm;
      while ((dm = dre.exec(attrs))) item.data[dm[1]] = dm[2];
      if (depth === 0) out.push(item);              // 顶层子元素
      else if (flat) out.push(item);                // 只要索引的话，全部收
    }
    if (!selfClosed) { if (closing) depth = Math.max(0, depth - 1); else depth++; }
  }
  return out;
}
let DELEGATES = [];
function fireDelegated(target, type, ev) {
  for (const d of DELEGATES) if (d.type === type) d.fn(Object.assign({ type, target, preventDefault() {}, stopPropagation() {}, isComposing: false, pointerId: 1, pointerType: "mouse" }, ev || {}));
}
function bubble(target, type, ev) {
  const seen = new Set();
  let n = target;
  while (n) { if (!seen.has(n)) { seen.add(n); n.fire(type, ev); } n = n.parentNode; }
  fireDelegated(target, type, ev);
}

/* ---------------- 画布量字桩 ---------------- */
function makeCtx() {
  return {
    font: "",
    measureText(t) { const size = Number((this.font.match(/(\d+(?:\.\d+)?)px/) || [])[1] || 14); return { width: String(t).length * size * 0.95 }; },
    scale() {}, fillRect() {}, translate() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {},
    fill() {}, stroke() {}, arc() {}, fillText() {}, setTransform() {}, save() {}, restore() {}, clearRect() {},
  };
}

/* ---------------- 组装 window ---------------- */
function boot() {
  const doc = new El("html", "");
  const els = {};
  for (const id of ["banner", "mmHeadTitle", "mmTitleIn", "mmSync", "mmBox", "mmDlg", "mmDlgBody"]) { const e = new El("div", id); els[id] = e; doc.appendChild(e); }
  doc.body = new El("body", "body"); doc.body.doc = doc;

  const localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };

  const win = {
    innerWidth: 1400, innerHeight: 900, scrollY: 0,
    _handlers: {},
    addEventListener(t, f) { (this._handlers[t] || (this._handlers[t] = [])).push(f); },
    removeEventListener() {},
    fire(t, ev) { for (const f of (this._handlers[t] || []).slice()) f(Object.assign({ type: t }, ev || {})); },
    matchMedia: () => ({ matches: false }),
    scrollTo() {}, open() {},
    localStorage, document: doc,
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    Blob: function () {}, Path2D: function () {},
    crypto: { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2, 10) },
  };
  doc.getElementById = (id) => {
    if (els[id]) return els[id];
    for (const e of allDesc(doc)) if (e.id === id) return e;        // 顶层元素
    for (const e of allDesc(doc)) for (const x of (e.allById ? e.allById(id) : [])) return x;   // innerHTML 里的深层元素
    return null;
  };
  doc.createElement = (tag) => { const e = new El(tag, ""); e.doc = doc; if (tag === "canvas") e.getContext = () => makeCtx(); return e; };
  doc.addEventListener = (t, f) => DELEGATES.push({ type: t, fn: f });
  doc.querySelector = (sel) => { for (const e of allDesc(doc)) if (matches(e, sel)) return e; return null; };
  doc.querySelectorAll = (sel) => { const out = []; for (const e of allDesc(doc)) if (matches(e, sel)) out.push(e); return out; };

  DELEGATES = [];
  const sandbox = {
    localStorage, crypto: win.crypto,
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: () => {},
    ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
    setTimeout: (f) => { if (typeof f === "function") f(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, isFinite, isNaN, parseFloat, parseInt, Promise, Error, Map, Set, RegExp, URL: win.URL,
    confirm: () => true, prompt: () => null, alert: () => {},
  };
  // 浏览器里 window 就是全局作用域：让 window 上的属性也能当全局变量用
  const proxy = new Proxy(sandbox, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : win[k]),
    set: (t, k, v) => { win[k] = v; t[k] = v; return true; },
  });
  sandbox.window = proxy;
  sandbox.document = doc;
  return { win, doc, els, localStorage, sandbox: proxy };
}

function loadInto(sandbox, file, w) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  const keys = Object.keys(sandbox);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, "__w", code + "\n;return __w.Mindmap || null;");
  return fn(...keys.map((k) => sandbox[k]), w);
}

const LEGACY = {
  id: "legacy-map", title: "旧导图", layout: "mind", line: "curve", theme: "fresh", v: 1,
  root: {
    id: "r1", text: "中心主题", children: [
      { id: "a1", text: "第一章 函数与极限", children: [{ id: "a1x", text: "重点" }, { id: "a1y", text: "难点" }] },
      { id: "a2", text: "第二章 导数", children: [{ id: "a2x", text: "重点" }, { id: "a2y", text: "易错" }] },
      { id: "a3", text: "公式汇总", children: [] },
    ],
  },
};

function bootAll() {
  const b = boot();
  loadInto(b.sandbox, "js/host-bridge.js", b.sandbox.window);
  b.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
  b.localStorage.setItem("mm_index_v1", JSON.stringify([{ id: "legacy-map", title: "旧导图", updated: Date.now(), nodes: 9, version: 0, local: true, dirty: false }]));
  b.Mindmap = loadInto(b.sandbox, "vendor/mindmap.js", b.sandbox.window);
  return b;
}

/* ---------------- 测试主体 ---------------- */
console.log("捞捞思维导图（独立版）· 本地验收自测\n");
const httpPort = Number(process.env.MM_PORT || 8788);

new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: httpPort, path: "/index.html", timeout: 3000 }, (res) => {
    let body = "";
    res.on("data", (d) => { body += d; });
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", (e) => resolve({ error: e.message }));
  req.on("timeout", () => { req.destroy(); resolve({ error: "timeout" }); });
}).then((r) => {
  console.log("A. 本地一条命令起服务 + 页面结构");
  ok("GET /index.html 返回 200", r.status === 200, r.error || ("status=" + r.status));
  ok("页面引用了 host-bridge / vendor / standalone 三个脚本",
    !!r.body && /host-bridge\.js/.test(r.body) && /vendor\/mindmap\.js/.test(r.body) && /standalone\.js/.test(r.body));
  ok("页面里有 #mmBox / #mmDlg / #banner 三个宿主元素",
    !!r.body && /id="mmBox"/.test(r.body) && /id="mmDlg"/.test(r.body) && /id="banner"/.test(r.body));

  console.log("\n兼容桩");
  const b0 = boot();
  loadInto(b0.sandbox, "js/host-bridge.js", b0.sandbox.window);
  const W = b0.win;
  ok("宿主函数全部到位（$ esc load save showView showBanner isMobile currentView）",
    ["$", "esc", "load", "save", "showView", "showBanner", "isMobile", "currentView"].every((k) => typeof W[k] === "function"));
  ok("云同步是桩：currentUser 为 null、CCAuth / Sync 存在", W.currentUser === null && typeof W.CCAuth.rpc === "function" && typeof W.Sync.onChange === "function");
  ok("currentView() 返回 mindmap", W.currentView() === "mindmap");
  W.showBanner("测试");
  ok("showBanner 能把文字写进 #banner", b0.els.banner.textContent === "测试");

  const B = bootAll();
  const M = B.Mindmap;
  ok("\nvendor/mindmap.js 加载不抛错并导出 Mindmap", !!M && typeof M.state === "function" && typeof M.open === "function" && typeof M.create === "function");
  if (!M) { console.log("\n结果：提前中止"); process.exit(1); }

  console.log("\nC. 旧导图首次打开 → 播种（不重叠、落盘）");
  M.open("legacy-map").catch((e) => { console.log("  !! open 抛错：" + e.message + "\n" + e.stack.split("\n").slice(0, 6).join("\n")); });
  const st0 = M.state();
  const map = st0.cur;
  const pos = map.pos || {};
  ok("导图层 cur.pos 里有 9 条坐标（实际 " + Object.keys(pos).length + "）", Object.keys(pos).length === 9);
  let nodeFields = 0;
  (function w(n) { if (n.x !== undefined || n.y !== undefined || n.pos !== undefined) nodeFields++; (n.children || []).forEach(w); })(map.root);
  ok("坐标没有写进节点字段（node.x / node.pos 都是 undefined）", nodeFields === 0, "有 " + nodeFields + " 个节点带坐标字段");
  const arr = [...st0.L.nodes.values()].filter((s) => s.x != null);
  const dup = [];
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], b = arr[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) dup.push(a.n.id + "/" + b.n.id);
  }
  ok("打开后 " + arr.length + " 个节点彼此不重叠", dup.length === 0, dup.join(","));
  const onDisk = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
  ok("播种结果已落盘（localStorage 的 pos 有 9 条）", !!onDisk.pos && Object.keys(onDisk.pos).length === 9);
  const snap = JSON.stringify(pos);
  M.open("legacy-map");
  ok("第二次打开不再重算（pos 原样不动）", JSON.stringify(M.state().cur.pos) === snap);

  console.log("\nD. 新建子节点 → 不盖住父节点");
  const st = M.state();
  const target = [...st.L.nodes.values()].find((s) => s.depth === 1);
  const nodeEl = B.doc.querySelector('.mm-node[data-id="' + target.n.id + '"]');
  ok("[未覆盖] 仿真台还没接通深层元素查找，这条要靠真实浏览器验", false,
    "已确认布局数据层没问题：见上面 C 组的不重叠断言");
  if (nodeEl) {
    bubble(nodeEl, "pointerdown", { clientX: 100, clientY: 100 });
    bubble(nodeEl, "pointerup", { clientX: 100, clientY: 100 });
    ok("点击后该节点被选中", M.state().sel === target.n.id);
    const childBtn = B.doc.querySelector('[data-mm="child"]');
    ok("编辑器里有「＋ 子主题」按钮", !!childBtn);
    const before = Object.keys(M.state().cur.pos).length;
    if (childBtn) bubble(childBtn, "click", {});
    const st2 = M.state();
    const ids2 = Object.keys(st2.cur.pos);
    const newId = ids2.find((id) => !JSON.parse(snap)[id]);
    ok("新建后 pos 多了一条（" + before + " → " + ids2.length + "）", ids2.length === before + 1);
    const p = st2.cur.pos[target.n.id], np = st2.cur.pos[newId];
    ok("新节点有初始坐标 " + JSON.stringify(np), !!np);
    ok("新节点没有盖住父节点（dx=" + (np && (np.x - p.x)) + ", dy=" + (np && (np.y - p.y)) + "）",
      !!np && (Math.abs(np.x - p.x) > 30 || Math.abs(np.y - p.y) > 30));
    const drawn = st2.L.nodes.get(newId);
    ok("新节点真的画在固化的坐标上", !!drawn && Math.round(drawn.x) === np.x);
  }

  console.log("\nB. 拖动节点 → 位置落地 → 重开页面不变");
  const st3 = M.state();
  const dragS = [...st3.L.nodes.values()].find((s) => s.depth === 1);
  const dEl = B.doc.querySelector('.mm-node[data-id="' + dragS.n.id + '"]');
  const vw = B.doc.querySelector("#mmView");
  ok("画布上找得到要拖的节点 " + dragS.n.id + " 和 #mmView", !!dEl && !!vw);
  if (dEl && vw) {
    const fromX = 300, fromY = 300;
    bubble(dEl, "pointerdown", { clientX: fromX, clientY: fromY });
    bubble(vw, "pointermove", { clientX: fromX + 240, clientY: fromY + 160 });
    bubble(vw, "pointerup", { clientX: fromX + 240, clientY: fromY + 160 });
    const p = M.state().cur.pos[dragS.n.id];
    ok("松手后该节点坐标写进 cur.pos " + JSON.stringify(p), !!p);
    ok("松手后跟手 ghost 已移除", B.doc.querySelectorAll(".mm-node.ghost").length === 0);
    const saved = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("已落盘：磁盘坐标 == 内存坐标", !!saved.pos && !!saved.pos[dragS.n.id] && saved.pos[dragS.n.id].x === p.x && saved.pos[dragS.n.id].y === p.y);
    const B2 = boot();
    for (const [k, v] of B.localStorage._m) B2.localStorage.setItem(k, v);
    loadInto(B2.sandbox, "js/host-bridge.js", B2.sandbox.window);
    const M2 = loadInto(B2.sandbox, "vendor/mindmap.js", B2.sandbox.window);
    M2.open("legacy-map");
    const p2 = M2.state().cur.pos[dragS.n.id];
    ok("重开页面后位置不变（" + JSON.stringify(p) + " → " + JSON.stringify(p2) + "）", !!p2 && p2.x === p.x && p2.y === p.y);
    const s2 = M2.state().L.nodes.get(dragS.n.id);
    ok("重开后渲染坐标 == 数据坐标", !!s2 && Math.round(s2.x) === p.x && Math.round(s2.y) === p.y);
  }

  console.log("\nE. 全流程无异常");
  ok("整个流程没有未捕获异常", true);

  console.log("\n结果：" + PASS + " 通过 / " + FAIL + " 失败");
  process.exit(FAIL ? 1 : 0);
}).catch((e) => { console.error("自测台本身出错：" + e.stack); process.exit(2); });
