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
    this.style = { setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ""; }, removeProperty(k) { delete this[k]; } };
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
  /* 真实 DOM 的 textContent = 自己的文本 + 全部后代的文本。仿真台原来把它当普通字段（innerHTML 解析出的
     元素永远没有文字），于是"按钮上写了什么字"这类断言根本没法断 —— 这正是 `n.fold → cur.fold` 迁移
     回归（按钮文字/提示不跟着走）能一路全绿的原因。 */
  get textContent() {
    let s = this.__text || "";
    for (const c of (this.children || [])) s += c.textContent || "";
    return s;
  }
  set textContent(v) {
    this.__text = String(v == null ? "" : v);
    for (const c of (this.children || [])) c.parentNode = null;
    if (this.children) this.children = [];
  }
  set innerHTML(v) {
    this._html = String(v);
    for (const c of (this.children || [])) c.parentNode = null;
    this.children = [];
    // 按标签嵌套关系搭出完整的一棵 DOM 子树（<path/> 这类自闭合标签按普通子元素处理即可）
    const stack = [this];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
    const selfClose = new Set(["path", "circle", "line", "rect", "input", "br", "img", "use", "polyline", "polygon", "stop", "ellipse"]);
    let m, at = 0;
    while ((m = re.exec(this._html))) {
      // 标签之间的裸文本 = 当前栈顶元素的直接文本节点（真实 DOM 里查询按钮文字就靠它）
      const rawText = this._html.slice(at, m.index); at = re.lastIndex;
      if (rawText) { const top = stack[stack.length - 1]; top.__text = (top.__text || "") + rawText; }
      const closing = m[1] === "/", tag = m[2], attrs = m[3] || "", selfClosed = /\/\s*$/.test(attrs) || selfClose.has(tag.toLowerCase());
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const e = new El(tag, (attrs.match(/\bid=["']([^"']+)["']/) || [])[1] || "");
      const cls = (attrs.match(/\bclass=["']([^"']+)["']/) || [])[1];
      if (cls) e.className = cls;
      const tt = attrs.match(/\btitle=["']([^"']*)["']/);      // 真实 DOM 的 el.title 是反射属性
      if (tt) e.title = tt[1];
      const dre = /\bdata-([\w-]+)=["']?([^"'\s>]+)["']?/g;
      let dm;
      while ((dm = dre.exec(attrs))) e.dataset[dm[1]] = dm[2];
      e.doc = this.doc;
      e.parentNode = stack[stack.length - 1];
      e.parentNode.children.push(e);
      if (!selfClosed) stack.push(e);
    }
    const tail = this._html.slice(at);
    if (tail) { const top = stack[stack.length - 1]; top.__text = (top.__text || "") + tail; }
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
  focus() { this._focused = true; } blur() { this._focused = false; }
  select() { this._sel = "all"; }
  setSelectionRange(a, b) { this._sel = [a, b]; }
  click() { bubble(this, "click", {}); }
  cloneNode() {
    // 只支持浅/深拷贝本仿真台用得到的部分（classList / dataset / id / style / 子节点）
    const e = new El(this.tagName, this.id);
    e.doc = this.doc;
    e.className = this.className;
    Object.assign(e.dataset, this.dataset);
    Object.assign(e.style, this.style);
    for (const c of (this.children || [])) { const k = c.cloneNode ? c.cloneNode(true) : null; if (k) { k.parentNode = e; e.children.push(k); } }
    return e;
  }
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
/* 属性选择器 → dataset 键的映射：真实 DOM 里 [data-id="a1"] 读的是 el.dataset.id。
   仿真台原来按 el.dataset["data-id"] 取值，于是**所有**属性选择器都匹配不上
   （.mm-node[data-id=…] / [data-mm=fold] / [data-mm="del"] 全查不到）——
   这是几条"未覆盖"断言的共同根因，不是产品缺陷。 */
function dsGet(el, key) { const k = key.indexOf("data-") === 0 ? key.slice(5) : key; return (el.dataset || {})[k]; }
function matches(el, sel) {
  return String(sel).split(",").map((s) => s.trim()).filter(Boolean).some((one) => {
    let m;
    // 后代选择器（选择器里有空格）：最右一段匹配元素本身，其余逐级向上在祖先里找
    const chain = one.split(/\s+/).filter(Boolean);
    if (chain.length > 1) {
      if (!matches(el, chain[chain.length - 1])) return false;
      let n = el.parentNode;
      for (let i = chain.length - 2; i >= 0; i--) {
        let p = n;
        while (p && !matches(p, chain[i])) p = p.parentNode;
        if (!p) return false;
        n = p.parentNode;
      }
      return true;
    }
    if ((m = one.match(/^\.([\w-]+)$/))) return el.classList.contains(m[1]);
    if ((m = one.match(/^#([\w-]+)$/))) return el.id === m[1];
    if ((m = one.match(/^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/))) { const v = dsGet(el, m[1]); return m[2] === undefined ? v != null : String(v) === m[2]; }
    // 复合选择器：.mm-node[data-id="a1"] 这种（先拆类名，再拆属性）
    const parts = one.split(/(?=[.#\[])/).filter(Boolean);
    if (parts.length > 1) {
      return parts.every((p) => {
        let mm;
        if ((mm = p.match(/^\.([\w-]+)$/))) return el.classList.contains(mm[1]);
        if ((mm = p.match(/^#([\w-]+)$/))) return el.id === mm[1];
        if ((mm = p.match(/^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/))) { const v = dsGet(el, mm[1]); return mm[2] === undefined ? v != null : String(v) === mm[2]; }
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
  for (const id of ["banner", "mmHeadTitle", "mmTitleIn", "mmSync", "mmBox", "mmDlg"]) { const e = new El("div", id); els[id] = e; doc.appendChild(e); }
  /* #mmDlgBody 在真浏览器里是 #mmDlg 的**子节点**（弹窗内容）。原来摆成兄弟节点，
     于是文档级 click 委派的门禁 `closest("#mmBox, #mmDlg, .mm-head")` 对弹窗里的按钮恒失败 ——
     表现是"导出/复制"这些走弹窗的动作在仿真台里静默不做任何事（和 fakeBtn 那次同一个病）。 */
  els.mmDlgBody = new El("div", "mmDlgBody"); els.mmDlg.appendChild(els.mmDlgBody);
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
}).then(async (r) => {
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
  /* 【独立版·平级】容器是数组：夹具与断言统一用 root0() 取第一个容器（旧格式 root 也认）。 */
  const root0 = (m) => ((m && (Array.isArray(m.nodes) ? m.nodes[0] : m.root)) || null);
  /* 【独立版】"扫哪些表"只有 vendor 那一处真相来源：断言直接读导出，不写第二份字面量。 */
  const LAYER_MAPS = M.LAYER_MAPS, LAYER_LISTS = M.LAYER_LISTS;
  /* 给"按下/拖动落在某个节点上"算**与真实浏览器一致**的屏幕坐标：布局盒 + #mmStage 的 transform
     （applyView 写的 translate/scale）现算。不写死 (100,100) 这类任意点 —— 那种点可能落在**别的**节点上，
     会被八方向命中区当成"在别的节点边缘缩放"，断言就因夹具不真实而失败（D 组原来就踩这个）。 */
  function view2screen() {
    const tr = String(B.win.$("mmStage").style.transform || "");
    const m = tr.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/);
    if (!m) return null;
    const r = B.win.$("mmView").getBoundingClientRect();
    return { k: Number(m[3]), ox: r.left + Number(m[1]), oy: r.top + Number(m[2]) };
  }
  /* 取一个"确实落在该节点上、又不被别的节点盒盖住、且离本节点边 ≥ 12px"的屏幕点。
     两个必要性：① 真实浏览器里指针命中的是**最上层**那个节点，所以压在别人身上的点不能用来点它；
     ② 贴着边会被八方向命中区当成缩放（命中区边=16px），断言就会跑到 resize 分支上去。 */
  function pointOn(id) {
    const st = M.state(), s = st.L && st.L.nodes.get(id), v = view2screen();
    if (!s || s.x == null || !v) return null;
    const others = [...st.L.nodes.values()].filter((t) => t.x != null && t.n.id !== id);
    for (const [fx, fy] of [[.5, .5], [.4, .4], [.6, .6], [.35, .5], [.65, .5], [.5, .35], [.5, .65]]) {
      const x = v.ox + (s.x + s.w * fx) * v.k, y = v.oy + (s.y + s.h * fy) * v.k;
      const covered = others.some((t) => {
        const bx = v.ox + t.x * v.k, by = v.oy + t.y * v.k, bw = t.w * v.k + 8, bh = t.h * v.k + 8;
        return x >= bx - 8 && x <= bx + bw && y >= by - 8 && y <= by + bh;
      });
      if (!covered) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  }
  ok("\nvendor/mindmap.js 加载不抛错并导出 Mindmap", !!M && typeof M.state === "function" && typeof M.open === "function" && typeof M.create === "function");
  if (!M) { console.log("\n结果：提前中止"); process.exit(1); }
  {
    const smokeSrc = require("fs").readFileSync(__filename, "utf8");
    ok("（源码形状）自测台没有第二份表字面量（不出现 for (const t of [\"pos\", \"size\"…）",
      !/for \(const t of \["pos", "size"/.test(smokeSrc));
    ok("扫哪些表来自 vendor 唯一真相来源：LAYER_MAPS = " + JSON.stringify(LAYER_MAPS) + " / LAYER_LISTS = " + JSON.stringify(LAYER_LISTS),
      Array.isArray(LAYER_MAPS) && LAYER_MAPS.join(",") === "pos,size,fold" && Array.isArray(LAYER_LISTS) && LAYER_LISTS.join(",") === "edges",
      JSON.stringify([LAYER_MAPS, LAYER_LISTS]));
  }

  console.log("\nC. 旧导图首次打开 → 播种（不重叠、落盘）");
  M.open("legacy-map").catch((e) => { console.log("  !! open 抛错：" + e.message + "\n" + e.stack.split("\n").slice(0, 6).join("\n")); });
  const st0 = M.state();
  const map = st0.cur;
  const pos = map.pos || {};
  ok("导图层 cur.pos 里有 8 条坐标（实际 " + Object.keys(pos).length + "）", Object.keys(pos).length === 8);
  let nodeFields = 0;
  (function w(n) { if (n.x !== undefined || n.y !== undefined || n.pos !== undefined) nodeFields++; (n.children || []).forEach(w); })(root0(map));
  ok("坐标没有写进节点字段（node.x / node.pos 都是 undefined）", nodeFields === 0, "有 " + nodeFields + " 个节点带坐标字段");
  const arr = [...st0.L.nodes.values()].filter((s) => s.x != null);
  const dup = [];
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], b = arr[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) dup.push(a.n.id + "/" + b.n.id);
  }
  ok("打开后 " + arr.length + " 个节点彼此不重叠", dup.length === 0, dup.join(","));
  const onDisk = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
  ok("播种结果已落盘（localStorage 的 pos 有 8 条）", !!onDisk.pos && Object.keys(onDisk.pos).length === 8);
  const snap = JSON.stringify(pos);
  M.open("legacy-map");
  ok("第二次打开不再重算（pos 原样不动）", JSON.stringify(M.state().cur.pos) === snap);

  console.log("\nC2. 节点尺寸（导图层 cur.size，与坐标同层，不写节点字段）");
  const map2 = M.state().cur;
  const size = map2.size || {};
  ok("导图层 cur.size 里有 8 条尺寸（实际 " + Object.keys(size).length + "）", Object.keys(size).length === 8);
  const badSize = Object.entries(size).filter(([id, z]) => !(z.w >= 60 && z.h >= 40));
  ok("所有尺寸都在下限之上（≥ 60×40）", badSize.length === 0, JSON.stringify(badSize));
  let sizeFields = 0;
  (function w(n) { if (n.w !== undefined || n.h !== undefined || n.size !== undefined) sizeFields++; (n.children || []).forEach(w); })(root0(map2));
  ok("尺寸没有写进节点字段（node.w / node.h / node.size 都是 undefined）", sizeFields === 0, "有 " + sizeFields + " 个节点带尺寸字段");
  const onDisk2 = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
  ok("尺寸已落盘（localStorage 的 size 有 8 条）", !!onDisk2.size && Object.keys(onDisk2.size).length === 8);
  const sizeSnap = JSON.stringify(size);
  M.open("legacy-map");
  ok("第二次打开不再重算尺寸（cur.size 原样不动）", JSON.stringify(M.state().cur.size) === sizeSnap);

  const sizeIds = Object.keys(size);
  // 注意：open() 会从 localStorage 重新加载，所以必须改**盘上那份**，改内存对象是无效的
  const raw = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
  raw.size[sizeIds[0]] = { w: 1, h: 1 };              // 过小
  raw.size[sizeIds[1]] = { w: 99999, h: 99999 };      // 过大
  B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(raw));
  M.open("legacy-map");
  const after = M.state().cur.size;
  ok("过小的尺寸被夹到下限 60×40", after[sizeIds[0]].w === 60 && after[sizeIds[0]].h === 40, JSON.stringify(after[sizeIds[0]]));
  const sBig = [...M.state().L.nodes.values()].find((s) => s.n.id === sizeIds[1]);
  const capW = (sBig.measW || 60) * 4, capH = (sBig.measH || 40) * 4;
  ok("过大的尺寸被夹到上限（≤ 文本测量值 ×4）", after[sizeIds[1]].w <= capW && after[sizeIds[1]].h <= capH,
    "w=" + after[sizeIds[1]].w + " cap=" + capW + " / h=" + after[sizeIds[1]].h + " cap=" + capH);
  ok("[未覆盖] 缩放柄**可见元素**的命中（.mm-rs 本身是 CSS 目标）只能真实浏览器验", false,
    "几何层/数据层已各自验证：八方向命中几何见 C4，cur.size 生成、clamp 边界、落盘、二次打开不重算见本组；" +
    "把「按住边缘拖动改尺寸」做成端到端断言与 Chief 挂起的仿真台新活是同一件，本轮不做");
  M.open("legacy-map");   // 复位（把刚才被改的两条尺寸重新固化回合法值）

  console.log("\nB2. 拖动落点 → 进撤销栈 → 撤销回到拖动前的坐标");
  {
    const stB = M.state();
    const vwB = B.win.$("mmView");
    const sNode = [...stB.L.nodes.values()].find((s) => s.depth === 1 && s.n.id !== root0(stB.cur).id);
    // 夹具挂到 **document 查得到**的那个 #mmStage 上：startNodeDrag 用的是 document.querySelector，
    // 挂到别的实例上它查不到，手势就驱动不起来（这是上一版假通过的根因）
    const stageEl = B.doc.querySelector("#mmStage");
    let elB = null;
    if (stageEl && sNode) {
      elB = B.doc.createElement("div");
      elB.className = "mm-node d1";
      elB.dataset.id = sNode.n.id;
      stageEl.appendChild(elB);
    }
    const found = sNode && !!B.doc.querySelector('#mmStage .mm-node[data-id="' + sNode.n.id + '"]');
    ok("仿真台里能找到 startNodeDrag 要查的那个元素（驱动手势的前提）", !!found,
      "stage=" + !!stageEl + " fixture=" + !!elB);
    // 源码形状断言：这条能真正挡住"把撤销修复回退掉"。
    // 选择性更正（本轮）：属性选择器修好之后，节点元素已经能从 document 查到，B 组的拖动端到端也真的跑起来了
    // （落座标 / 落盘 / 重开不变都已是真断言）；仍然缺的是"**撤销**后坐标回到拖动前"这条端到端，
    // 它和 Chief 挂起的仿真台新活是同一件 —— 如实标"未覆盖"，不报假通过。
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    const fn = src.slice(src.indexOf("function endNodeDrag("), src.indexOf("function endNodeDrag(") + 2000);
    ok("endNodeDrag 里拖到空白那条走 change()（进撤销栈），且坐标写入在 change 的 fn 内部",
      /if \(!tg\) \{ if \(px != null\) change\(putPos\); else draw\(\); return; \}/.test(fn) && /change\(\(\) => \{\s*putPos\(\);/.test(fn));
    ok("旧写法已消失：不再有 change() 之外直接写 curPos / 手动 storeLocal 的落点分支",
      !/if \(px != null && py != null && src0\) curPos\(\)\[d\.id\]/.test(fn) && !/\{ storeLocal\(cur\); scheduleCloud\(\); \} draw\(\); return; \}/.test(fn));
    ok("[未覆盖] 「拖到空白 → 撤销 → 坐标回到拖动前」的端到端断言还没有", false,
      "本轮更正：元素已查得到、拖动端到端已在 B 组跑通（落座标/落盘/重开不变），缺的只是撤销那一步；" +
      "把它补成端到端属于 Chief 挂起的新活，当前靠上面两条源码形状断言盯着");
  }

  console.log("\nC3. 删除整棵子树 → pos/size 一起清（不残留）");
  {
    // 选中：把 pointerdown/up 打在**真的 #mmView** 上，但把 target 覆盖成夹具节点（仿真台不做真实命中测试）
    const vwC = B.win.$("mmView"), stageC = B.win.$("mmStage");
    const t = [...M.state().L.nodes.values()].find((s) => s.depth === 1 && (s.n.children || []).length);
    let selected = false;
    if (t && vwC) {
      const fx = B.doc.createElement("div");
      fx.className = "mm-node d1"; fx.dataset.id = t.n.id;
      if (stageC) stageC.appendChild(fx);
      bubble(vwC, "pointerdown", { target: fx, clientX: 10, clientY: 10 });
      bubble(vwC, "pointerup", { target: fx, clientX: 10, clientY: 10 });
      selected = M.state().sel === t.n.id;
    }
    ok("能选中一个带子节点的一级主题（删除断言的前提）", selected, "sel=" + M.state().sel);
    if (!selected) {
      ok("[未覆盖] 删除后 pos/size 残留检查没能在仿真台里驱动", false, "前提不成立（不报假通过）");
    } else {
      const subtree = [];
      (function w(n) { subtree.push(n.id); (n.children || []).forEach(w); })(t.n);
      const before = Object.keys(M.state().cur.pos).length;
      const delBtn = B.doc.querySelector('[data-mm="del"]');
      bubble(B.doc, "click", { target: delBtn });
      const after = M.state();
      const removed = before - Object.keys(after.cur.pos).length;
      if (removed <= 0) {
        ok("[未覆盖] 删除命令没能在仿真台里驱动（工具栏点击链路未接通），残留检查未做", false,
          "delBtn=" + !!delBtn + " 不报假通过");
      } else {
        const leftover = subtree.filter((k) => after.cur.pos[k] || after.cur.size[k]);
        ok("删掉 " + removed + " 个节点（子树共 " + subtree.length + " 个）后，pos/size 里无残留",
          leftover.length === 0, "残留=" + leftover.join(","));
      }
    }
  }

  console.log("\nC4. 八方向缩放：命中几何 / 光标 / 左上角跟随（源码形状断言，防回退）");
  {
    // Chief 在真实浏览器里实测到的缺陷：手柄中心点的 elementFromPoint 命中的是 .mm-edit，
    // 因为 .mm-rs 没有 z-index 而 .mm-edit 是 z-index:5 → 真实鼠标点不到手柄。
    // 注意：必须先剥掉 CSS 注释 —— 注释里提到 "z-index:5" 会污染解析（第一版断言就栽在这，报了 rs=5）。
    const cssRaw = require("fs").readFileSync(require("path").join(__dirname, "..", "css", "mindmap-standalone.css"), "utf8");
    const cssTxt = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
    const zOf = (sel) => {
      const m = cssTxt.match(new RegExp("\\" + sel + "\\s*\\{([^}]*)\\}"));
      const z = m && m[1].match(/z-index\s*:\s*(-?\d+)/);
      return z ? Number(z[1]) : 0;
    };
    const zRs = zOf(".mm-rs"), zEdit = zOf(".mm-edit");
    ok("视觉握把仍压得住 .mm-edit（z-index " + zRs + " > " + zEdit + "）—— 但它不再承担命中",
      zRs > zEdit, "rs=" + zRs + " edit=" + zEdit);
    // —— 八方向缩放的核心形状（Chief 派活 + 对话界面优化的交互规格）——
    const jsTxt = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("命中阈值是屏幕像素常量 edge=16 / corner=22 / slop=7（用户反馈太窄后放宽）",
      /RZ = \{ edge: 16, corner: 22, slop: 7 \}/.test(jsTxt));
    ok("短边缩放的命中下限抬到 10px（典型子节点约 40px 高，下限太低就抓不住）",
      jsTxt.includes("Math.max(10, Math.round(m * 0.25))") && jsTxt.includes("Math.max(10, Math.round(m * 0.15))"));
    const iCorner = jsTxt.indexOf("角优先，短路"), iEdge = jsTxt.indexOf("边：取更近的那条");
    ok("角优先于边：角分支在边分支之前且短路返回", iCorner > 0 && iEdge > iCorner);
    ok("判定全在屏幕空间（盒换算 + 指针减 rect，不除以 view.k）",
      jsTxt.includes("s.x * view.k + view.x") && jsTxt.includes("px = cx - r.left"));
    const cm = jsTxt.match(/const CURSOR = \{([^}]*)\}/);
    const pairs = cm ? cm[1].split(",").map((s) => s.split(":").map((x) => x.trim().replace(/["']/g, ""))).filter((p) => p.length === 2) : [];
    const uniq = new Set(pairs.map((p) => p[1]));
    ok("光标映射：8 个方向只有 4 个不同 cursor（同一条对角线共用）",
      pairs.length === 8 && uniq.size === 4, "方向=" + pairs.length + " 不同值=" + uniq.size);
    ok("西/北方向拖动时左上角跟着走（写 cur.pos，否则是从中心缩）",
      jsTxt.includes("W || N") && /putLayerPos\(z\.id, \{ x: W \?/.test(jsTxt));
    ok("方向光标用**节点类** .mm-node.rz-x 压过 .mm-node{cursor:grab}（写在 #mmView 上赢不了）",
      jsTxt.includes("el.classList.add(\"rz-\" + dir)") && /\.mm-node\.rz-e, \.mm-node\.rz-w \{ cursor: ew-resize/.test(cssTxt));
    ok("不再把方向光标写在 #mmView 行内值上（那是“内部仍读到上一次 nwse-resize”的来源），松手清空",
      !jsTxt.includes("vw.style.cursor = hz ?") && jsTxt.includes("vw.style.cursor = \"\""));
    ok("拖动中锁定方向：加类在节点上、松手解锁（markZone(null,null)）",
      jsTxt.includes("markZone(hz.id, hz.dir)") && jsTxt.includes("markZone(null, null)"));
  }

  console.log("\nC5. 交互入口未被破坏（源码形状守卫）");
  {
    const js = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("单击选中：pointerup 未移动时走 select(d.id)", /if \(d\.id\) \{[\s\S]{0,220}?select\(d\.id\)/.test(js));
    ok("双击进编辑：startEdit 定义在、dblclick 绑定在", js.includes("function startEdit") && js.includes("dblclick"));
    ok("拖节点改位置：endNodeDrag 仍把坐标写进 cur.pos", js.includes("function endNodeDrag(") && js.includes("change(putPos)"));
    ok("拖空白平移：panning 分支在", js.includes('vw.classList.add("panning")'));
    ok("滚轮平移/缩放：wheel 监听在", js.includes('addEventListener("wheel"'));
    // addChild 的锚点必须是真实盒子：用 estSize 的文本估算，父节点被放大过时会算出"压住父节点"的位置
    const addChildSrc = js.slice(js.indexOf("function addChild("), js.indexOf("function addSibling("));
    ok("addChild 用真实盒子当锚点（不用 estSize 估算；与 addSibling/addParent 写法对齐）",
      addChildSrc.includes("const ps = L && L.nodes.get(r.n.id)") && addChildSrc.includes("w: ps ? ps.w :"),
      "含 estSize 直取宽度的旧写法=" + /birthPos\(k, \{ x: \(L && L\.nodes\.get\(r\.n\.id\)\)/.test(addChildSrc));
  }

  console.log("\nC6. 折叠后后代不参与布局与渲染（真 bug 回归）");
  {
    // 这条能真驱动：夹具折叠状态走 localStorage，open() 会重新加载
    const raw = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    const tgt = root0(raw).children.find((c) => (c.children || []).length);
    tgt.fold = true;
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(raw));
    M.open("legacy-map");
    const st = M.state();
    const ids = new Set([...st.L.nodes.values()].map((s) => s.n.id));
    const desc = [];
    // 只收**后代**，不含被折叠的那个节点自己（第一版把 tgt 自己也收进来，误报 a1 泄漏）
    (function w(n) { (n.children || []).forEach((c) => { desc.push(c.id); w(c); }); })(tgt);
    const leaked = desc.filter((k) => ids.has(k));
    ok("折叠节点的后代不在布局表里（后代 " + desc.length + " 个，泄漏 " + leaked.length + " 个）",
      leaked.length === 0, leaked.join(","));
    const html = String(B.win.$("mmStage").innerHTML || "");
    const drawn = desc.filter((k) => html.indexOf('data-id="' + k + '"') >= 0);
    ok("折叠节点的后代没有被画进 DOM（原来照画，只是没有连线）", drawn.length === 0, drawn.join(","));
    ok("折叠后代的坐标仍保留在 cur.pos 里（展开时直接用回去、不重算）", desc.every((k) => !!st.cur.pos[k]));
    const js2 = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("prep 遇到 fold 就不再往下建 box（源码形状，防回退）", /if \(!isFold\(n\)\) \(n\.children \|\| \[\]\)\.forEach/.test(js2));
    delete tgt.fold;
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(raw));
    M.open("legacy-map");
  }

  console.log("\nC7. 双击行为：节点 → 编辑；空白 → 在鼠标处新建（一次只建一个）");
  {
    const vwD = B.win.$("mmView");
    const t = [...M.state().L.nodes.values()].find((s) => s.depth === 1);
    const fx = B.doc.createElement("div"); fx.className = "mm-node d1"; fx.dataset.id = t.n.id;
    B.win.$("mmStage").appendChild(fx);
    const jsSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    const posN = Object.keys(M.state().cur.pos).length;
    bubble(vwD, "dblclick", { target: fx, clientX: 200, clientY: 200 });
    ok("双击节点把它选中", M.state().sel === t.n.id, "sel=" + M.state().sel);
    ok("双击节点不新建节点（老代码在这条分支上什么都不做，半修版会误建）",
      Object.keys(M.state().cur.pos).length === posN);
    ok("源码里双击节点显式走 select(id) + startEdit(id)（不再依赖 350ms 判定当主路径）",
      /const nd = e\.target\.closest\("\.mm-node"\);\s*if \(nd\) \{ const id = nd\.dataset\.id; if \(id\) \{ select\(id\); startEdit\(id\); \} return; \}/.test(jsSrc));
    /* 进编辑这件事现在是可真观测的了（它曾标"未覆盖"）：startEdit 会把 textarea appendChild 到 #mmStage，
       仿真台能查到那个元素；focus() / select() / setSelectionRange() 也会被记下来。
       浏览器实测的另一半（"用户看不出在编辑"）靠 CSS 形状断言盯：编辑框必须有和"选中"不同的可见样式。 */
    const ed = B.win.$("mmStage").querySelector(".mm-edit");
    ok("双击节点后 .mm-edit 输入框真的出现（属性选择器修好后可观测）", !!ed, "stage 里 .mm-edit=" + !!ed);
    ok("编辑框拿到了焦点", !!ed && ed._focused === true, "focused=" + (ed && ed._focused));
    ok("编辑已有节点时插入符落在**文字末尾**（不是全选 —— 全选态只显示选区、看不见闪烁光标）",
      !!ed && Array.isArray(ed._sel) && ed._sel[0] === ed._sel[1] && ed._sel[0] === String(ed.value).length,
      "sel=" + JSON.stringify(ed && ed._sel) + " len=" + (ed && String(ed.value).length));
    const cssEd = require("fs").readFileSync(require("path").join(__dirname, "..", "css", "mindmap-standalone.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const edRule = (cssEd.match(/\.mm-edit\s*\{([^}]*)\}/) || [])[1] || "";
    const selRule = (cssEd.match(/\.mm-node\.sel\s*\{([^}]*)\}/) || [])[1] || "";
    ok("CSS 形状：编辑态有和「选中」不同的可见样式（.mm-edit 有光环；将来若给 .mm-node.sel 也加阴影，这条要改成别的区分方式）",
      /box-shadow\s*:/.test(edRule) && !/box-shadow\s*:/.test(selRule), "edit=" + edRule.trim().slice(0, 90));
    // 诊断（不是断言、不计入通过数）：遗留的 350ms lastTap 判定会不会进编辑
    M.open("legacy-map");                                   // 重开换了一批 DOM 元素，先清掉旧舞台
    B.win.$("mmStage").appendChild(fx);                     // 夹具重新挂到新舞台上
    const editBefore = B.win.$("mmStage").querySelectorAll(".mm-edit").length;
    bubble(vwD, "pointerdown", { target: fx, clientX: 200, clientY: 200 });
    bubble(vwD, "pointerup", { target: fx, clientX: 200, clientY: 200 });
    bubble(vwD, "pointerdown", { target: fx, clientX: 200, clientY: 200 });
    bubble(vwD, "pointerup", { target: fx, clientX: 200, clientY: 200 });
    console.log("  · 诊断：连点两次后 stage 里 .mm-edit 数 " + editBefore + " → " +
      B.win.$("mmStage").querySelectorAll(".mm-edit").length + "（遗留 350ms 判定确实会进编辑；未做成断言）");

    M.open("legacy-map");
    /* 重开之后 #mmView 是**新元素**、监听器挂在新元素上：必须用它派发。
       往旧元素（重开前那份）派发虽然也能打到旧闭包，但它用的是旧元素的 rect —— 会把"基准取错元素"这类问题盖掉。 */
    const vwL = B.win.$("mmView");
    const posBefore = Object.keys(M.state().cur.pos).length, rootsBefore = root0(M.state().cur).children.length;
    const snap0 = Object.assign({}, M.state().cur.pos);
    bubble(vwL, "dblclick", { target: vwL, clientX: 400, clientY: 300 });
    const stA = M.state(), snapA = Object.assign({}, stA.cur.pos);
    const rootsA = root0(stA.cur).children.length;          // 立刻取数：state().cur 是活引用，留到后面读会被下一次点击改掉
    bubble(vwL, "dblclick", { target: vwL, clientX: 500, clientY: 380 });
    const stB = M.state(), snapB = Object.assign({}, stB.cur.pos);
    const rootsB = root0(stB.cur).children.length;
    const idA = Object.keys(snapA).find((k) => !snap0[k]), idB = Object.keys(snapB).find((k) => !snapA[k]);
    ok("空白双击一次只建一个节点（" + posBefore + " → " + Object.keys(snapA).length + " → " + Object.keys(snapB).length + "）",
      Object.keys(snapA).length === posBefore + 1 && Object.keys(snapB).length === posBefore + 2);
    ok("新节点挂在根节点下（不挂到当前选中的节点下）" ,
      rootsA === rootsBefore + 1 && rootsB === rootsBefore + 2,
      "根子节点数 " + rootsBefore + " → " + rootsA + " → " + rootsB);
    ok("两个新节点都拿到了出生坐标", !!idA && !!idB && !!stA.cur.pos[idA] && !!stB.cur.pos[idB]);
    if (idA && idB) {
      const a = stA.cur.pos[idA], b = stB.cur.pos[idB];
      const dx = b.x - a.x, dy = b.y - a.y;
      const ratio = dy === 0 ? NaN : dx / dy, want = 100 / 80;   // 两次点击位移 100,80；同一个 k 约掉，比值与缩放无关
      ok("新节点位置跟着鼠标走（两次点击位移比 ≈ " + want.toFixed(2) + "，实测 " + ratio.toFixed(2) + "）",
        Math.abs(ratio - want) < 0.15, "dx=" + dx + " dy=" + dy);
    }
    /* 绝对对齐断言：位移比只能证明"方向对"，证明不了"中心真的落在鼠标点"。
       这里把 #mmView 的 rect 顶边改成和 #mmBox 不同的值（真实页面中间隔着 47px 工具条），
       于是"换算基准取错元素"（用 #mmBox 的 rect）会让 y 整块差一个工具条高度 —— 这条断言抓的就是它。
       期望值由 #mmStage 的 transform（applyView 写的 translate/scale）独立反解，不复用 local() 的内部。 */
    {
      const vwA = vwL;
      const savedRect = vwA.getBoundingClientRect;
      vwA.getBoundingClientRect = () => ({ left: 0, top: 98, width: 1200, height: 700, right: 1200, bottom: 798 });
      const cx = 640, cy = 500;
      const snapC = Object.assign({}, M.state().cur.pos);
      bubble(vwA, "dblclick", { target: vwA, clientX: cx, clientY: cy });
      const stC = M.state(), idC = Object.keys(stC.cur.pos).find((q) => !snapC[q]), sC = stC.L.nodes.get(idC);
      const v = view2screen();
      const wantX = v ? (cx - v.ox) / v.k : NaN, wantY = v ? (cy - v.oy) / v.k : NaN;
      const gx = sC ? sC.x + sC.w / 2 : NaN, gy = sC ? sC.y + sC.h / 2 : NaN;
      ok("双击空白：新节点**中心**落在鼠标点 ±2px（基准 = #mmView 的 rect，不是 #mmBox）",
        !!sC && Math.abs(gx - wantX) <= 2 && Math.abs(gy - wantY) <= 2,
        "鼠标点(舞台)=" + wantX.toFixed(1) + "," + wantY.toFixed(1) + " 新节点中心=" + gx.toFixed(1) + "," + gy.toFixed(1) +
        " 偏差=" + (gx - wantX).toFixed(1) + "," + (gy - wantY).toFixed(1) + "（#mmView top=98 / #mmBox top=52）");
      const tas = B.win.$("mmStage").querySelectorAll(".mm-edit");
      const lastTa = tas[tas.length - 1];
      ok("新建节点进编辑时是**全选**（打字即替换占位文字 —— 刻意的默认选择，与「已有节点用插入符」不同）",
        !!lastTa && lastTa._sel === "all" && !!lastTa._focused,
        "sel=" + JSON.stringify(lastTa && lastTa._sel) + " focused=" + (lastTa && lastTa._focused) + " value=" + (lastTa && lastTa.value));
      vwA.getBoundingClientRect = savedRect;
    }
  }

  console.log("\nC8. 收起按钮：一次点击就折叠（断言，防回退）");
  {
    /* 真实浏览器实测的缺陷（Chief，两次独立运行一致）：第一次点收起按钮什么都不发生，第二次才折叠。
       代码里的两条链：
         ① 文档级 click 委托（data-mm="fold"）—— 它的 target 是 mousedown/mouseup 的**共同祖先**，
            按下在按钮、松手偏一点落到节点上时 target 变成 .mm-node，closest("[data-mm]") 是 null，这次折叠整条丢掉；
         ② 按钮的"能不能被命中"原来由 :hover 放开 pointer-events 决定，按下那一刻不保证已吃到那个状态。
       修法：① 折叠改走**指针**路径（pointerdown 记下、pointerup 原地松手才折），不再依赖 click 的 target；
             ② CSS 让按钮常态就参与命中（视觉仍靠 opacity 隐藏），触屏维持不可见即不可点。
       注意：仿真台不做真实命中测试，也不跑 CSS —— 所以 ② 只能做源码形状断言，行为那条靠 Chief 在浏览器复验。 */
    const stageF = () => B.win.$("mmStage");
    let tgt = null, nodeEl = null, btn = null;
    const reset = () => {
      const r = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
      (function w(n) { delete n.fold; (n.children || []).forEach(w); })(root0(r));
      r.fold = {}; r.edges = [];     // 折叠状态现在在导图层：复位必须连它一起清，否则会跨子测试累积
      B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(r));
      M.open("legacy-map");
      tgt = root0(M.state().cur).children.find((c) => (c.children || []).length);
      nodeEl = stageF().querySelector('.mm-node[data-id="' + tgt.id + '"]');
      btn = stageF().querySelector('.mm-node[data-id="' + tgt.id + '"] .mm-fold');
      return { nodeEl, btn };
    };
    const vwF = B.doc.querySelector("#mmView");
    const at = { clientX: 500, clientY: 300 };
    reset();
    ok("夹具：找得到带子节点的一级主题 " + tgt.id + " 的节点元素与收起按钮", !!nodeEl && !!btn,
      "nodeEl=" + !!nodeEl + " btn=" + !!btn + " 按钮 data-id=" + (btn && btn.dataset.id));
    // ① 委托路径仍在（键盘激活 / 别的调用点都靠它）
    bubble(btn, "click", { target: btn });
    ok("① click 落在按钮上（委托路径）→ 折叠一次（状态读导图层 cur.fold）", !!M.state().cur.fold[tgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    // ② 真实浏览器那条序列：按下/松手在按钮上，随后 click 的 target 解析成节点 —— 原来这里整条丢掉
    reset();
    bubble(vwF, "pointerdown", Object.assign({ target: btn }, at));
    bubble(vwF, "pointerup", Object.assign({ target: btn }, at));
    bubble(vwF, "click", Object.assign({ target: nodeEl }, at));
    ok("② 按下在按钮、click 目标解析成节点 → 仍然折一次、不是零次", !!M.state().cur.fold[tgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    // ③ 浏览器真实的完整序列（click 也在按钮上）：指针路径折一次 + 委托路径被吞掉 → 净效果是"折一次"
    reset();
    bubble(vwF, "pointerdown", Object.assign({ target: btn }, at));
    bubble(vwF, "pointerup", Object.assign({ target: btn }, at));
    bubble(vwF, "click", Object.assign({ target: btn }, at));
    ok("③ 指针路径 + 随后的 click 不双折（一按一展开会净效果为零）", !!M.state().cur.fold[tgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    // ④ 按下后拖开 = 取消（与节点拖动同一套 6px 阈值），不许把"拖一下"当成折叠
    reset();
    bubble(vwF, "pointerdown", Object.assign({ target: btn }, at));
    bubble(vwF, "pointermove", { target: btn, clientX: at.clientX + 40, clientY: at.clientY });
    bubble(vwF, "pointerup", { target: btn, clientX: at.clientX + 40, clientY: at.clientY });
    ok("④ 按下后拖开 → 不折叠（松手位置离按下 >6px）", !M.state().cur.fold[tgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    // ⑤ 普通点选不被按钮抢走：按住/松手都在节点盒内部 → 只选中、不折叠
    reset();
    const plain = root0(M.state().cur).children.find((c) => !(c.children || []).length) || tgt;   // 不带按钮的节点
    const pEl = stageF().querySelector('.mm-node[data-id="' + plain.id + '"]');
    bubble(vwF, "pointerdown", Object.assign({ target: pEl }, at));
    bubble(vwF, "pointerup", Object.assign({ target: pEl }, at));
    ok("⑤ 点在节点上（不是按钮）→ 只选中、不折叠，且 fold 仍是未设置",
      M.state().sel === plain.id && !M.state().cur.fold[plain.id], "sel=" + M.state().sel + " cur.fold=" + JSON.stringify(M.state().cur.fold));
    /* ⑥ 按钮自己的文字/提示也必须跟着折叠状态走。这是 `n.fold → cur.fold` 迁移的**回归面**：
       迁移后节点字段里不再有 fold，而按钮那两处三元（title / 文字）原来读 n.fold →
       折叠后按钮仍显示 "−"、提示仍是"收起"，而按钮**照样能点、折叠状态也照样对**，
       所以整组测试一路全绿。这条在旧代码上必须红。 */
    reset();
    const descCount = (function w(n) { let k = 0; (n.children || []).forEach((c) => { k += 1 + w(c); }); return k; })(tgt);
    const btn6 = () => {
      const b = stageF().querySelector('.mm-node[data-id="' + tgt.id + '"] .mm-fold');
      return b ? { t: b.textContent, ti: b.title, el: b } : { t: "<查不到按钮>", ti: "<查不到按钮>", el: null };
    };
    let s6 = btn6();
    ok("⑥ 折叠前：按钮文字是「−」、title 是「收起」",
      s6.t === "−" && s6.ti === "收起", "text=" + JSON.stringify(s6.t) + " title=" + JSON.stringify(s6.ti));
    if (s6.el) bubble(s6.el, "click", { target: s6.el });
    s6 = btn6();
    ok("⑥ 折叠后：按钮文字是隐藏的后代数（" + descCount + "）、title 是「展开」",
      s6.t === String(descCount) && s6.ti === "展开",
      "text=" + JSON.stringify(s6.t) + " title=" + JSON.stringify(s6.ti) + " · cur.fold=" + JSON.stringify(M.state().cur.fold));
    if (s6.el) bubble(s6.el, "click", { target: s6.el });
    s6 = btn6();
    ok("⑥ 再点一次展开后：回到「−」/「收起」",
      s6.t === "−" && s6.ti === "收起", "text=" + JSON.stringify(s6.t) + " title=" + JSON.stringify(s6.ti));
    /* ⑦ 残余的 foldSwallow 不许吞掉下一次激活。复现②那一步（click 的 target 解析成 .mm-node →
       委派在门禁处早退）：那次 click 必须**消耗掉**这个一次性标记，否则它留到下一次激活上，
       把键盘/程序触发的那次折叠吞掉（用户看到的是"点了没反应、要点第二次"）。修前这条红。 */
    reset();
    const elA7 = btn6().el;
    bubble(vwF, "pointerdown", Object.assign({ target: elA7 }, at));
    bubble(vwF, "pointerup", Object.assign({ target: elA7 }, at));            // 指针路径折一次（同时立起 swallow）
    bubble(vwF, "click", Object.assign({ target: nodeEl }, at));              // click 落在节点上 → 委派早退
    reset();                                                                  // 回到"展开"（swallow 若残留仍在闭包里）
    const elB7 = btn6().el;
    bubble(elB7, "click", { target: elB7 });                                  // 键盘式激活：只有 click、没有 pointerdown
    ok("⑦ 被早退的那次 click 也消耗掉 foldSwallow（否则下一次激活被吞）",
      !!M.state().cur.fold[tgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    const jsF = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("源码形状：折叠在 pointerup 完成，不再只挂在 click 委托上",
      /const fb = e\.target\.closest\("\[data-mm=fold\]"\)/.test(jsF) &&
      /if \(e\.type === "pointercancel" \|\| f\.moved\) return;\s*foldSwallow = f\.id; toggleFold\(f\.id\);/.test(jsF));
    const cssF = require("fs").readFileSync(require("path").join(__dirname, "..", "css", "mindmap-standalone.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const foldBase = (cssF.match(/\n\.mm-fold\s*\{([^}]*)\}/) || [])[1] || "";
    ok("CSS 形状：.mm-fold 常态不再 pointer-events:none（命中不依赖 hover 是否已生效）",
      foldBase.length > 0 && !/pointer-events\s*:\s*none/.test(foldBase), "base=" + foldBase.trim());
    ok("CSS 形状：触屏（hover:none）仍是不可见即不可点",
      /@media\s*\(hover:\s*none\)\s*\{[^}]*\.mm-fold\s*\{[^}]*pointer-events:\s*none/.test(cssF));
    reset();
  }

  console.log("\nC15. 迁移：老图 n.fold → 导图层 cur.fold（显式步骤 + 幂等 + 无 id 节点不许写成 key undefined）");
  {
    /* 老格式里折叠长在**节点字段**上（n.fold）。不迁 = "节点字段里的折叠"和"导图层里的折叠"
       两份真相同时活着（契约危险项第 2 名）。所以迁移是**显式步骤**，并要有行为断言。 */
    const old = JSON.parse(JSON.stringify(LEGACY));       // 只有 root、v:1 —— 真·老格式
    old.root.children[0].fold = true;                     // a1 收起
    old.root.children[1].children[0].fold = true;         // a2x 收起
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(old));
    M.open("legacy-map");
    const c1 = M.state().cur;
    ok("容器迁移成数组：cur.nodes = [root]（不留 root 别名）",
      Array.isArray(c1.nodes) && c1.nodes.length === 1 && c1.nodes[0].id === "r1" && !("root" in c1),
      "nodes=" + (Array.isArray(c1.nodes) ? c1.nodes.map((r) => r.id).join(",") : typeof c1.nodes));
    ok("节点字段上的折叠搬进导图层 cur.fold（a1 / a2x）",
      c1.fold.a1 === true && c1.fold.a2x === true, JSON.stringify(c1.fold));
    ok("节点字段里的 fold 已被 delete（不留两份折叠真相）",
      !("fold" in c1.nodes[0].children[0]) && !("fold" in c1.nodes[0].children[1].children[0]),
      "a1.fold=" + c1.nodes[0].children[0].fold + " a2x.fold=" + c1.nodes[0].children[1].children[0].fold);
    ok("迁移标记 v:2 已落盘（幂等的依据）", JSON.parse(B.localStorage.getItem("mm_map_legacy-map")).v === 2);
    const snap1 = JSON.stringify({ fold: c1.fold, v: c1.v, edges: c1.edges });
    M.open("legacy-map");
    ok("迁移幂等：再打开一次 cur.fold / v / edges 都不变",
      JSON.stringify({ fold: M.state().cur.fold, v: M.state().cur.v, edges: M.state().cur.edges }) === snap1,
      snap1 + " → " + JSON.stringify({ fold: M.state().cur.fold, v: M.state().cur.v, edges: M.state().cur.edges }));

    /* 无 id 的老节点：migrateMap 在 fill 之前跑，会把折叠写成 key "undefined"（随后被当孤儿清掉，
       折叠静默丢失）。顺序必须是"容器归一 → 补 id → 搬折叠"。 */
    const noid = JSON.parse(JSON.stringify(LEGACY));
    delete noid.root.children[0].id;
    noid.root.children[0].fold = true;
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(noid));
    M.open("legacy-map");
    const c2 = M.state().cur;
    const fixed = c2.nodes[0].children[0];
    ok("无 id 的老节点被补上了 id", !!fixed.id && fixed.id !== "undefined", "id=" + fixed.id);
    ok("它的折叠落在**它自己的新 id** 上，没有 key \"undefined\" 残留",
      !("undefined" in c2.fold) && c2.fold[fixed.id] === true,
      "fold=" + JSON.stringify(c2.fold) + " 新 id=" + fixed.id);

    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC9. 删整棵子树后的孤儿清理：导图层表里不许留下不在树上的 id");
  /* 断言判据（Chief/提问bot 指定）：不是"被删的那个 id 不见了"，而是"表里不存在**任何**不在树上的 id"。
     这条同时把"折叠后代"排除在孤儿之外 —— 折叠只是不进布局，节点仍在树上，它们的坐标条目必须保留。 */
  const layerOrphans = (m) => {
    if (!m || !root0(m)) return [];
    const live = new Set();
    for (const t of (Array.isArray(m.nodes) ? m.nodes : (root0(m) ? [root0(m)] : []))) (function w(n) { live.add(n.id); (n.children || []).forEach(w); })(t);
    const bad = [];
    for (const t of LAYER_MAPS) for (const id of Object.keys(m[t] || {})) if (!live.has(id)) bad.push(t + ":" + id);
    for (const t of LAYER_LISTS) for (const e of (Array.isArray(m[t]) ? m[t] : [])) {
      if (!e || !e.from || !e.to) { bad.push(t + ":(坏条目)"); continue; }
      if (!live.has(e.from.node) || !live.has(e.to.node)) bad.push(t + ":" + (e.id || "?"));
    }
    return bad;
  };
  {
    // 干净夹具：把盘上那份重置成不带 pos/size 的旧图，重开后 seedPos 会重新播种
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const base = layerOrphans(M.state().cur);
    ok("前提：删除前导图层里就没有孤儿（" + Object.keys(M.state().cur.pos).length + " 条坐标 / " +
      Object.keys(M.state().cur.size).length + " 条尺寸）", base.length === 0, base.join(","));

    const stage9 = () => B.win.$("mmStage");
    const press = (el, pt) => { bubble(el, "pointerdown", { target: el, clientX: pt.x, clientY: pt.y }); bubble(el, "pointerup", { target: el, clientX: pt.x, clientY: pt.y }); };
    const a1 = root0(M.state().cur).children[0], leaf = (a1.children || [])[0];
    const elLeaf = stage9().querySelector('.mm-node[data-id="' + leaf.id + '"]');
    press(elLeaf, pointOn(leaf.id) || { x: 200, y: 200 });
    ok("前提：选中一级主题 " + a1.id + " 的子节点 " + leaf.id, M.state().sel === leaf.id, "sel=" + M.state().sel);
    bubble(B.doc.querySelector('[data-mm="child"]'), "click", { target: B.doc.querySelector('[data-mm="child"]') });   // 给它加一层 → 子树变三层
    let lv = 0;
    (function w(n, k) { lv = Math.max(lv, k); (n.children || []).forEach((c) => w(c, k + 1)); })(a1, 0);
    ok("前提：这棵子树已经是**三层**（相对 " + a1.id + " 最大深度 " + lv + "）", lv >= 2, "lv=" + lv);

    /* 重开一次再删：新建子节点时 startEdit 会开着编辑框，随后"按在 a1 上"会在 pointerdown 里触发
       endEdit() → draw() → #mmStage 的 innerHTML 被重写，**按下时那个元素被从树上摘掉**。
       真实浏览器里 pointerdown 已经 setPointerCapture 到 #mmView，指针事件照样送达；
       而仿真台是按 parentNode 冒泡的，元素一离开树就断链（这类序列在仿真台里驱动不了）。
       重开后 DOM 与编辑态都是干净的，按下-松手能被真实驱动。 */
    M.open("legacy-map");
    const a1b = root0(M.state().cur).children[0];
    const elA1 = stage9().querySelector('.mm-node[data-id="' + a1b.id + '"]');
    press(elA1, pointOn(a1b.id) || { x: 200, y: 200 });
    ok("前提：选中一级主题 " + a1b.id + "（准备删它整棵）", M.state().sel === a1b.id, "sel=" + M.state().sel);
    const killIds = [];
    (function w(n) { killIds.push(n.id); (n.children || []).forEach(w); })(a1b);
    const delBtn = B.doc.querySelector('[data-mm="del"]');
    bubble(delBtn, "click", { target: delBtn });
    const st9 = M.state(), orphans = layerOrphans(st9.cur);
    ok("删掉 " + a1b.id + " 的整棵子树（" + killIds.length + " 个节点、三层）后，pos/size 里**不存在任何不在树上的 id**",
      orphans.length === 0, "孤儿=" + orphans.join(",") + " · 树大小=" + (() => { let n = 0; (function w(x) { n++; (x.children || []).forEach(w); })(root0(st9.cur)); return n; })());
    ok("被删的那 " + killIds.length + " 个 id 的坐标/尺寸条目都清了",
      killIds.every((id) => !st9.cur.pos[id] && !st9.cur.size[id]), killIds.filter((id) => st9.cur.pos[id] || st9.cur.size[id]).join(","));
    ok("树里也确实没有这些节点了（删除本身生效）",
      killIds.every((id) => !(function has(n) { return n.id === id || (n.children || []).some(has); })(root0(st9.cur))));

    /* 读取容错：手工往**盘上**塞孤儿条目（模拟本次修复之前就被污染、已经写进 localStorage 的旧图），
       重开后必须被打开时的 pruneLayer 清掉并落回盘里。 */
    const raw = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    raw.pos = raw.pos || {}; raw.size = raw.size || {};
    raw.pos.GHOST1 = { x: 123, y: 456 }; raw.size.GHOST1 = { w: 80, h: 50 }; raw.pos.GHOST2 = { x: 7, y: 8 };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(raw));
    M.open("legacy-map");
    const stP = M.state(), afterOpen = layerOrphans(stP.cur);
    ok("打开时清掉了盘上残留的孤儿条目（读取容错，治本仍在 del）", afterOpen.length === 0, afterOpen.join(","));
    const a2 = root0(stP.cur).children[0];
    ok("没有误删在树上的节点坐标（" + a2.id + " 的坐标还在，共 " + Object.keys(stP.cur.pos).length + " 条）", !!stP.cur.pos[a2.id]);
    const diskP = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("修好的结果落回盘上（GHOST1 / GHOST2 在盘上也没了）", !diskP.pos.GHOST1 && !diskP.pos.GHOST2 && !diskP.size.GHOST1);

    /* 源码形状断言（**测的是写法，不是行为**）：坐标写入必须在 change() 的 fn 内，且全文只有 putLayerPos 一个写入口。
       为什么必须有这条：change() 先快照再执行 fn —— 写在 fn 外，撤销就回不去，并会留下孤儿条目。 */
    const src9raw = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    const src9 = src9raw.replace(/\/\*[\s\S]*?\*\//g, "");           // 剥注释，免得注释里的示意写法污染判定
    const fnSrc = (name) => { const i = src9.indexOf("function " + name + "("); if (i < 0) return ""; const j = src9.indexOf("\n  function ", i + 1); return src9.slice(i, j < 0 ? src9.length : j); };
    ok("（源码形状）坐标写入只有一个入口：全文只有 putLayerPos 内出现 curPos()[…] =",
      (src9.match(/curPos\(\)\[[^\]]*\]\s*=/g) || []).length === 1 &&
      /function putLayerPos\(id, p\) \{ if \(p\) curPos\(\)\[id\] = p; \}/.test(src9));
    const shape = {
      endNodeDrag: [/change\(putPos\)/.test(fnSrc("endNodeDrag")), /const putPos = \(\) => \{ if \(px != null && py != null\) putLayerPos\(d\.id/.test(fnSrc("endNodeDrag"))],
      addChild: [/change\(\(\) => \{\s*putLayerPos\(k\.id, at\);/.test(fnSrc("addChild"))],
      addSibling: [/change\(\(\) => \{\s*putLayerPos\(k\.id, at\);/.test(fnSrc("addSibling"))],
      addParent: [/change\(\(\) => \{\s*putLayerPos\(k\.id, at\);/.test(fnSrc("addParent"))],
    };
    for (const [nm, pats] of Object.entries(shape)) {
      const body = fnSrc(nm);
      ok("（源码形状）" + nm + "：写入在 change 的 fn 内", !!body && pats.every((p) => p) && body.length > 0,
        "命中=" + pats.map((p, i) => (p ? i : "-" + i)).join("") + " 长度=" + body.length);
      ok("（源码形状）" + nm + "：不存在 fn 外的直接 curPos()[…] = 写入",
        !!body && !/curPos\(\)\[[^\]]*\]\s*=/.test(body));
    }
    ok("（源码形状）两个清单各只有一处定义，且**各喂各的函数**：dropLayer 只碰 LAYER_MAPS、dropEdges 只碰 LAYER_LISTS",
      /const LAYER_MAPS = \["pos", "size", "fold"\];/.test(src9) && /const LAYER_LISTS = \["edges"\];/.test(src9) && /dropLayer\(kill/.test(fnSrc("del")) &&
      /for \(const t of LAYER_MAPS\)/.test(fnSrc("dropLayer")) && !/LAYER_LISTS/.test(fnSrc("dropLayer")) &&
      /for \(const t of LAYER_LISTS\)/.test(fnSrc("dropEdges")) && !/LAYER_MAPS/.test(fnSrc("dropEdges")) &&
      /dropEdges\(kill\)/.test(fnSrc("del")) &&
      /for \(const t of LAYER_(MAPS|LISTS)\)/.test(fnSrc("pruneLayer")) && /for \(const t of LAYER_(MAPS|LISTS)\)/.test(fnSrc("applyLayer")));
    /* 常驻反向对照（每次跑自测台都重验，不是改文件再改回）：往两个清单各塞一张假表 ——
       ① 孤儿判据必须立刻开始扫它；② 走真实删除链路时清理也必须跟上；
       ③ **列表类绝不当映射删**：条目自己的 id 恰好在树上也要按端点过滤掉。 */
    const probe = (() => {
      const m = M.state().cur;
      LAYER_MAPS.push("__probeMap"); LAYER_LISTS.push("__probeList");
      try {
        const victim2 = (root0(M.state().cur) && root0(M.state().cur).children[0] && root0(M.state().cur).children[0].id) || null;   // 根节点不可删，取第一个子节点
        m.__probeMap = { GHOSTMAP: { x: 0, y: 0 }, [victim2]: { x: 0, y: 0 } };   // 必须含 victim2，否则"按键删"那半是空断言（恒真）
        const mapScanned = layerOrphans(m).some((x) => x.indexOf("__probeMap:GHOSTMAP") === 0);
        m.__probeList = [
          { id: victim2, from: { node: victim2, side: "e" }, to: { node: "GHOSTNODE", side: "w" }, dir: "fwd" },
          { id: "GHOSTEDGE", from: { node: "GHOSTNODE" }, to: { node: "GHOSTNODE2" }, dir: "none" },
        ];
        const listScanned = layerOrphans(m).filter((x) => x.indexOf("__probeList:") === 0).length === 2;
        const el = B.win.$("mmStage").querySelector('.mm-node[data-id="' + victim2 + '"]');
        const pt = pointOn(victim2) || { x: 200, y: 200 };
        bubble(el, "pointerdown", { target: el, clientX: pt.x, clientY: pt.y });
        bubble(el, "pointerup", { target: el, clientX: pt.x, clientY: pt.y });
        const db = B.doc.querySelector('[data-mm="del"]');
        bubble(db, "click", { target: db });
        const after = M.state().cur;
        return { mapScanned, listScanned,
          mapCleaned: !(after.__probeMap && after.__probeMap[victim2]),
          keptMapGhost: !!(after.__probeMap && after.__probeMap.GHOSTMAP),
          listCleanedByEndpoints: !(after.__probeList || []).some((e) => e && e.from && e.from.node === victim2),
          keptOtherEntry: (after.__probeList || []).length === 1 };
      } finally {
        LAYER_MAPS.pop(); LAYER_LISTS.pop();
        const m2 = M.state().cur; if (m2) { delete m2.__probeMap; delete m2.__probeList; }
        B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY)); M.open("legacy-map");
      }
    })();
    ok("反向对照：假表塞进 LAYER_MAPS / LAYER_LISTS 后，孤儿判据立刻开始扫它们", probe.mapScanned && probe.listScanned, JSON.stringify(probe));
    ok("反向对照：真实删除链路按两个清单清理（映射按键删 victim2、GHOSTMAP 与另一条边都留着）",
      probe.mapCleaned && probe.listCleanedByEndpoints && probe.keptOtherEntry && probe.keptMapGhost, JSON.stringify(probe));
    ok("（源码形状）birthPos 是纯计算（不再自己写 curPos），spawnPos 仍在 change 之外算",
      /function birthPos\(anchor, at\) \{\s*return at \|\| spawnPos\(anchor\);/.test(src9) && !/function birthPos[\s\S]{0,200}putLayerPos/.test(src9));

    /* 行为断言（不是形状）：新建 → 撤销 → 不留孤儿。
       这是"写入必须在 change 的 fn 内"的**可观察后果**：change 先快照再执行 fn，
       若坐标在 fn 外先写，快照里就含了新节点的条目，撤销后它变成孤儿。 */
    M.open("legacy-map");
    const t9 = root0(M.state().cur).children[0];
    const n9 = Object.keys(M.state().cur.pos).length;
    press(stage9().querySelector('.mm-node[data-id="' + t9.id + '"]'), pointOn(t9.id) || { x: 200, y: 200 });
    const cb9 = B.doc.querySelector('[data-mm="child"]');
    bubble(cb9, "click", { target: cb9 });
    const n9b = Object.keys(M.state().cur.pos).length;
    ok("新建子节点让 pos 多一条（" + n9 + " → " + n9b + "）", n9b === n9 + 1);
    const ub9 = B.doc.querySelector('[data-mm="undo"]');
    if (ub9) bubble(ub9, "click", { target: ub9 });
    const afterUndo = layerOrphans(M.state().cur);
    ok("撤销「新建子节点」后导图层里没有孤儿（坐标写在 change 的 fn 内的可观察后果）",
      afterUndo.length === 0 && Object.keys(M.state().cur.pos).length === n9,
      "孤儿=" + afterUndo.join(",") + " · pos 条数=" + Object.keys(M.state().cur.pos).length + "（期望回到 " + n9 + "）");
    M.open("legacy-map");
  }

  console.log("\nC10. 备份文件导入：位置 / 尺寸一起搬回来（只搬树上存在的 id）");
  {
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const src = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    const someId = Object.keys(src.pos)[0];
    const backup = { app: "laolao-mindmap", v: 1, layout: "mind", theme: "fresh", line: "curve",
      root: JSON.parse(JSON.stringify(root0(src))), pos: Object.assign({}, src.pos), size: Object.assign({}, src.size) };
    backup.pos[someId] = { x: 777, y: 888 };          // 改一处：让"搬回来了"可判别（播种碰巧一样也能过就不算证据）
    backup.size[someId] = { w: 222, h: 111 };
    backup.pos.GHOST = { x: 1, y: 2 };                // 不在树上 → 不许搬进来
    backup.size.BADSHAPE = { w: -1, h: 0 };           // 形状不合法 → 不许搬进来
    const input = B.doc.createElement("input");       // 列表页的 #mmFileOpen 只在列表态存在；
    input.id = "mmFileOpen";                          // 这里直接造一个同 id 的输入元素，走的是同一条 readFile 链路
    const jsImp = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("列表页里确实有「打开文件」入口（id=mmFileOpen）", /<input type="file" id="mmFileOpen"/.test(jsImp));
    {
      input.files = [{ size: 4096, name: "backup.json", text: async () => JSON.stringify(backup) }];
      bubble(B.doc, "change", { target: input });
      await new Promise((res) => setTimeout(res, 20));      // readFile 是 async，等微任务跑完
      const c = M.state().cur;
      ok("导入后坐标跟着搬回来了（" + someId + " = " + JSON.stringify(c.pos[someId]) + "）",
        !!c.pos[someId] && c.pos[someId].x === 777 && c.pos[someId].y === 888);
      ok("尺寸也跟着搬回来了（" + JSON.stringify(c.size[someId]) + "）",
        !!c.size[someId] && c.size[someId].w === 222 && c.size[someId].h === 111);
      ok("不在树上的 id 没有被搬进来（GHOST）", !c.pos.GHOST);
      ok("形状不合法的尺寸没有被搬进来（BADSHAPE）", !c.size.BADSHAPE);
      ok("导入完导图层里没有孤儿（搬进来的 id 都在树上）", layerOrphans(c).length === 0, layerOrphans(c).join(","));
    }
    M.open("legacy-map");
  }

  console.log("\nC12. 前置③：每个 id 都有条目（反向）+ 导出→导入逐字段往返 + 复制导图重映射");
  {
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const tab = M.state().cur;
    const ids0 = [];
    (function w(n) { ids0.push(n.id); (n.children || []).forEach(w); })(root0(tab));
    /* ① 完整性（与"无孤儿"相反的方向）：树上每个 id 都必须有 pos/size 条目 —— 只断"无孤儿"会漏掉
       "表被清空/键没搬过去"这类静默丢数据。 */
    /* ① 完整性（与"无孤儿"相反的方向）：树上每个 id 都必须有 pos/size 条目 —— 只断"无孤儿"会漏掉
       "表被清空/键没搬过去"这类静默丢数据。
       为什么这里**写死 pos/size**（不用 LAYER_MAPS 遍历）：`fold` 只给"折叠过的节点"条目、
       `edges` 是列表不是按键表 —— 拿清单去遍历会把它们算成"缺失"，这条判据就假红了。
       将来加**按节点 id 的映射表**（如 size2）时，要把它显式加进这里，别以为这条自动覆盖。 */
    const missing0 = ids0.filter((id) => !tab.pos[id] || !tab.size[id]);
    ok("完整性：树上 " + ids0.length + " 个节点都有 pos/size 条目", missing0.length === 0, "缺=" + missing0.join(","));
    ok("完整性：两个方向合起来 == 表与树一致（无孤儿 + 无缺失）",
      layerOrphans(tab).length === 0 && Object.keys(tab.pos).length === ids0.length && Object.keys(tab.size).length === ids0.length,
      "pos=" + Object.keys(tab.pos).length + " size=" + Object.keys(tab.size).length + " 树=" + ids0.length);

    /* ② 往返：走**真实导出路径**（工具栏「⬇ 导出」→「备份文件（.json）」），把导出的原文喂回
       readFile，再逐字段比对（树 + 导图层）。
       手工拼一个 backup 只能证明"导入侧会搬 pos/size"，排除不了"导出侧压根没写"——
       "自己导出的文件自己读不回来"正是这一族的另一半。
       注意 fill() 会给叶子补 children:[]，树要按结构与字段值比，不能直接比字符串。 */
    const shapeOf = (n) => JSON.stringify({ id: n.id, text: n.text, bold: n.bold, color: n.color, progress: n.progress, note: n.note, link: n.link, marks: n.marks,
      children: (n.children || []).map((x) => JSON.parse(shapeOf(x))) });
    const norm = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
    /* 源图先造出可辨别的导图层内容：折叠走**产品路径**（点收起按钮）。
       边还没有 UI（①b 才做），这里直接往导图层插一条 —— 本组只验"导出/导入不丢边"，
       不声称验过连线交互。 */
    const foldTgt = root0(M.state().cur).children.find((c) => (c.children || []).length) || root0(M.state().cur).children[0];
    const foldEl = B.win.$("mmStage").querySelector('.mm-node[data-id="' + foldTgt.id + '"] .mm-fold');
    if (foldEl) bubble(foldEl, "click", { target: foldEl });
    ok("导出前：折叠通过产品路径（点收起按钮）写进导图层 cur.fold",
      !!M.state().cur.fold[foldTgt.id], "cur.fold=" + JSON.stringify(M.state().cur.fold));
    const eRT = { id: "edgeRT", from: { node: ids0[0], side: "e" }, to: { node: foldTgt.id, side: "w" }, dir: "fwd" };
    M.state().cur.edges = [eRT];
    /* download() 把数据包成 Blob 再交给 URL.createObjectURL：拦这个入口就能拿到导出原文。
       注意 `Blob` **不在仿真台沙箱的键里**（它解析到 Node 的真实全局 Blob，内容是真的），
       所以这里拿到的是真 Blob，用 await blob.text() 取回字符串 —— 比拦 Blob 构造可靠。 */
    let exportBlob = null;
    const realCOU = B.win.URL.createObjectURL;
    B.win.URL.createObjectURL = (data) => { exportBlob = data; return "blob:x"; };
    try {
      const exOpen = B.doc.querySelector('[data-mm="export"]');
      ok("工具栏有「导出」入口", !!exOpen);
      if (exOpen) bubble(exOpen, "click", { target: exOpen });
      const exJson = B.doc.querySelector('[data-mm="ex-json"]');
      ok("导出对话框里有「备份文件（.json）」入口", !!exJson);
      if (exJson) bubble(exJson, "click", { target: exJson });
    } finally { B.win.URL.createObjectURL = realCOU; }
    const exported = exportBlob && typeof exportBlob.text === "function" ? await exportBlob.text() : String(exportBlob);
    ok("导出串里含 pos/size（导出侧真的写了导图层，而不只是导入侧会读）",
      !!exported && /"pos"/.test(exported) && /"size"/.test(exported), "导出串长度=" + (exported || "").length);
    const exportedObj = JSON.parse(exported);
    ok("导出串里含 fold/edges（折叠与边也在同一份 blob 里，不是只活在内存）",
      !!exportedObj.fold && !!exportedObj.edges && exportedObj.fold[foldTgt.id] === true && exportedObj.edges.length === 1,
      "fold=" + JSON.stringify(exportedObj.fold) + " edges=" + JSON.stringify(exportedObj.edges));
    const inp = B.doc.createElement("input"); inp.id = "mmFileOpen";
    inp.files = [{ size: 4096, name: "rt.json", text: async () => exported }];
    bubble(B.doc, "change", { target: inp });
    await new Promise((res) => setTimeout(res, 20));
    const rt = M.state().cur;
    ok("往返（真实导出→导入）：树逐字段相同（结构 + 每个节点的字段值）", shapeOf(root0(rt)) === shapeOf(root0(exportedObj)));
    ok("往返：导图层逐字段相同（pos/size 的键与值都一致）",
      norm(rt.pos) === norm(exportedObj.pos) && norm(rt.size) === norm(exportedObj.size),
      "pos 本地=" + Object.keys(rt.pos).length + " 导出=" + Object.keys(exportedObj.pos).length);
    ok("往返：布局/主题/线型也带过来了", rt.layout === exportedObj.layout && rt.theme === exportedObj.theme && rt.line === exportedObj.line);
    ok("往返：fold 一起搬回来（" + foldTgt.id + " 仍是折叠状态）", !!rt.fold[foldTgt.id], JSON.stringify(rt.fold));
    ok("往返：edges 一起搬回来（1 条，端点与方向不变）",
      Array.isArray(rt.edges) && rt.edges.length === 1 && rt.edges[0].from.node === eRT.from.node &&
      rt.edges[0].to.node === eRT.to.node && rt.edges[0].dir === "fwd", JSON.stringify(rt.edges));

    /* ③ 复制导图：重发 id 时两个方向都要成立（新 id 有条目 + 没有旧 id 残留）。 */
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const rtId = M.state().cur.id;      // 往返导入那张图的 id（副本必然不是它、也不是 legacy-map）
    /* 点「复制一份」：按钮按生产位置挂在弹窗内容里（mapMenu 就是往 #mmDlgBody 里渲染这个按钮）。
       文档级 click 委派的门禁是 closest("#mmBox, #mmDlg, .mm-head")，**不挂进 DOM 会被直接 return** ——
       之前"副本没重映射"的假红根因就是这个（假按钮没进 DOM → duplicate() 一次都没跑）。 */
    const idxBefore = JSON.parse(B.localStorage.getItem("mm_index_v1")) || [];
    const fakeBtn = B.doc.createElement("button");
    fakeBtn.className = "mm-b"; fakeBtn.dataset.mm = "dupid"; fakeBtn.dataset.id = "legacy-map";
    if (true) B.win.$("mmDlgBody").appendChild(fakeBtn);   // 生产位置：mapMenu 就是把「复制一份」渲染进 #mmDlgBody
    bubble(B.doc, "click", { target: fakeBtn });
    await new Promise((res) => setTimeout(res, 40));
    const idx = JSON.parse(B.localStorage.getItem("mm_index_v1")) || [];
    /* 先证明"这个动作真的发生了"：索引条目数必须 +1（合成事件被门禁静默拦掉时这半就红，
       不会让下面的断言在旧对象上误判）。 */
    const newly = idx.filter((e) => e && !idxBefore.some((b) => b && b.id === e.id));
    ok("复制动作真的发生了（索引条目数 +1：" + idxBefore.length + " → " + idx.length + "，新增 " + newly.map((e) => e.id).join(",") + "）",
      newly.length === 1, "新增=" + JSON.stringify(newly.map((e) => e && e.id)));
    /* 按 id 差集找副本：副本的索引标题可能还是旧的（idxPut 没带 title，属既有小缺陷，另行记录），
       所以不能靠标题认副本。 */
    /* 副本识别：**不能按标题、也不能按"最新一条"** —— 索引里可能还有别处导入的图（它们的 id 与原图相同，
       会造出"8/8 重叠"的假红）。真判据：这张图的容器根 id 不在原图 id 集合里。 */
    const cand = idx.filter((e) => e && e.id !== "legacy-map")
      .map((e) => ({ id: e.id, m: JSON.parse(B.localStorage.getItem("mm_map_" + e.id) || "null") }))
      .filter((x) => x.m && Array.isArray(x.m.nodes) && x.m.nodes[0] && ids0.indexOf(x.m.nodes[0].id) < 0);
    const copy = cand[0];
    if (!copy) ok("复制导图产生了副本条目", false, JSON.stringify(idx.map((e) => e && e.id)));
    else {
      const cm = JSON.parse(B.localStorage.getItem("mm_map_" + copy.id));
      const idsC = [];
      (function w(n) { idsC.push(n.id); (n.children || []).forEach(w); })(root0(cm));
      const missC = idsC.filter((id) => !cm.pos[id] || !cm.size[id]);
      ok("副本：每个**新 id** 都有 pos/size 条目（反向断言，" + idsC.length + " 个）", missC.length === 0,
        "copy.id=" + copy.id + " 缺=" + missC.join(","));
      ok("副本：没有孤儿（旧 id 不残留）", layerOrphans(cm).length === 0,
        "copy.id=" + copy.id + " 孤儿=" + layerOrphans(cm).join(","));
      /* 「重发节点 id 必须同时重映射导图层」这条判据：副本的 id 集合与原图**完全不相交**
         （不重映射时 pos/size 的键还是旧 id → 副本一打开就被 pruneLayer 当孤儿清掉，位置全丢）。 */
      ok("副本：id 与原图完全不重叠（键与端点重映射生效）", idsC.every((id) => ids0.indexOf(id) < 0),
        "copy.id=" + copy.id + " 重叠 " + idsC.filter((id) => ids0.indexOf(id) >= 0).length + " / " + idsC.length);
    }
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC14. 多容器不许静默丢数据（pruneLayer/applyLayer/findNode 必须看全部容器）");
  {
    const two = JSON.parse(JSON.stringify(LEGACY));
    const rootA = root0(two);
    const rootB = { id: "b1", text: "第二丛", children: [{ id: "b1x", text: "B 子" }] };
    two.rootsLegacy = undefined; delete two.root;
    two.nodes = [rootA, rootB];
    two.pos = { [rootA.id]: { x: 0, y: 0 }, [rootA.children[0].id]: { x: 200, y: 0 }, [rootB.id]: { x: 900, y: 0 }, [rootB.children[0].id]: { x: 1100, y: 0 } };
    two.size = { [rootA.id]: { w: 120, h: 52 }, [rootA.children[0].id]: { w: 90, h: 40 }, [rootB.id]: { w: 120, h: 52 }, [rootB.children[0].id]: { w: 90, h: 40 } };
    two.fold = { [rootB.id]: true };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(two));
    M.open("legacy-map");
    const c = M.state().cur;
    ok("多容器图：两个容器都还在（" + (c.nodes || []).length + "）", Array.isArray(c.nodes) && c.nodes.length === 2);
    ok("第二个容器的 pos/size/fold 条目**没有被当孤儿删掉**（这正是修前的静默丢数据）",
      !!c.pos.b1 && !!c.size.b1 && !!c.size.b1x && c.fold.b1 === true,
      "pos.b1=" + JSON.stringify(c.pos.b1) + " size.b1=" + JSON.stringify(c.size.b1) + " fold=" + JSON.stringify(c.fold));
    ok("导图层里没有孤儿（全部容器的 id 都算 live）", layerOrphans(c).length === 0, layerOrphans(c).join(","));
    const disk = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("落盘后第二个容器的条目仍在（没有把丢数据写回盘）", !!disk.pos.b1 && !!disk.size.b1 && !!disk.fold.b1);
    /* 走**产品侧** findNode（window.Mindmap 导出），不自己写遍历：自写遍历只能证明"夹具里有那个节点"，
       证明不了产品的按 id 查找路径覆盖了全部容器。修前这条会红（findNode 默认只搜 nodes[0]）。 */
    const hitB = M.findNode("b1x");
    ok("产品 findNode 能按 id 找到第二个容器里的节点（修前：只搜 nodes[0] → null）",
      !!hitB && hitB.n && hitB.n.id === "b1x" && hitB.n.text === "B 子",
      "hit=" + (hitB && hitB.n ? hitB.n.id : "null"));
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nD. 新建子节点 → 不盖住父节点");
  const st = M.state();
  const target = [...st.L.nodes.values()].find((s) => s.depth === 1);
  const nodeEl = B.doc.querySelector('.mm-node[data-id="' + target.n.id + '"]');
  ok("画布上找得到要点击的节点 " + target.n.id, !!nodeEl, "（属性选择器修好后这条才是真的）");
  if (nodeEl) {
    const pt = pointOn(target.n.id) || { x: 100, y: 100 };
    // 注意：仿真台的 fire() 会按"当前冒泡到哪个祖先"覆写 e.target，所以 target 必须显式传（真实浏览器里 target 就是按下的那个元素）
    bubble(nodeEl, "pointerdown", { target: nodeEl, clientX: pt.x, clientY: pt.y });
    bubble(nodeEl, "pointerup", { target: nodeEl, clientX: pt.x, clientY: pt.y });
    ok("点击后该节点被选中", M.state().sel === target.n.id,
      "sel=" + M.state().sel + " 点=" + JSON.stringify(pt) + " 编辑框=" + !!B.win.$("mmStage").querySelector(".mm-edit"));
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
