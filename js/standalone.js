/* =========================================================================
 * standalone.js —— 独立仓库自己的启动逻辑
 * 目前只做两件事：
 *   1) 修正 #mmBox 的高度（原代码靠宿主页面算，这里自己算）
 *   2) 第一版明确不做"自动布局开关 / 一键整理"，这里留个空位给以后
 * 真正的坐标逻辑在 vendor/mindmap.js 里（见该文件顶部"独立版改动"注释）。
 * ========================================================================= */
(function () {
  "use strict";
  function fitBox() {
    var box = document.getElementById("mmBox");
    if (!box) return;
    if (!box.classList.contains("edit")) { box.style.height = ""; return; }
    var top = box.getBoundingClientRect().top;
    box.style.height = Math.max(380, window.innerHeight - top - 12) + "px";
  }
  window.addEventListener("resize", fitBox);
  window.addEventListener("mm:open", fitBox);
  document.addEventListener("DOMContentLoaded", fitBox);
  // 原代码 renderEditor() 内部也会设高度，这里补一刀防止窗口尺寸变化后不齐
  setInterval(fitBox, 1000);
})();
