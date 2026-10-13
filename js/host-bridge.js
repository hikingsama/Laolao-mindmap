/* =========================================================================
 * host-bridge.js —— 宿主兼容桩（第一块地基）
 *
 * 原 mindmap.js 文件头声明依赖 app.js 的 11 个宿主函数：
 *   $ esc load save showView showBanner currentUser Sync CCAuth isMobile
 * 本仓库是独立仓库，这些函数在浏览器里全都不存在。
 * 这个文件在 vendor/mindmap.js **之前**加载，负责把它们补齐。
 *
 * 另外还有两个原文件实际用到、但文件头没写的依赖，这里也一并补上：
 *   · currentView()  —— 键盘 / 渲染路径守卫，必须返回 "mindmap"（共 7 个调用点）
 *   · window.mmLeave() / ResizeObserver 观察 #banner —— 需要存在对应元素
 *
 * 云同步（CCAuth / mm_save / Sync）是第一版明确排除项，全部打桩：
 * currentUser 恒为 null，于是代码自动走"只存在这台设备"的本地分支。
 * ========================================================================= */
(function () {
  "use strict";

  var VIEW = "mindmap";

  /* ---------- DOM ---------- */
  window.$ = function $(id) { return document.getElementById(id); };

  window.esc = function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  window.currentView = function currentView() { return VIEW; };

  /* ---------- 设备判断 ---------- */
  window.isMobile = function isMobile() {
    if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) return true;
    return window.innerWidth <= 720;
  };

  /* ---------- 本地存储 ----------
   * 原代码自己用 localStorage 存导图正文（mm_map_<id>、mm_index_v1…），
   * 这两个函数是给宿主用的键值存储（mm_last_v1、mm_rev_v1），保持同样的落点。 */
  window.load = function load(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  window.save = function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  };

  /* ---------- 顶部提示条 ---------- */
  window.showBanner = function showBanner(msg) {
    var el = document.getElementById("banner");
    if (!el) return;
    el.textContent = msg || "";
    el.className = msg ? "on" : "";
  };

  /* ---------- 没有"工具页"这个宿主，退回来就回列表 ---------- */
  window.showView = function showView(_name) {
    if (typeof window.renderMindmap === "function") window.renderMindmap();
  };

  /* ---------- 云同步：第一版全桩 ---------- */
  window.currentUser = null;                 // 恒未登录 → 代码走纯本地分支
  window.CCAuth = {
    rpc: function () { return Promise.reject(new Error("这个独立仓库没有云同步（第一版已剥离）")); }
  };
  window.Sync = { onChange: function () { return function () {}; } };

  /* ---------- 触发首屏 ---------- */
  window.addEventListener("DOMContentLoaded", function () {
    if (typeof window.renderMindmap === "function") window.renderMindmap();
  });
})();
