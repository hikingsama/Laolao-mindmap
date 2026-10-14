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
  document.addEventListener("DOMContentLoaded", function () {
    const button = document.getElementById("mmShortcutsButton"), sidebar = document.getElementById("mmShortcuts"), close = document.getElementById("mmShortcutsClose"), body = document.getElementById("mmShortcutsBody");
    if (!button || !sidebar || !window.MMContent) return;
    const esc = window.MMContent.escape;
    body.innerHTML = `<p class="mm-shortcuts-intro">双击节点，在 <code>$…$</code> 或 <code>$$…$$</code> 数学区域内输入命令，再按 <kbd>Tab</kbd> 补全。</p>
      <input id="mmSnippetSearch" class="mm-snippet-search" type="search" placeholder="搜索：积分、int、矩阵…" aria-label="搜索补全命令">
      <div id="mmSnippetResults"></div>
      <p class="mm-shortcuts-note"><code>□</code> 是独立填空位置。填好后按 <kbd>Tab</kbd> 前进，<kbd>Shift+Tab</kbd> 返回；编辑框下方会提示当前填写项。全部填好后 Tab 移到模板末尾。在函数区域内还能嵌套 <code>frac</code> 或 <code>sqrt</code> 补全。普通文字和代码块不触发补全。</p>
      <h3>编辑快捷键</h3><dl class="mm-shortcuts-keys"><dt>双击节点</dt><dd>打开源码编辑与预览</dd><dt><kbd>Enter</kbd></dt><dd>换行</dd><dt><kbd>Ctrl / Cmd + Enter</kbd></dt><dd>保存</dd><dt><kbd>Esc</kbd></dt><dd>取消本次修改</dd><dt><kbd>Tab</kbd></dt><dd>补全 / 下一填空；其他位置插入两个空格</dd><dt><kbd>Shift+Tab</kbd></dt><dd>上一填空</dd></dl>
      <h3>公式写法</h3><dl class="mm-shortcuts-keys"><dt><code>$x^2$</code></dt><dd>行内公式</dd><dt><code>$$x^2$$</code></dt><dd>独立公式，可写多行</dd><dt><code>\\(x^2\\)</code></dt><dd>行内公式的另一种写法</dd><dt><code>\\[x^2\\]</code></dt><dd>独立公式的另一种写法</dd></dl>`;
    const search = document.getElementById("mmSnippetSearch"), results = document.getElementById("mmSnippetResults");
    function renderCommands() {
      const query = search.value.trim().toLowerCase();
      const rows = window.MMContent.snippetHelp.filter(row => [row.trigger,row.label,row.group,...row.fields].join(" ").toLowerCase().includes(query));
      const groups = [...new Set(rows.map(row => row.group))];
      results.innerHTML = `<p class="mm-snippet-count">${rows.length} 个补全命令</p>` + groups.map(group => `<h3>${esc(group)}</h3><table class="mm-shortcuts-table"><thead><tr><th scope="col">输入 + Tab</th><th scope="col">展开结果 / 填写顺序</th></tr></thead><tbody>${rows.filter(row => row.group === group).map(row => `<tr><td><code>${esc(row.trigger)}</code><small>${esc(row.label)}</small></td><td><code>${esc(row.replacement)}</code><small class="mm-snippet-fields">${row.fields.length ? row.fields.map((name,i) => `${i+1}. ${esc(name)}`).join(" → ") : "直接插入，无填空"}</small></td></tr>`).join("")}</tbody></table>`).join("") + (rows.length ? "" : `<p>没有找到，试试“极限”或“矩阵”。</p>`);
    }
    search.addEventListener("input", renderCommands); renderCommands();
    function toggle(on) {
      if (on) window.MMAI?.close();
      sidebar.classList.toggle("hidden", !on); document.body.classList.toggle("mm-shortcuts-open", on);
      button.setAttribute("aria-expanded", String(on)); window.dispatchEvent(new Event("resize"));
      if (!on && document.activeElement.closest("#mmShortcuts")) { const editor=document.querySelector('.mm-edit'); if(editor)editor.focus();else button.focus(); }
    }
    // Opening the reference should preserve the active node editor and its caret.
    button.addEventListener("pointerdown", event => event.preventDefault());
    close.addEventListener("pointerdown", event => event.preventDefault());
    button.addEventListener("click", () => toggle(sidebar.classList.contains("hidden")));
    close.addEventListener("click", () => toggle(false));
    window.addEventListener("mm:close-shortcuts", () => toggle(false));
    sidebar.addEventListener("pointerdown", event => { if (!event.target.closest("button,input")) event.preventDefault(); });
    sidebar.addEventListener("keydown", event => { if(event.key === "Escape") {event.stopPropagation();toggle(false);const editor=document.querySelector('.mm-edit');if(editor)editor.focus();else button.focus();} });
  });
  // 原代码 renderEditor() 内部也会设高度，这里补一刀防止窗口尺寸变化后不齐
  setInterval(fitBox, 1000);
})();
