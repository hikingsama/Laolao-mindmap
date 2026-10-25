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
      /* 行内 style 也要解析：真实 DOM 里 el.style.width 读的就是 style 属性（磁吸点直径写在行内），
         不解析的话"圆点直径是屏幕像素口径"这类断言只能拿到 undefined —— 又变成断不了的事。 */
      const sl = attrs.match(/\bstyle=["']([^"']*)["']/);
      if (sl) for (const decl of sl[1].split(";")) { const ci = decl.indexOf(":"); if (ci > 0) e.style[decl.slice(0, ci).trim()] = decl.slice(ci + 1).trim(); }
      /* 其余属性原样收进 `_attr_`（getAttribute 读的就是它）：真实 DOM 里 d / href / aria-* 都在这儿，
         不收的话"这条边的路径是什么"这类断言只能读到 undefined。 */
      const ae = /([\w:-]+)=["']([^"']*)["']/g; let a2;
      while ((a2 = ae.exec(attrs))) if (!/^(data-|class|id|title|style)$/.test(a2[1])) e["_attr_" + a2[1]] = a2[2];
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
    dispatchEvent(event) { this.fire(event.type,event); return true; },
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
  loadInto(b.sandbox, "js/edge-router.js", b.sandbox.window);
  loadInto(b.sandbox, "js/edge-policy.js", b.sandbox.window);
  /* 提示语取证：#showBanner 等宿主函数是在 **vendor 加载时**被当成参数绑进它的闭包的
     （loadInto 把沙箱的键列为 new Function 的形参），所以加载之后再改 window.showBanner 已经晚了。
     要断言"用户看得见的那句话"，必须在这里就换成记录版（并转发给真的那个，#banner 照旧可断）。 */
  b.banners = [];
  const realShowBanner = b.sandbox.showBanner;
  b.sandbox.showBanner = (msg) => { b.banners.push(String(msg == null ? "" : msg)); return realShowBanner(msg); };
  b.sandbox.window.showBanner = b.sandbox.showBanner;
  b.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
  b.localStorage.setItem("mm_index_v1", JSON.stringify([{ id: "legacy-map", title: "旧导图", updated: Date.now(), nodes: 9, version: 0, local: true, dirty: false }]));
  b.Mindmap = loadInto(b.sandbox, "vendor/mindmap.js", b.sandbox.window);
  return b;
}

/* ---------------- 测试主体 ---------------- */
module.exports = { bootAll, boot, loadInto, fireDelegated };
if (require.main === module && !process.argv.includes('--legacy')) {
  require('./verify-flat.cjs').run().catch(e => { console.error(e); process.exitCode = 1; });
}
if (require.main === module && process.argv.includes('--legacy')) {
console.log("捞捞思维导图（独立版）· 旧父子模型回归（仅供历史参考）\n");
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
  /* 【独立版·平级】容器是数组：夹具与断言统一用 root0() 取第一个容器。
     **形状知识只有 vendor 一处权威**（M.nodesOf）—— 自测台不自己写 `Array.isArray(m.nodes) ? … : [m.root]`。 */
  const root0 = (m) => M.nodesOf(m)[0] || null;
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
     ② 贴着边会被八方向命中区当成缩放（命中区边=16px），断言就会跑到 resize 分支上去。
     ③ 【新增】离任何一个磁吸点 < 22px 的点也要跳过：磁吸点**优先于**节点与缩放，
        落在磁吸点上的"点节点"会变成"从磁吸点拉线"（这条是加了连线功能之后才成立的）。 */
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
      if (covered) continue;
      /* 离任何节点的四个磁吸点太近 → 换一个候选点（磁吸点优先于节点/缩放） */
      const nearMag = [...st.L.nodes.values()].some((t) => t.x == null || t.n.id === undefined ? false : ["n", "e", "s", "w"].some((sd) => {
        const p = sd === "n" ? { x: t.x + t.w / 2, y: t.y } : sd === "s" ? { x: t.x + t.w / 2, y: t.y + t.h }
          : sd === "w" ? { x: t.x, y: t.y + t.h / 2 } : { x: t.x + t.w, y: t.y + t.h / 2 };
        return Math.hypot(x - (v.ox + p.x * v.k), y - (v.oy + p.y * v.k)) < 22;
      }));
      if (nearMag) continue;
      return { x: Math.round(x), y: Math.round(y) };
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
    ok("endNodeDrag 只落坐标：坐标写入在 change() 的 fn 内部（进撤销栈）",
      /change\(\(\) => putLayerPos\(d\.id, \{ x: px, y: py \}\)\)/.test(fn), fn.slice(0, 160).replace(/\s+/g, " "));
    ok("旧落点模型已删：drop-in / drop-before / drop-after / d.target 在 vendor 里都不再出现",
      !/drop-in|drop-before|drop-after|d\.target/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
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
    ok("拖节点改位置：endNodeDrag 仍把坐标写进 cur.pos（写入口唯一，且只落坐标）",
      js.includes("function endNodeDrag(") && js.includes("change(() => putLayerPos(d.id, { x: px, y: py }))"));
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
    ok("prep 按 hiddenIds() 决定建不建 box（源码形状：可见性只认那一处权威，不再读节点字段判折叠）", /if \(!hid\.has\(n\.id\)\)/.test(js2) && /const hid = hiddenIds\(cur, all\)/.test(js2));
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
      /* 双击空白建的点**本来就没有边**：这是合法状态，不许为了"看得见"硬塞一条边。
         没有边的节点必须可见（可见集合的种子 = 容器根 ∪ 没有出边的节点）。 */
      {
        const stD = M.state();
        const touches = (stD.cur.edges || []).filter((e) => e && e.from && e.to && (e.from.node === idC || e.to.node === idC));
        ok("双击空白建的点**没有边**（无边是合法状态，不许硬塞）", touches.length === 0, "碰到它的边=" + touches.length);
        ok("双击空白建的点（无边）**仍然可见**（无边 ≠ 被折叠）",
          M.visibleIds(stD.cur).has(idC), "可见集合=" + [...M.visibleIds(stD.cur)].sort().join(","));
        ok("双击空白建的点（无边）真的画在了画布上",
          !!B.doc.querySelector('#mmStage .mm-node[data-id="' + idC + '"]'));
      }
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
      /* 折叠状态在导图层：复位必须连它一起清，否则会跨子测试累积。
         ⚠️ 第 4 步之后 `edges` 是**唯一的关系来源**：把它清空 = 除了容器根谁都不可见。
         所以这里不清边；万一这份夹具没有边（老格式），把 v 退回 2 让 migrateMap 重新从 children 生成。 */
      r.fold = {};
      if (!Array.isArray(r.edges) || !r.edges.length) r.v = 2;
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
      M.nodesOf(c1).length === 1 && root0(c1).id === "r1" && !("root" in c1) && Object.prototype.hasOwnProperty.call(c1, "nodes"),
      "nodes=" + M.nodesOf(c1).map((r) => r.id).join(","));
    ok("节点字段上的折叠搬进导图层 cur.fold（a1 / a2x）",
      c1.fold.a1 === true && c1.fold.a2x === true, JSON.stringify(c1.fold));
    ok("节点字段里的 fold 已被 delete（不留两份折叠真相）",
      !("fold" in c1.nodes[0].children[0]) && !("fold" in c1.nodes[0].children[1].children[0]),
      "a1.fold=" + c1.nodes[0].children[0].fold + " a2x.fold=" + c1.nodes[0].children[1].children[0].fold);
    ok("迁移标记 v:3 已落盘（幂等的依据）", JSON.parse(B.localStorage.getItem("mm_map_legacy-map")).v === 3);
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

  console.log("\nC16. 搜索折叠分支：沿路展开必须走 change（可撤销 + 可落盘）");
  {
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const cur16 = () => M.state().cur;
    const fb16 = B.win.$("mmStage").querySelector('.mm-node[data-id="a1"] .mm-fold');
    ok("前提：画布上找得到 a1 的收起按钮", !!fb16);
    if (fb16) bubble(fb16, "click", { target: fb16 });
    ok("前提：a1 已折叠（cur.fold.a1）", cur16().fold.a1 === true, JSON.stringify(cur16().fold));
    const findIn16 = B.win.$("mmFindIn");
    ok("找得到搜索框 #mmFindIn", !!findIn16);
    if (findIn16) {
      findIn16.value = "重点";                       // 命中 a1x（在 a1 折叠的分支里）
      bubble(B.doc, "input", { target: findIn16 });  // 输入事件 → doFind（仿真台的 setTimeout 是立即执行）
      ok("搜到折叠分支里的节点后，沿路把 a1 展开（状态）", !cur16().fold.a1, JSON.stringify(cur16().fold));
      const disk16 = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
      ok("这次展开**已落盘**（写在 change 外就落不了盘）", !disk16.fold.a1, JSON.stringify(disk16.fold));
      const ub16 = B.doc.querySelector('[data-mm="undo"]');
      ok("找得到撤销按钮", !!ub16);
      if (ub16) bubble(ub16, "click", { target: ub16 });
      ok("撤销能把折叠状态换回来（写在 change 外就进不了撤销栈）", cur16().fold.a1 === true, JSON.stringify(cur16().fold));
    }
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC9. 删整棵子树后的孤儿清理：导图层表里不许留下不在树上的 id");
  /* 断言判据（Chief/提问bot 指定）：不是"被删的那个 id 不见了"，而是"表里不存在**任何**不在树上的 id"。
     这条同时把"折叠后代"排除在孤儿之外 —— 折叠只是不进布局，节点仍在树上，它们的坐标条目必须保留。 */
  const layerOrphans = (m) => {
    if (!m || !root0(m)) return [];
    const live = M.liveIds(m);      // 全部容器：走 vendor 的同一处遍历，不在这里再写一份形状知识
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
      endNodeDrag: [/change\(\(\) => putLayerPos\(d\.id, \{ x: px, y: py \}\)\)/.test(fnSrc("endNodeDrag"))],
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
    ok("（源码形状）两个清单各只有一处定义，且**各喂各的函数**：dropLayer 只碰 LAYER_MAPS、dropEdges 只碰 LAYER_LISTS、del 两处都调",
      /const LAYER_MAPS = \["pos", "size", "fold"\];/.test(src9) && /const LAYER_LISTS = \["edges"\];/.test(src9) && /dropLayer\(kill/.test(fnSrc("del")) &&
      /for \(const t of LAYER_MAPS\)/.test(fnSrc("dropLayer")) && !/LAYER_LISTS/.test(fnSrc("dropLayer")) &&
      /for \(const t of LAYER_LISTS\)/.test(fnSrc("dropEdges")) && !/LAYER_MAPS/.test(fnSrc("dropEdges")) &&
      /dropEdges\(kill\)/.test(fnSrc("del")));
    /* pruneLayer / applyLayer 必须**两类清单都处理**。旧写法 `/for \(const t of LAYER_(MAPS|LISTS)\)/`
       是假绿：`Regex.test` 命中一次就过，pruneLayer 只遍历 LAYER_MAPS、把列表那半丢了，它照样绿
       （标签写"处理两类"就成了假绿）。新写法**分别点名、两半都断**，范围是"函数 + 它对应的列表助手"这一对；
       助手是独立小函数（pruneEdgesIn / applyEdgesInto），所以"列表那半不走按键删"能用"函数体无 delete"钉住
       —— 正则没法按分支圈范围，整函数断"无 delete"会把映射分支里正当的 `delete d[id]` 逼红。
       先剥注释再断：注释里的 "delete" 不是代码。 */
    const codeOf = (name) => fnSrc(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const shapeOfLayerFn = (fn, helper) => ({
      mapsInBody: /for \(const t of LAYER_MAPS\)/.test(codeOf(fn)),
      callsHelper: codeOf(fn).indexOf(helper + "(") >= 0,
      listsInHelper: /for \(const t of LAYER_LISTS\)/.test(codeOf(helper)),
      noDeleteInHelper: !/delete\s/.test(codeOf(helper)),
      deleteInBody: /delete\s/.test(codeOf(fn)),
    });
    const shPrune = shapeOfLayerFn("pruneLayer", "pruneEdgesIn");
    ok("（源码形状）pruneLayer：映射分支在 + 调 pruneEdgesIn；pruneEdgesIn 只碰 LAYER_LISTS 且函数体无 delete；映射分支仍有 delete（按键删）",
      shPrune.mapsInBody && shPrune.callsHelper && shPrune.listsInHelper && shPrune.noDeleteInHelper && shPrune.deleteInBody,
      JSON.stringify(shPrune));
    const shApply = shapeOfLayerFn("applyLayer", "applyEdgesInto");
    ok("（源码形状）applyLayer：映射分支在 + 调 applyEdgesInto；applyEdgesInto 只碰 LAYER_LISTS 且函数体无 delete；**全函数体无 delete**（导入只搬不删，与 prune 相反）",
      shApply.mapsInBody && shApply.callsHelper && shApply.listsInHelper && shApply.noDeleteInHelper && !shApply.deleteInBody,
      JSON.stringify(shApply));
    /* 「写入必须在 change 的 fn 内」这条纪律扩到 setFold：清单式点名 + **元断言**
       （vendor 里 setFold( 出现总次数 == 清单长度）。新增调用点而不进清单 → 总数对不上 → 红。
       为什么需要它：把一条写在 change 外的 setFold 移进来，只改那一处就"修好了"，下一个人再加一处
       没有人管 —— 元断言把"以后新增的"也纳入判据。 */
    const srcCode = src9.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const setFoldSites = [
      { name: "addChild", pat: "setFold(r.n, false); (r.n.children ||= []).push(k)" },
      { name: "paste-into-node", pat: "change(() => { setFold(r.n, false); (r.n.children ||= []).push(...fresh);" },
      { name: "toggleFold", pat: "change(() => { setFold(r.n, !isFold(r.n)); })" },
      { name: "foldLevel", pat: "setFold(n, lv > 0 && d >= lv)" },
      { name: "moveSibling", pat: "setFold(prev, false); (prev.children ||= []).push(r.n)" },
      { name: "outlineFold", pat: "change(() => { setFold(r.n, !isFold(r.n)); }); outline(id)" },
    ];
    const totalSetFold = (srcCode.match(/setFold\(/g) || []).length;
    ok("（元断言）vendor 里 setFold( 出现总次数 == 清单长度（新增调用点不进清单就红）",
      totalSetFold === setFoldSites.length, "总数=" + totalSetFold + " 清单=" + setFoldSites.length);
    const missSite = setFoldSites.filter((s) => srcCode.indexOf(s.pat) < 0);
    ok("（清单）" + setFoldSites.length + " 处 setFold 调用点逐一点名都在", missSite.length === 0,
      "没命中=" + missSite.map((s) => s.name).join(","));
    const changeRanges = [];
    /* 两种写法都算：`change(() => { … })`（块体）与 `change(() => expr)`（表达式体，foldLevel 就是它）。
       所以范围按 change( 的圆括号配对算，而不是找 "=> {"。 */
    for (let i = srcCode.indexOf("change(() =>"); i >= 0; i = srcCode.indexOf("change(() =>", i + 1)) {
      const open = srcCode.indexOf("(", i); let depth = 0;
      for (let k = open; k < srcCode.length; k++) {
        if (srcCode[k] === "(") depth++;
        else if (srcCode[k] === ")") { depth--; if (!depth) { changeRanges.push([open, k]); break; } }
      }
    }
    const outside = [];
    for (let i = srcCode.indexOf("setFold("); i >= 0; i = srcCode.indexOf("setFold(", i + 1)) {
      if (!changeRanges.some(([a, b]) => i > a && i < b)) outside.push(srcCode.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, " "));
    }
    ok("每处 setFold 都落在 change(() => { … }) 块内（写在 change 外就撤不回、也落不了盘）",
      outside.length === 0, "块外的=" + outside.join(" | "));
    /* ==== META-SHAPE-SCAN ==== */
    /* 元断言：**数据形状只有一处权威**。tools/ 下的脚本（含 verify-ui.mjs 的页内片段）不许自带
       第二份"是不是 nodes 数组"的知识 —— 遍历与判形状一律走 vendor 导出的 nodesOf / liveIds。
       扫的是**去掉注释后**的源码，并把本段自身剪掉（免得模式串自命中）。 */
    const SHAPE_SNIFF = [
      { name: "Array.isArray(…nodes) 这类形状嗅探", re: /Array\.isArray\([^\n]*\.nodes\b/ },
      { name: "三元里取 [ …root ]（旧格式嗅探）", re: /\?\s*\[[^\]\n]*\.root\b/ },
      { name: "直接读 cur.root", re: /\bcur\.root\b/ },
    ];
    const sniffHits = [];
    for (const f of ["tools/smoke.js", "tools/verify-ui.mjs"]) {
      const raw = require("fs").readFileSync(require("path").join(__dirname, "..", f), "utf8");
      const a = raw.indexOf("META-SHAPE-SCAN ===="), b = raw.indexOf("META-SHAPE-SCAN END ==== */");
      const body0 = a >= 0 && b > a ? raw.slice(0, raw.lastIndexOf("/*", a)) + raw.slice(b + "META-SHAPE-SCAN END ==== */".length) : raw;
      const body = body0.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const s of SHAPE_SNIFF) { const mm = body.match(s.re); if (mm) sniffHits.push(f + " → " + s.name + "：" + mm[0].trim()); }
    }
    ok("（元断言）tools/ 里没有第二份数据形状知识（形状/遍历一律走 Mindmap.nodesOf / liveIds）",
      sniffHits.length === 0, sniffHits.join(" | "));
    /* ==== META-SHAPE-SCAN END ==== */
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
    /* 多容器备份：不许静默只取第一个容器（当前版本只画第一个容器，但数据要都在、并且给可见提示）。 */
    const twoC = JSON.parse(JSON.stringify(LEGACY));
    const rootA = root0(twoC);
    const rootB = { id: "b1", text: "第二丛", children: [{ id: "b1x", text: "B 子" }] };
    delete twoC.root; twoC.nodes = [rootA, rootB];
    twoC.pos = { [rootA.id]: { x: 0, y: 0 }, b1: { x: 900, y: 0 }, b1x: { x: 1100, y: 0 } };
    twoC.size = { [rootA.id]: { w: 120, h: 52 }, b1: { w: 120, h: 52 }, b1x: { w: 90, h: 40 } };
    const bannersBefore = B.banners.length;
    let cImp = null;
    {
      const inp2 = B.doc.createElement("input"); inp2.id = "mmFileOpen";
      inp2.files = [{ size: 4096, name: "two.json", text: async () => JSON.stringify(twoC) }];
      bubble(B.doc, "change", { target: inp2 });
      await new Promise((res) => setTimeout(res, 20));
      cImp = M.state().cur;
    }
    const banners = B.banners.slice(bannersBefore);
    ok("导入含 2 个容器的备份：两个容器都进来了（不许静默只取第一个）",
      !!cImp && M.nodesOf(cImp).length === 2, "nodes=" + (cImp ? M.nodesOf(cImp).length : "null"));
    ok("第二个容器的节点与 pos/size 也一起搬进来（b1 / b1x）",
      !!(cImp && cImp.pos.b1 && cImp.size.b1 && cImp.pos.b1x), JSON.stringify(cImp && cImp.pos));
    ok("多容器导入给了可见提示（不是静默）", banners.some((s) => /独立容器/.test(s)), JSON.stringify(banners));
    ok("导入后导图层没有孤儿（两个容器的 id 都算 live）", !cImp || layerOrphans(cImp).length === 0, cImp ? layerOrphans(cImp).join(",") : "cur 为空");

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
    const vBefore = M.state().cur.v;                 // 迁移标记（应为 2），用来钉导出串里的 v
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
    /* 导出串里的 v 跟着 cur.v（= 迁移标记 2）：原来写死 `v: 1` 却被 `...cur` 覆盖 —— 字面量是死代码，
       而且"写的是 1、导出的是 2"这种自相矛盾会把下一个读代码的人带沟里。 */
    ok("导出串的 v 与当前图一致（不再有被 ...cur 覆盖的死字面量）",
      exportedObj.v === vBefore && exportedObj.v === 3, "导出 v=" + exportedObj.v + " cur.v=" + vBefore);
    /* 上面那条**在旧代码上也是绿的**（旧写法 `{v:1, ...cur}` 里 ...cur 已经把 v 覆盖成 2）——
       所以缺陷不是"导出错了"，而是"代码写着 1、导出 2"这种自相矛盾（下一个读代码的人会被带沟里）。
       行为断言抓不到它，只能拿源码形状钉：导出那行不许再有 v: 1 字面量。 */
    const srcVendor = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8");
    ok("（源码形状）导出 JSON 那行不再写死 v: 1（被 ...cur 覆盖的死字面量）",
      !/app: "laolao-mindmap", v: 1,/.test(srcVendor), "命中=" + /app: "laolao-mindmap", v: 1,/.test(srcVendor));
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
    ok("往返：edges 一起搬回来（那条测试边在、端点与方向不变）",
      Array.isArray(rt.edges) && rt.edges.some((e) => e.id === "edgeRT" && e.from.node === eRT.from.node &&
        e.to.node === eRT.to.node && e.dir === "fwd"), JSON.stringify(rt.edges));

    /* ③ 复制导图：重发 id 时两个方向都要成立（新 id 有条目 + 没有旧 id 残留）。 */
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
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
      .filter((x) => x.m && root0(x.m) && ids0.indexOf(root0(x.m).id) < 0);
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
    ok("多容器图：两个容器都还在（" + M.nodesOf(c).length + "）", M.nodesOf(c).length === 2);
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
    /* 「多容器不许静默」在大纲与搜索上已经**改成覆盖全部容器**（第②步，见 C18）：
       所以这两处不再需要"只列/只搜第一个"的提示了 —— 这里改成断"真覆盖到了"。 */
    const oBtn = B.doc.querySelector('[data-mm="outline"]');
    ok("找得到「大纲」入口", !!oBtn);
    if (oBtn) bubble(oBtn, "click", { target: oBtn });
    /* 注意：这份夹具把**第二个容器的根**设成了折叠（two.fold[rootB]=true），所以大纲按折叠语义
       只列到 b1、不列 b1x —— 断 b1 才对（这本身也是"折叠不再往下建行"的正确表现）。 */
    ok("大纲里能看到第二个容器（b1，且带容器分隔行）—— 不再只列第一个",
      !!B.doc.querySelector('#mmOutline [data-id="b1"]') && !!B.doc.querySelector("#mmOutline .mo-sep"));
    if (oBtn) bubble(oBtn, "click", { target: oBtn });          // 切回导图
    const fBtn = B.doc.querySelector('[data-mm="find"]');
    ok("找得到「搜索」入口", !!fBtn);
    if (fBtn) bubble(fBtn, "click", { target: fBtn });
    const findIn14 = B.win.$("mmFindIn"); findIn14.value = "B 子"; bubble(B.doc, "input", { target: findIn14 });
    ok("搜索覆盖到第二个容器（#mmFindN = " + String(B.win.$("mmFindN").textContent) + "）",
      String(B.win.$("mmFindN").textContent) === "1 / 1");
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC18. 渲染与布局：**所有容器**都要画出来（draw 与 PNG 导出共用同一份 layout）");
  {
    const two = JSON.parse(JSON.stringify(LEGACY));
    const rA = root0(two);
    const rB = { id: "b1", text: "第二丛", children: [{ id: "b1x", text: "B 子" }] };
    delete two.root; two.nodes = [rA, rB];
    two.pos = { [rA.id]: { x: 0, y: 0 }, b1: { x: 900, y: 0 }, b1x: { x: 1100, y: 0 } };
    two.size = { [rA.id]: { w: 120, h: 52 }, b1: { w: 120, h: 52 }, b1x: { w: 90, h: 40 } };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(two));
    M.open("legacy-map");
    const c18 = M.state().cur;
    const total = M.nodesOf(c18).reduce((a, r) => { let k = 0; (function w(n) { k++; (n.children || []).forEach(w); })(r); return a + k; }, 0);
    const domN = B.doc.querySelectorAll("#mmStage .mm-node").length;
    ok("画布上画出的节点数 == 全部容器的节点数（" + domN + " / " + total + "）—— 修前只画第一个容器", domN === total, "dom=" + domN);
    ok("第二个容器里的节点真的在画布上（b1 / b1x）",
      !!B.doc.querySelector('#mmStage .mm-node[data-id="b1x"]') && !!B.doc.querySelector('#mmStage .mm-node[data-id="b1"]'));
    const b1s = M.state().L.nodes.get("b1");
    ok("第二个容器的坐标按 cur.pos 落地（b1.x ≈ 900，实测 " + (b1s && b1s.x) + "）", !!b1s && Math.abs(b1s.x - 900) < 1);
    /* draw() 与 exportPng() 共用同一个 layout()：bounds 覆盖到第二个容器 = 导出也画得到它 */
    const bd = M.state().L.bounds;
    ok("布局 bounds 覆盖到第二个容器（x1=" + Math.round(bd.x1) + " ≥ b1 右边界 " + (b1s ? Math.round(b1s.x + b1s.w) : "b1 不在布局里") + "）—— PNG 导出用的是同一份",
      !!b1s && bd.x1 >= b1s.x + b1s.w - 0.5);
    /* 大纲与搜索也要看到全部容器 */
    const oBtn18 = B.doc.querySelector('[data-mm="outline"]');
    if (oBtn18) bubble(oBtn18, "click", { target: oBtn18 });
    ok("大纲里出现第二个容器的节点（b1x）", !!B.doc.querySelector('#mmOutline [data-id="b1x"]'));
    if (oBtn18) bubble(oBtn18, "click", { target: oBtn18 });
    const findIn18 = B.win.$("mmFindIn");
    if (findIn18) { findIn18.value = "B 子"; bubble(B.doc, "input", { target: findIn18 }); }
    ok("搜索能搜到第二个容器里的节点（#mmFindN = " + String(B.win.$("mmFindN").textContent) + "）",
      String(B.win.$("mmFindN").textContent) === "1 / 1");
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC17. 磁吸点 + 拖拽预览线 + 松手建边（第 1 步：能拖出一条线）");
  {
    /* 屏幕坐标：把舞台坐标按 #mmStage 的 transform 换算成浏览器像素（与真实鼠标一致）。
       magPoint 算的是**磁吸点**（节点盒四条边的中点），不是节点中心。 */
    function magPoint(id, side) {
      const s = M.state().L.nodes.get(id);
      const v = view2screen();
      const p = side === "n" ? { x: s.x + s.w / 2, y: s.y } : side === "s" ? { x: s.x + s.w / 2, y: s.y + s.h }
        : side === "w" ? { x: s.x, y: s.y + s.h / 2 } : { x: s.x + s.w, y: s.y + s.h / 2 };
      return { x: v.ox + p.x * v.k, y: v.oy + p.y * v.k };
    }
    const cur17 = () => M.state().cur;
    /* ⚠️ #mmView 会被重渲染成**新对象**（仿真台按 innerHTML 重建 #mmBox 的壳），所以事件一律**现取**：
       开局抓一次存着的话，事件全部打在不再接线的旧对象上 —— 表现是"鼠标操作静默变成空操作"，
       而且不报错（这次我就在这上面栽了一轮）。 */
    const vwOf = () => B.win.$("mmView") || B.doc.querySelector("#mmView");
    const wrapOf = (id) => B.doc.querySelector('#mmStage .mm-magwrap[data-id="' + id + '"]');
    const kAt = () => { const v = view2screen(); return v ? v.k : NaN; };
    /* 圆点的**屏幕**直径 = clamp(0.25 × min(节点屏幕宽, 高), 6, 12)；写进舞台的是它除以 view.k ——
       所以"屏幕恒定"的准确含义是"不跟着舞台缩放"，不是"永远同一个像素数"。 */
    const magDiaAt = (s, k) => Math.max(6, Math.min(12, Math.round(0.25 * Math.min(s.w * k, s.h * k))));
    const reset17 = () => { B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY)); M.open("legacy-map"); };

    reset17();
    const nodes17 = [...M.state().L.nodes.values()].filter((s) => s.x != null);
    const wraps17 = B.doc.querySelectorAll("#mmStage .mm-magwrap");
    ok("每个节点都渲染了磁吸点层，每层 4 个点（" + wraps17.length + " 层 / " +
      B.doc.querySelectorAll("#mmStage .mm-magwrap .mm-mag").length + " 个点）",
      wraps17.length === nodes17.length && B.doc.querySelectorAll("#mmStage .mm-magwrap .mm-mag").length === nodes17.length * 4);
    const oneId = nodes17.find((s) => s.depth === 1).n.id, oneS = M.state().L.nodes.get(oneId);
    const dot0 = wrapOf(oneId).children[0];
    const wantDia = magDiaAt(oneS, kAt());
    ok("圆点直径是**屏幕**像素口径（舞台内 " + dot0.style.width + " × k=" + kAt().toFixed(2) + " → " +
      (parseFloat(dot0.style.width) * kAt()).toFixed(1) + "px，期望 " + wantDia + "px = clamp(0.25×min(节点屏幕w,h),6,12)）",
      Math.abs(parseFloat(dot0.style.width) * kAt() - wantDia) <= 1);

    /* 靠近淡入：常态没有 mag-on；指针移到节点附近 → 那一个亮；移开 → 灭。 */
    bubble(vwOf(), "pointermove", { clientX: 5, clientY: 5 });
    ok("常态：没有节点亮着磁吸点（靠近才淡入）", B.doc.querySelectorAll("#mmStage .mm-magwrap.mag-on").length === 0);
    const c17 = magPoint(oneId, "e");
    bubble(vwOf(), "pointermove", { clientX: c17.x + 6, clientY: c17.y });
    ok("指针靠近节点 → 该节点的磁吸点亮起（.mag-on）",
      !!wrapOf(oneId) && wrapOf(oneId).classList.contains("mag-on"),
      "亮着的=" + B.doc.querySelectorAll("#mmStage .mm-magwrap.mag-on").length);

    /* 屏幕恒定：缩放后圆点直径必须回到 magDia(当前 k)/view.k（否则它会跟着舞台一起放大/缩小）。 */
    bubble(vwOf(), "wheel", { ctrlKey: true, deltaY: 300, clientX: c17.x, clientY: c17.y });
    const kNow = kAt(), wAfter = parseFloat(wrapOf(oneId).children[0].style.width);
    const wantNow = magDiaAt(M.state().L.nodes.get(oneId), kNow);
    ok("缩放后圆点的**屏幕直径**仍等于 magDia(当前 k)（k=" + kNow.toFixed(2) + "：舞台内 " + wAfter +
      " × k = " + (wAfter * kNow).toFixed(1) + "px，期望 " + wantNow + "px）",
      Math.abs(wAfter * kNow - wantNow) <= 1.5);
    reset17();
    ok("前提：#mmStage 的 transform 可解析（view.x/view.y 不是 NaN —— 被污染了后面所有几何都会静默落空）",
      !!view2screen(), String(B.win.$("mmStage").style.transform));

    /* 拖出一条线：按在磁吸点上 → 移动 → 虚线预览 + 目标端空心圆 → 松在另一个节点的磁吸点上 = 建边 */
    const a = root0(cur17()).children.find((n) => n.id !== oneId && (n.children || []).length) || root0(cur17()).children[1];
    const fromP = magPoint(oneId, "e"), toP = magPoint(a.id, "w");
    ok("前提：取到两个不同节点的磁吸点（" + oneId + ".e → " + a.id + ".w）", oneId !== a.id);
    const edges0 = (cur17().edges || []).length;
    bubble(vwOf(), "pointerdown", { clientX: fromP.x, clientY: fromP.y });
    ok("按在磁吸点上：源点所在节点进连线态（.linking），且**没有**进入缩放态",
      !!wrapOf(oneId) && wrapOf(oneId).classList.contains("linking") &&
      B.doc.querySelectorAll("#mmStage .mm-node").length > 0);
    bubble(vwOf(), "pointermove", { clientX: (fromP.x + toP.x) / 2, clientY: (fromP.y + toP.y) / 2 });
    const prevHtml = String(B.doc.querySelector("#mmStage .mm-linkprev").innerHTML || "");
    ok("拖动中有一条**虚线**预览线", /<path[^>]*stroke-dasharray/.test(prevHtml), prevHtml.slice(0, 90));
    bubble(vwOf(), "pointermove", { clientX: toP.x, clientY: toP.y });
    ok("指针落到候选磁吸点上：预览吸附过去并给目标端空心圆",
      /<circle[^>]*fill="none"/.test(String(B.doc.querySelector("#mmStage .mm-linkprev").innerHTML || "")),
      String(B.doc.querySelector("#mmStage .mm-linkprev").innerHTML || "").slice(0, 120));
    bubble(vwOf(), "pointerup", { clientX: toP.x, clientY: toP.y });
    const es = cur17().edges || [];
    ok("松手落在另一个磁吸点上 → 建出一条边（" + edges0 + " → " + es.length + "）", es.length === edges0 + 1);
    const e0 = es[es.length - 1];
    ok("边的端点就是那两个磁吸点（from=" + JSON.stringify(e0 && e0.from) + " to=" + JSON.stringify(e0 && e0.to) + "，默认 dir=fwd）",
      !!e0 && e0.from.node === oneId && e0.from.side === "e" && e0.to.node === a.id && e0.to.side === "w" && e0.dir === "fwd");
    ok("松手后预览线清空、连线态解除",
      String(B.doc.querySelector("#mmStage .mm-linkprev").innerHTML || "") === "" &&
      B.doc.querySelectorAll("#mmStage .mm-magwrap.linking, #mmStage .mm-magwrap.hot").length === 0);
    ok("**端点不落盘坐标**：这条边里没有任何 x/y 字样（只有 id + side + dir）",
      !/"x"|"y"/.test(JSON.stringify(e0)), JSON.stringify(e0));
    const disk17 = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("边已落盘（磁盘上也是 " + (edges0 + 1) + " 条）", Array.isArray(disk17.edges) && disk17.edges.length === edges0 + 1);
    ok("建边没有动尺寸（连线不触发缩放）", JSON.stringify(cur17().size) === JSON.stringify(disk17.size));

    /* 第 2 步：边要**画出来**（默认单指向、箭头在目标端），端点每帧现算。
       断言读 DOM 元素与原属性（仿真台现在也收 `d` 这类属性，走 getAttribute）。 */
    const edgeDom = () => {
      const line = B.doc.querySelector('#mmStage .mm-links path.mm-edge[data-id="' + e0.id + '"]');
      const arrows = B.doc.querySelectorAll('#mmStage .mm-links path.mm-arrow[data-edge="' + e0.id + '"]');
      return {
        lines: B.doc.querySelectorAll('#mmStage .mm-links path.mm-edge[data-id="' + e0.id + '"]').length,
        to: arrows.filter((x) => x.dataset.end === "to").length,
        from: arrows.filter((x) => x.dataset.end === "from").length,
        d: line ? String(line.getAttribute("d") || "") : "",
      };
    };
    let ed = edgeDom();
    ok("边真的画在画布上了（.mm-edge[data-id] = " + ed.lines + "）", ed.lines === 1, JSON.stringify(ed));
    ok("默认单指向：箭头只有**目标端**一个（to=" + ed.to + " from=" + ed.from + "）", ed.to === 1 && ed.from === 0, JSON.stringify(ed));
    /* 端点必须等于两个磁吸点（每帧现算，不是落盘坐标） */
    const mp1 = magPoint(oneId, "e"), mp2 = magPoint(a.id, "w");
    const v17 = view2screen();
    const want = { x1: (mp1.x - v17.ox) / v17.k, y1: (mp1.y - v17.oy) / v17.k, x2: (mp2.x - v17.ox) / v17.k, y2: (mp2.y - v17.oy) / v17.k };
    const dm = ed.d.match(/^M(-?[\d.]+),(-?[\d.]+) L(-?[\d.]+),(-?[\d.]+)$/);
    ok("边的两个端点就是那两个磁吸点的舞台坐标（现算，不是落盘值）",
      !!dm && Math.abs(+dm[1] - want.x1) < 1 && Math.abs(+dm[2] - want.y1) < 1 && Math.abs(+dm[3] - want.x2) < 1 && Math.abs(+dm[4] - want.y2) < 1,
      "path=" + ed.d + " 期望=" + JSON.stringify(want));
    /* 四种指向的箭头位置（**菜单是第 3 步**）—— 这里走真实读取路径：写盘 → 重新打开 → 看渲染。 */
    const setDirAndReopen = (d) => {
      const raw = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
      raw.edges[raw.edges.length - 1].dir = d;
      B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(raw));
      M.open("legacy-map");
      return edgeDom();
    };
    ed = setDirAndReopen("rev");
    ok("dir=rev：箭头只画在起点（to=" + ed.to + " from=" + ed.from + "）", ed.to === 0 && ed.from === 1, JSON.stringify(ed));
    ed = setDirAndReopen("both");
    ok("dir=both：两端都有箭头（to=" + ed.to + " from=" + ed.from + "）", ed.to === 1 && ed.from === 1, JSON.stringify(ed));
    ed = setDirAndReopen("none");
    ok("dir=none：线在、箭头一个都不画（to=" + ed.to + " from=" + ed.from + "）", ed.lines === 1 && ed.to === 0 && ed.from === 0, JSON.stringify(ed));
    ed = setDirAndReopen("fwd");
    ok("回到默认 dir=fwd：箭头回到目标端（to=" + ed.to + " from=" + ed.from + "）", ed.to === 1 && ed.from === 0, JSON.stringify(ed));

    /* 非法目标：同一个节点（自环）/ 已经连过的那对 → 不建边，并给一句确定的提示（不静默） */
    const nB = (cur17().edges || []).length;
    bubble(vwOf(), "pointerdown", { clientX: fromP.x, clientY: fromP.y });
    const sameP = magPoint(oneId, "w");
    bubble(vwOf(), "pointerup", { clientX: sameP.x, clientY: sameP.y });
    ok("松回**同一个节点**的磁吸点 → 不建自环，并给提示",
      (cur17().edges || []).length === nB && B.banners.some((s) => /不能连线/.test(s)),
      "banners=" + JSON.stringify(B.banners.slice(-2)));
    bubble(vwOf(), "pointerdown", { clientX: fromP.x, clientY: fromP.y });
    bubble(vwOf(), "pointerup", { clientX: toP.x, clientY: toP.y });
    ok("同一对磁吸点再来一次 → 不重复建边，并给提示",
      (cur17().edges || []).length === nB && B.banners.some((s) => /已经有一条线/.test(s)),
      "banners=" + JSON.stringify(B.banners.slice(-2)));
    /* 反向也算同一对端点：A.e→B.w 已存在时，从 **B.w 拖回 A.e** 也要拦下来并给提示（不许静默丢）。
       同一个磁吸点可以被多条边共用（扇出）—— 所以只有"两端都对上了"才算重复。 */
    const nB2 = (cur17().edges || []).length;
    bubble(vwOf(), "pointerdown", { clientX: toP.x, clientY: toP.y });      // 从 B.w 起步
    bubble(vwOf(), "pointerup", { clientX: fromP.x, clientY: fromP.y });    // 拖回 A.e
    ok("反向同一对端点（B.w → A.e）也被拦下，并给可见提示（不许静默丢弃）",
      (cur17().edges || []).length === nB2 && B.banners.some((s) => /已经有一条线/.test(s)),
      "边数=" + (cur17().edges || []).length + " banners=" + JSON.stringify(B.banners.slice(-2)));
    /* 平行边靠不同端点对成立：A.s → B.w 是另一条合法边 */
    const sA = magPoint(oneId, "s"), wB = magPoint(a.id, "w");
    bubble(vwOf(), "pointerdown", { clientX: sA.x, clientY: sA.y });
    bubble(vwOf(), "pointerup", { clientX: wB.x, clientY: wB.y });
    ok("不同端点对（A.s → B.w）是另一条合法边（平行边允许）",
      (cur17().edges || []).length === nB2 + 1,
      "边数=" + (cur17().edges || []).length);

    /* 松在空白 = 静默取消（不建边、不留预览、不报错） */
    const nBlank = (cur17().edges || []).length;                 // 以**当前**条数为基准（上面刚加过平行边）
    bubble(vwOf(), "pointerdown", { clientX: fromP.x, clientY: fromP.y });
    bubble(vwOf(), "pointermove", { clientX: fromP.x + 300, clientY: fromP.y + 220 });
    bubble(vwOf(), "pointerup", { clientX: fromP.x + 300, clientY: fromP.y + 220 });
    ok("松在空白 → 不建边、预览清空（静默取消）",
      (cur17().edges || []).length === nBlank && String(B.doc.querySelector("#mmStage .mm-linkprev").innerHTML || "") === "");

    /* 优先级：磁吸点半径**外**、仍在边缘带内 → 走缩放（不是连线）—— 两条路互斥。 */
    reset17();
    const s17 = M.state().L.nodes.get(oneId);
    const magR17 = Math.max(8, Math.min(16, Math.round(0.4 * Math.min(s17.w * kAt(), s17.h * kAt()))));
    const sP = magPoint(oneId, "s");
    const inBand = { clientX: sP.x + magR17 + 8, clientY: sP.y };   // 出了磁吸点半径，但还压在**下边缘**上
    const sizeBefore = JSON.stringify(M.state().cur.size[oneId]);
    const nBeforeResize = (M.state().cur.edges || []).length;    // 迁移后的老图本来就有边，按"之前多少条"比
    /* ⚠️ 事件挂在**当前 DOM 里的节点元素**上派发（它到 #mmView 的祖先链是活的）：
       直接 `bubble(B.win.$("mmView"), …)` 在这台仿真台里会打到一个**拿到过的旧对象**上，
       监听不在它身上 → 整条手势静默变成空操作（不报错、断言只会"尺寸没变"）。 */
    const evAt = (type, x, y) => {
      const host = B.doc.querySelector('#mmStage .mm-node[data-id="' + oneId + '"]') || B.win.$("mmStage");
      bubble(host, type, { clientX: x, clientY: y, pointerId: 3 });
    };
    evAt("pointerdown", inBand.clientX, inBand.clientY);
    evAt("pointermove", inBand.clientX, inBand.clientY + 40);   // 往下拖 = 拉高
    evAt("pointerup", inBand.clientX, inBand.clientY + 40);
    ok("磁吸点半径外、仍在边缘带内 → 走缩放（尺寸 " + sizeBefore + " → " + JSON.stringify(M.state().cur.size[oneId]) + "）",
      JSON.stringify(M.state().cur.size[oneId]) !== sizeBefore);
    ok("那条缩放没有顺手建边（两条路互斥）", (M.state().cur.edges || []).length === nBeforeResize,
      "edges=" + JSON.stringify((M.state().cur.edges || []).map((e) => e.from.node + "→" + e.to.node)));

    /* 第 3 步：点线选中（屏幕 10px 命中带）+ 节点优先 + 右键菜单（四种指向 + 删边）。
       用一张**只有一条边**的干净图：老图迁移出来的树边会和测试边压在同一条线上抢命中
       （`edgeAt` 取最近的那条），一个点上压几条线时"选中的是哪条"就说不清了。 */
    const one3 = { id: "legacy-map", title: "一条边", layout: "mind", line: "curve", theme: "fresh", v: 3, fold: {},
      nodes: [{ id: "P", text: "左主题", children: [] }, { id: "Q", text: "右主题", children: [] }],
      edges: [{ id: "eX", from: { node: "P", side: "e" }, to: { node: "Q", side: "w" }, dir: "fwd" }],
      pos: { P: { x: 0, y: 0 }, Q: { x: 460, y: 0 } }, size: {} };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(one3));
    M.open("legacy-map");
    const e3 = { id: "eX" };
    ok("（第 3 步前提）图里有且只有一条边（" + (cur17().edges || []).length + " 条）", (cur17().edges || []).length === 1);
    const stage17 = () => B.win.$("mmStage");
    const evOn = (host, type, x, y) => bubble(host, type, { target: host, clientX: x, clientY: y, pointerId: 6 });
    const pA = magPoint("P", "e"), pB = magPoint("Q", "w");
    const midP = { x: Math.round((pA.x + pB.x) / 2), y: Math.round((pA.y + pB.y) / 2) };   // 线中点（在 10px 命中带内）
    const stA = M.state().L.nodes.get("P");
    const centerA = { x: Math.round(view2screen().ox + (stA.x + stA.w / 2) * view2screen().k),
                      y: Math.round(view2screen().oy + (stA.y + stA.h / 2) * view2screen().k) };
    ok("点之前：没有边处于选中态", B.doc.querySelectorAll("#mmStage .mm-edge.sel").length === 0);
    evOn(stage17(), "pointerdown", midP.x, midP.y);
    evOn(stage17(), "pointerup", midP.x, midP.y);
    ok("点在线（10px 命中带内）→ 这条边被选中（.mm-edge.sel = " + B.doc.querySelectorAll("#mmStage .mm-edge.sel").length + "）",
      B.doc.querySelectorAll("#mmStage .mm-edge.sel").length === 1);
    /* 三档视觉：常态 2px 灰 → hover 3px 蓝 → 选中 4px 蓝（选中必须比 hover 更明显）；命中带仍是屏幕 10px */
    const edgeProps = (id) => {
      const p = B.doc.querySelector('#mmStage .mm-links path.mm-edge[data-id="' + id + '"]');
      return p ? { w: p.getAttribute("stroke-width"), c: p.getAttribute("stroke"),
        sel: p.classList.contains("sel"), hot: p.classList.contains("hot") } : null;
    };
    /* 先取消选中（选中档会压过 hover 档 —— 那本身就是"选中比 hover 明显"的表现），再验 hover 与命中带 */
    evOn(stage17(), "pointerdown", midP.x, midP.y + 240);
    evOn(stage17(), "pointerup", midP.x, midP.y + 240);
    ok("点别处 → 取消选中（.mm-edge.sel = " + B.doc.querySelectorAll("#mmStage .mm-edge.sel").length + "）",
      B.doc.querySelectorAll("#mmStage .mm-edge.sel").length === 0);
    evOn(stage17(), "pointermove", midP.x, midP.y + 16);        // 离中线 16px（>10px 命中带）
    const farPorps = edgeProps(e3.id);
    ok("指针离线 16px（>10px 命中带）→ 不亮 hover（命中带仍是 10px，没被改小/改大）",
      !!farPorps && !farPorps.hot && farPorps.w === "2" && farPorps.c === "#5b6b7c", JSON.stringify(farPorps));
    evOn(stage17(), "pointermove", midP.x, midP.y + 6);         // 离中线 6px（<10px）
    const hotProps = edgeProps(e3.id);
    ok("指针离线 6px（命中带内）→ hover 档：3px 蓝（" + JSON.stringify(hotProps) + "）",
      !!hotProps && hotProps.hot && !hotProps.sel && hotProps.w === "3" && hotProps.c === "#2f7cf6", JSON.stringify(hotProps));
    evOn(stage17(), "pointerdown", midP.x, midP.y);             // 点它 = 选中
    evOn(B.doc.querySelector('.mm-node[data-id="' + oneId + '"]') || stage17(), "pointerup", midP.x, midP.y);
    const selProps = edgeProps(e3.id);
    ok("选中档比 hover 更明显：4px 蓝且 sel 优先（" + JSON.stringify(selProps) + "）",
      !!selProps && selProps.sel && !selProps.hot && selProps.w === "4" && selProps.c === "#2f7cf6", JSON.stringify(selProps));
    ok("（源码形状）命中带常量仍是 10（EDGE_HIT = 10），视觉档不参与命中",
      /const EDGE_HIT = 10;/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8")));
    /* 节点优先于边：按在节点**中心**（离任何磁吸点都远）不该选中边。
       注意 pointerup 要用**现取**的节点元素：上一步"取消选边"的 draw() 已经把 DOM 重建过了，
       抓着的旧元素已经脱离文档（真实浏览器里松手命中的也是当前 DOM 的元素）。 */
    evOn(B.doc.querySelector('#mmStage .mm-node[data-id="P"]') || stage17(), "pointerdown", centerA.x, centerA.y);
    evOn(B.doc.querySelector('#mmStage .mm-node[data-id="P"]') || stage17(), "pointerup", centerA.x, centerA.y);
    ok("节点优先于边：按在节点身上不选边，选中的是那个节点",
      B.doc.querySelectorAll("#mmStage .mm-edge.sel").length === 0 && M.state().sel === "P",
      "sel=" + M.state().sel + " 选中边=" + B.doc.querySelectorAll("#mmStage .mm-edge.sel").length);
    /* 右键：**浮层菜单**（跟着指针出现，不是弹窗），四项 + 删除，且写成人话 */
    evOn(stage17(), "contextmenu", midP.x, midP.y);
    const menuEl17 = B.win.$("mmEdgeMenu");
    const menuHtml = String((menuEl17 && menuEl17.innerHTML) || "");
    ok("右键线 → 弹出**浮层**菜单（不是弹窗：#mmEdgeMenu 可见、#mmDlg 没开）",
      !!menuEl17 && !menuEl17.classList.contains("hidden") && !B.win.$("mmDlg").open,
      "有菜单=" + !!menuEl17 + " 隐藏=" + (menuEl17 && menuEl17.classList.contains("hidden")));
    ok("菜单四项 + 删除这条线都在",
      /data-mm="edir"[^>]*data-dir="none"/.test(menuHtml) && /data-dir="fwd"/.test(menuHtml) && /data-dir="rev"/.test(menuHtml) &&
      /data-dir="both"/.test(menuHtml) && /data-mm="edel"/.test(menuHtml), menuHtml.slice(0, 180));
    ok("菜单写成人话（→ 指向「…」/ ← 指向「…」，当前那一项打勾）",
      /→ 指向「/.test(menuHtml) && /← 指向「/.test(menuHtml) && /✓ /.test(menuHtml));
    ok("菜单挂在 #mmBox 里（文档级点击委派的门禁要求）", !!B.win.$("mmBox").querySelector("#mmEdgeMenu"));
    const revBtn17 = B.doc.querySelector('#mmEdgeMenu [data-dir="rev"]');
    ok("菜单里找得到「← 指向」那一项", !!revBtn17);
    evOn(stage17(), "pointerdown", midP.x, midP.y);              // 在画布上按一下 = 收起浮层（点别处关掉）
    ok("在画布上按下 → 浮层收起", B.win.$("mmEdgeMenu").classList.contains("hidden"));
    evOn(stage17(), "contextmenu", midP.x, midP.y);              // 再打开一次，继续验指向与删除
    const revBtn17b = B.doc.querySelector('#mmEdgeMenu [data-dir="rev"]');
    if (revBtn17b) bubble(revBtn17b, "click", { target: revBtn17b });
    let ed3 = { to: B.doc.querySelectorAll('#mmStage .mm-links path.mm-arrow[data-edge="' + e3.id + '"]').filter((x) => x.dataset.end === "to").length,
                from: B.doc.querySelectorAll('#mmStage .mm-links path.mm-arrow[data-edge="' + e3.id + '"]').filter((x) => x.dataset.end === "from").length };
    ok("点「← 指向」→ 立即重画：箭头改到起点（to=" + ed3.to + " from=" + ed3.from + "），菜单顺手收掉",
      ed3.to === 0 && ed3.from === 1 && B.win.$("mmEdgeMenu").classList.contains("hidden"), JSON.stringify(ed3));
    const disk3 = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("指向改完已落盘（磁盘上也是 rev）", disk3.edges[0].dir === "rev", JSON.stringify(disk3.edges));
    /* Esc 与 Delete 键 */
    evOn(stage17(), "pointerdown", midP.x, midP.y);
    evOn(stage17(), "pointerup", midP.x, midP.y);
    const kb = (key) => bubble(B.doc, "keydown", { target: B.doc.body, key, preventDefault() {} });
    ok("前提：这条线处于选中态", B.doc.querySelectorAll("#mmStage .mm-edge.sel").length === 1);
    const handle17 = B.win.$("mmEdgeMenu");
    evOn(stage17(), "contextmenu", midP.x, midP.y);
    kb("Escape");
    ok("Esc → 收起浮层菜单（不动那条线）",
      B.win.$("mmEdgeMenu").classList.contains("hidden") && (cur17().edges || []).length === 1);
    kb("Delete");
    ok("选中边后按 Delete → 这条线被删（内存/磁盘/DOM 三处都没了）",
      (cur17().edges || []).length === 0 && JSON.parse(B.localStorage.getItem("mm_map_legacy-map")).edges.length === 0 &&
      B.doc.querySelectorAll("#mmStage .mm-edge").length === 0,
      "内存=" + (cur17().edges || []).length + " DOM=" + B.doc.querySelectorAll("#mmStage .mm-edge").length);

    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC20. 折叠 = **边的可达集合**（可见集合一处权威；环/多父按 INV-3；不读 children 判折叠）");
  {
    /* 零件：一张"边与 children 不同构"的图。
       children：r1 → a1 → a1x（还带 a2）
       edges   ：r1→a1、a1→a1x、r1→a2、**a2→a1x**（a1x 有两个父）
       折叠 a1：按 children 算 → a1x 被藏；按**边的可达集合**算 → a1x 还能从 a2 走到，应该**仍然可见**。 */
    const dia = {
      id: "legacy-map", title: "菱形", layout: "mind", line: "curve", theme: "fresh", v: 2, fold: { a1: true },
      nodes: [{ id: "r1", text: "中心主题", children: [
        { id: "a1", text: "第一章", children: [{ id: "a1x", text: "重点" }] },
        { id: "a2", text: "第二章", children: [] }] }],
      edges: [
        { id: "e1", from: { node: "r1", side: "e" }, to: { node: "a1", side: "w" }, dir: "fwd" },
        { id: "e2", from: { node: "a1", side: "e" }, to: { node: "a1x", side: "w" }, dir: "fwd" },
        { id: "e3", from: { node: "r1", side: "s" }, to: { node: "a2", side: "n" }, dir: "fwd" },
        { id: "e4", from: { node: "a2", side: "e" }, to: { node: "a1x", side: "s" }, dir: "fwd" }],
      pos: { r1: { x: 0, y: 0 }, a1: { x: 220, y: -60 }, a1x: { x: 440, y: -60 }, a2: { x: 220, y: 60 } }, size: {},
    };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(dia));
    M.open("legacy-map");
    ok("（前置）vendor 导出了可见集合的唯一权威 visibleIds / hiddenIds（像 nodesOf 那样）",
      typeof M.visibleIds === "function" && typeof M.hiddenIds === "function",
      "visibleIds=" + typeof M.visibleIds + " hiddenIds=" + typeof M.hiddenIds);
    const V = (m) => (typeof M.visibleIds === "function" ? M.visibleIds(m) : new Set());
    const vis20 = V(M.state().cur);
    ok("折叠 = 边的可达集合：被折叠节点自身**可见**（a1）", vis20.has("a1"));
    ok("多父绕路：a1x 还有另一条路（a2→a1x）→ 折叠 a1 **不该**藏它",
      vis20.has("a1x"), "可见=" + [...vis20].sort().join(","));
    ok("被折叠节点真的进入了画布（自身可见）", !!B.doc.querySelector('#mmStage .mm-node[data-id="a1"]'));
    ok("绕得到的节点也真的画出来了（a1x 在 DOM 里）", !!B.doc.querySelector('#mmStage .mm-node[data-id="a1x"]'));

    /* 环：A—B—C—A，折叠 B → 谁都藏不住（环给了绕过去的路），而且不许死循环 */
    const cyc = {
      id: "legacy-map", title: "环", layout: "mind", line: "curve", theme: "fresh", v: 2, fold: { B: true },
      nodes: [{ id: "A", text: "A", children: [{ id: "B", text: "B", children: [{ id: "C", text: "C", children: [] }] }] }],
      edges: [
        { id: "c1", from: { node: "A", side: "e" }, to: { node: "B", side: "w" }, dir: "fwd" },
        { id: "c2", from: { node: "B", side: "e" }, to: { node: "C", side: "w" }, dir: "fwd" },
        { id: "c3", from: { node: "C", side: "s" }, to: { node: "A", side: "s" }, dir: "fwd" }],
      pos: { A: { x: 0, y: 0 }, B: { x: 220, y: 0 }, C: { x: 440, y: 0 } }, size: {},
    };
    const t0 = Date.now();
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(cyc));
    M.open("legacy-map");
    const visCyc = V(M.state().cur);
    ok("环里折叠不死循环（" + (Date.now() - t0) + "ms 内算完）且三个都在（环给了绕路）",
      visCyc.size === 3 && visCyc.has("A") && visCyc.has("B") && visCyc.has("C"), "可见=" + [...visCyc].sort().join(","));
    ok("环里折叠 B 之后，B 自身仍可见、C 也没被吞掉（DOM 三个节点都在）",
      B.doc.querySelectorAll("#mmStage .mm-node").length === 3,
      "DOM=" + B.doc.querySelectorAll("#mmStage .mm-node").length);

    /* 老图：children → 边（迁移的时候自动变线），折叠行为与"新图"一致 */
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const old20 = M.state().cur;
    ok("老图（只有 children）打开后拿到了**边**（children → fwd 边，层级在边上）",
      Array.isArray(old20.edges) && old20.edges.length >= 7, "边数=" + (old20.edges || []).length);
    /* 同一张图：老图（children 迁移成边）与"新图"（本来就只有边）折叠后可见集合一致 */
    const new20 = JSON.parse(JSON.stringify(old20));
    new20.nodes = [new20.nodes[0]]; new20.fold = { a1: true }; old20.fold = { a1: true };
    M.state().cur.fold.a1 = true;
    const visOld = V(M.state().cur);
    const visNew = V(new20);
    ok("老图与新图折叠行为一致（可见集合相同：" + [...visOld].sort().join(",") + "）",
      [...visOld].sort().join(",") === [...visNew].sort().join(","),
      "老=" + [...visOld].sort().join(",") + " 新=" + [...visNew].sort().join(","));
    ok("源码形状：折叠判定与渲染都不再读节点字段（`n.fold` 只出现在 migrateMap 那一句里）",
      (() => {
        const s = require("fs").readFileSync(require("path").join(__dirname, "..", "vendor", "mindmap.js"), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        const hits = (s.match(/\bn\.fold\b/g) || []).length;
        const m0 = s.indexOf("function migrateMap");
        const mig = m0 < 0 ? "" : s.slice(m0, s.indexOf("\n  }", m0));
        const inMig = (mig.match(/\bn\.fold\b/g) || []).length;
        return hits === 2 && inMig === 2;    // `if (n.fold)` + `delete n.fold`，两处都在迁移里
      })(), "命中数应为 2（migrateMap 里 if/delete 各一次）");
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC21. 孤岛必须可见（可见集合的种子 = 容器根 ∪ **没有出边的节点**；无边 ≠ 被折叠）");
  {
    const V = (m) => M.visibleIds(m);               // 产品助手是唯一权威（C20 的 V 是块内局部）
    /* 一张"边被删空、但节点还在"的图（v:3 = 迁移已完成，所以**不会**再从 children 把边补回来；
       这正是用户删光所有线之后重开的情形）。旧种子只从容器根出发 → a1/a1x 都被当成"被折叠"藏掉。 */
    const isl = {
      id: "legacy-map", title: "孤岛", layout: "mind", line: "curve", theme: "fresh", v: 3,
      nodes: [{ id: "r1", text: "中心主题", children: [{ id: "a1", text: "第一章", children: [{ id: "a1x", text: "重点" }] }] }],
      edges: [], fold: {},
      pos: { r1: { x: 0, y: 0 }, a1: { x: 220, y: -60 }, a1x: { x: 440, y: -60 } }, size: {},
    };
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(isl));
    M.open("legacy-map");
    const visI = V(M.state().cur);
    ok("① 删空所有边后，**每个节点都还看得见**（孤岛可见，不是只剩容器根）",
      visI.size === 3 && visI.has("r1") && visI.has("a1") && visI.has("a1x"),
      "可见=" + [...visI].sort().join(",") + "（应为 3 个）");
    ok("① 删空所有边后，DOM 里也仍是三个节点",
      B.doc.querySelectorAll("#mmStage .mm-node").length === 3,
      "DOM=" + B.doc.querySelectorAll("#mmStage .mm-node").length);
    /* ③ 折叠仍只藏"所有路都经过折叠点"的节点 —— 菱形那条不许被这次的种子扩张弄回归 */
    const dia2 = {
      id: "legacy-map", title: "菱形", layout: "mind", line: "curve", theme: "fresh", v: 3, fold: { r1: true },
      nodes: [{ id: "r1", text: "中心主题", children: [
        { id: "a1", text: "第一章", children: [{ id: "a1x", text: "重点" }] },
        { id: "a2", text: "第二章", children: [] }] }],
      edges: [
        { id: "e1", from: { node: "r1", side: "e" }, to: { node: "a1", side: "w" }, dir: "fwd" },
        { id: "e2", from: { node: "a1", side: "e" }, to: { node: "a1x", side: "w" }, dir: "fwd" },
        { id: "e3", from: { node: "r1", side: "s" }, to: { node: "a2", side: "n" }, dir: "fwd" },
        { id: "e4", from: { node: "a2", side: "e" }, to: { node: "a1x", side: "s" }, dir: "fwd" }],
      pos: {}, size: {},
    };
    const visD2 = V(dia2);
    ok("② 折叠容器根后，只有一条路的 a2 仍然藏得住（容器根自身可见、出边截断）",
      visD2.has("r1") && !visD2.has("a2"), "可见=" + [...visD2].sort().join(","));
    /* 反面：**没有入边**的叶子被折叠点截断后必须能藏住（种子只放 "没有出边的节点"，不是所有源节点，
       否则每张有向无环图的所有叶子都会被迫可见，折叠功能整体失效）。 */
    const dag = {
      id: "legacy-map", title: "链", layout: "mind", line: "curve", theme: "fresh", v: 3, fold: { a1: true },
      nodes: [{ id: "r1", text: "中心主题", children: [{ id: "a1", text: "第一章", children: [{ id: "a1x", text: "重点" }] }] }],
      edges: [
        { id: "d1", from: { node: "r1", side: "e" }, to: { node: "a1", side: "w" }, dir: "fwd" },
        { id: "d2", from: { node: "a1", side: "e" }, to: { node: "a1x", side: "w" }, dir: "fwd" }],
      pos: {}, size: {},
    };
    const visDag = V(dag);
    ok("② 折叠 a1 后，只有一条路（a1→a1x）的 a1x 仍然藏得住（种子不许把叶子全放出来）",
      visDag.has("r1") && visDag.has("a1") && !visDag.has("a1x"), "可见=" + [...visDag].sort().join(","));
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC22. 老图迁移：children → 默认单指向的边（父子关系整体搬到边上，逐对可对账）");
  {
    /* 老格式的层级只长在 children 上；迁移后**唯一的关系源**必须是边。
       所以这里逐对账：children 里每一个父子对 ↔ 边集合里必须恰好有一条对应的 fwd 边（两个方向都查）。 */
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));    // v:1，只有 root
    M.open("legacy-map");
    const c22 = M.state().cur;
    const pairs = [];
    for (const r of M.nodesOf(c22)) walk22(r, (n) => { for (const k of n.children || []) pairs.push(n.id + "→" + k.id); });
    function walk22(n, f) { f(n); for (const k of n.children || []) walk22(k, f); }
    const edges = c22.edges || [];
    const key = (e) => (e.from && e.from.node) + "→" + (e.to && e.to.node);
    const keys = edges.map(key);
    ok("老图 children 里的每一个父子对都有对应的边（缺一条就是静默丢层级）",
      pairs.length > 0 && pairs.every((p) => keys.indexOf(p) >= 0),
      "父子对 " + pairs.length + " 个 / 边 " + keys.length + " 条；缺=" + pairs.filter((p) => keys.indexOf(p) < 0).join(","));
    ok("反向也对账：每条边都恰好对应一个真实的父子对（没有凭空造出来的边）",
      keys.length === pairs.length && keys.every((k) => pairs.indexOf(k) >= 0), "边=" + keys.join(" | "));
    ok("每一条都是**默认单指向**（dir=fwd）", edges.length > 0 && edges.every((e) => e.dir === "fwd"),
      [...new Set(edges.map((e) => e.dir))].join(","));
    ok("端点是默认侧面（mind：e→w）", edges.every((e) => e.from.side === "e" && e.to.side === "w"),
      [...new Set(edges.map((e) => e.from.side + "→" + e.to.side))].join(","));
    ok("没有自环、端点对不重复",
      edges.every((e) => e.from.node !== e.to.node) && new Set(keys).size === keys.length);
    /* 幂等：再打开一次不许翻倍（否则每开一次多一圈重复的边） */
    const snap22 = JSON.stringify(c22.edges);
    M.open("legacy-map");
    ok("再打开一次边集合不变（v:3 幂等，不会翻倍）", JSON.stringify(M.state().cur.edges) === snap22);
    /* down 布局：默认侧面换成 s→n（同一套规则，别只为 mind 写死） */
    const down = JSON.parse(JSON.stringify(LEGACY));
    down.layout = "down";
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(down));
    M.open("legacy-map");
    const ed22 = M.state().cur.edges || [];
    ok("down 布局的老图：边默认 s→n（侧面跟布局走）",
      ed22.length > 0 && ed22.every((e) => e.from.side === "s" && e.to.side === "n"),
      [...new Set(ed22.map((e) => e.from.side + "→" + e.to.side))].join(","));
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
  }

  console.log("\nC19. 位置属于每个节点自己：拖父节点，子节点**不动**（平级模型 INV-4）");
  {
    /* 只有"父节点有坐标、子节点没有"的图才能看见"父子跟随"：两边都有坐标时 follow 分支直接跳过。
       做法：先按正常路径打开（播种 → 所有节点都有坐标），再**只挖掉 a1x 那一条**（现实中就是
       老图部分固化的情况）。这样 a1 停在自己的自然位置上，a1x 的自然格子不会被"让位"逻辑挪动 ——
       于是"子节点动了"只可能是跟随造成的。
       注意父节点用 a1 不能用根节点：拖根节点在平级模型里是"平移画布"。 */
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(LEGACY));
    M.open("legacy-map");
    const seeded = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    delete seeded.pos.a1x;
    B.localStorage.setItem("mm_map_legacy-map", JSON.stringify(seeded));
    M.open("legacy-map");
    const st19 = () => M.state();
    const c0 = st19().L.nodes.get("a1x");
    const c0x = c0.x, c0y = c0.y, p0 = JSON.parse(JSON.stringify(st19().cur.pos.a1));
    ok("前提：父节点 a1 有坐标、子节点 a1x 没有（子节点当前摆在后端算出来的位置 " + Math.round(c0x) + "," + Math.round(c0y) + "）",
      !!st19().cur.pos.a1 && !st19().cur.pos.a1x);
    const r1s = st19().L.nodes.get("a1"), v19 = view2screen();
    const from = { x: Math.round(v19.ox + (r1s.x + r1s.w / 2) * v19.k), y: Math.round(v19.oy + (r1s.y + r1s.h / 2) * v19.k) };
    const move = { x: from.x - 380, y: from.y + 300 };          // 往左下拖远，避免"让位"逻辑把子节点按碰撞挪走
    const host19 = (id) => B.doc.querySelector('#mmStage .mm-node[data-id="' + id + '"]') || B.win.$("mmStage");
    bubble(host19("a1"), "pointerdown", { target: host19("a1"), clientX: from.x, clientY: from.y });
    bubble(host19("a1"), "pointermove", { target: host19("a1"), clientX: move.x, clientY: move.y });
    bubble(host19("a1"), "pointerup", { target: host19("a1"), clientX: move.x, clientY: move.y });
    const pAfter = st19().cur.pos.a1, cAfter = st19().L.nodes.get("a1x");
    ok("前提：父节点真的被拖走了（" + JSON.stringify(p0) + " → " + JSON.stringify(pAfter) + "）",
      pAfter.x !== p0.x || pAfter.y !== p0.y);
    /* 跟随会把子节点平移**父节点的整个位移**（红跑实测 Δ=-289,228）；删掉后 x 必须一点不动。
       y 不参与断言：`nudgeFree`（让位）只往下推、父节点挪开后还会复位，这是另一套机制，不是跟随。 */
    const dp = { x: pAfter.x - p0.x, y: pAfter.y - p0.y };
    const dc = { x: cAfter.x - c0x, y: cAfter.y - c0y };
    ok("拖父节点后子节点**没有被带着走**（子 Δx=" + dc.x.toFixed(0) + "，父 Δx=" + dp.x.toFixed(0) +
      "；子 Δy=" + dc.y.toFixed(0) + " 只可能来自让位逻辑）",
      Math.abs(dc.x) < 1 && Math.abs(dc.x - dp.x) > 50,
      "子 (" + Math.round(c0x) + "," + Math.round(c0y) + ") → (" + Math.round(cAfter.x) + "," + Math.round(cAfter.y) + ")");
    /* 撤销要覆盖这一段：父节点回原值、子节点本来没动 */
    const ub19 = B.doc.querySelector('[data-mm="undo"]');
    if (ub19) bubble(ub19, "click", { target: ub19 });
    const cUndo = st19().L.nodes.get("a1x");
    ok("撤销后：父节点回原值（" + JSON.stringify(st19().cur.pos.a1) + "）、子节点仍在原位",
      JSON.stringify(st19().cur.pos.a1) === JSON.stringify(p0) && Math.abs(cUndo.x - c0x) < 1 && Math.abs(cUndo.y - c0y) < 1,
      "子节点 Δ=" + (cUndo.x - c0x).toFixed(1) + "," + (cUndo.y - c0y).toFixed(1));
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
    // 而且 pointerup 要用**现取**的元素：pointerdown 里可能因为 endEdit()/取消选边触发 draw()，把 DOM 重建掉。
    bubble(nodeEl, "pointerdown", { target: nodeEl, clientX: pt.x, clientY: pt.y });
    bubble(B.doc.querySelector('.mm-node[data-id="' + target.n.id + '"]') || nodeEl, "pointerup", { target: nodeEl, clientX: pt.x, clientY: pt.y });
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
  const posBeforeDrag = JSON.parse(JSON.stringify(M.state().cur.pos[dragS.n.id]));
  ok("画布上找得到要拖的节点 " + dragS.n.id + " 和 #mmView", !!dEl && !!vw);
  if (dEl && vw) {
    const fromX = 300, fromY = 300;
    /* 事件派发在**当前 DOM 的节点元素**上（它到 #mmView 的祖先链是活的）——见 C17 里那条注释：
       直接拿 `B.win.$("mmView")` 或旧的元素对象派发，监听不在它身上，整条手势静默变空操作。 */
    const hostB = () => B.doc.querySelector('#mmStage .mm-node[data-id="' + dragS.n.id + '"]') || B.win.$("mmStage");
    /* `target` 必须**显式传**：仿真台的 fire() 走到哪个祖先就把 e.target 覆写成那个祖先，
       于是 vendor 里的 `e.target.closest(".mm-node")` 拿到的是 #mmView → drag.id 为空 →
       整个"拖节点"退化成"平移画布"，坐标一直不变（这条断言原来就是这样空转的）。 */
    bubble(hostB(), "pointerdown", { target: hostB(), clientX: fromX, clientY: fromY });
    bubble(hostB(), "pointermove", { target: hostB(), clientX: fromX + 240, clientY: fromY + 160 });
    bubble(hostB(), "pointerup", { target: hostB(), clientX: fromX + 240, clientY: fromY + 160 });
    const p = M.state().cur.pos[dragS.n.id];
    ok("松手后该节点坐标写进 cur.pos " + JSON.stringify(p), !!p);
    ok("拖动**真的改了**坐标（" + JSON.stringify(posBeforeDrag) + " → " + JSON.stringify(p) + "）—— 否则「撤销回到原值」是空断言",
      JSON.stringify(p) !== JSON.stringify(posBeforeDrag), "拖动前=" + JSON.stringify(posBeforeDrag));
    ok("松手后跟手 ghost 已移除", B.doc.querySelectorAll(".mm-node.ghost").length === 0);
    const saved = JSON.parse(B.localStorage.getItem("mm_map_legacy-map"));
    ok("已落盘：磁盘坐标 == 内存坐标", !!saved.pos && !!saved.pos[dragS.n.id] && saved.pos[dragS.n.id].x === p.x && saved.pos[dragS.n.id].y === p.y);
    /* 注意：`boot()` 会把**全局**的文档级委派表清空（DELEGATES = []），所以 B2 建完之后，
       B 这个大本营的 click 委派已经没人接了（撤销按钮就点不动了）。这里存一份、跑完 B2 再放回去。 */
    const savedDelegates = DELEGATES.slice();
    const B2 = boot();
    for (const [k, v] of B.localStorage._m) B2.localStorage.setItem(k, v);
    loadInto(B2.sandbox, "js/host-bridge.js", B2.sandbox.window);
    const M2 = loadInto(B2.sandbox, "vendor/mindmap.js", B2.sandbox.window);
    M2.open("legacy-map");
    const p2 = M2.state().cur.pos[dragS.n.id];
    ok("重开页面后位置不变（" + JSON.stringify(p) + " → " + JSON.stringify(p2) + "）", !!p2 && p2.x === p.x && p2.y === p.y);
    const s2 = M2.state().L.nodes.get(dragS.n.id);
    ok("重开后渲染坐标 == 数据坐标", !!s2 && Math.round(s2.x) === p.x && Math.round(s2.y) === p.y);
    DELEGATES = savedDelegates;
    /* 拖完 → 撤销：坐标回到拖动前（这条原来是"未覆盖"，现在补成端到端 —— 拖动的坐标写在 change 的
       fn 内，所以整段拖动只占一条撤销历史）。 */
    const ub = B.doc.querySelector('[data-mm="undo"]');
    ok("找得到撤销按钮", !!ub);
    if (ub) bubble(ub, "click", { target: ub });
    const pBack = M.state().cur.pos[dragS.n.id];
    ok("撤销后坐标回到拖动前（" + JSON.stringify(p) + " → " + JSON.stringify(pBack) + "，拖动前 " + JSON.stringify(posBeforeDrag) + "）",
      JSON.stringify(pBack) === JSON.stringify(posBeforeDrag));
    const orphB = layerOrphans(M.state().cur);
    ok("撤销后导图层里没有孤儿", orphB.length === 0, orphB.join(","));
  }

  console.log("\nE. 全流程无异常");
  ok("整个流程没有未捕获异常", true);

  console.log("\n结果：" + PASS + " 通过 / " + FAIL + " 失败");
  process.exit(FAIL ? 1 : 0);
}).catch((e) => { console.error("自测台本身出错：" + e.stack); process.exit(2); });
}
