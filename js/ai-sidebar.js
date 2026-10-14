(() => {
  "use strict";
  const sidebar = document.createElement("aside"); sidebar.id = "mmAI"; sidebar.className = "mm-ai hidden"; sidebar.setAttribute("aria-label", "节点 AI 对话");
  sidebar.innerHTML = `<div class="mm-ai-heading"><b>✦ 节点提问</b><button class="mm-b" id="mmAIClose" aria-label="关闭 AI 对话">✕</button></div><div id="mmAIContext"></div><div id="mmAIMessages" role="log" aria-live="polite"></div><form id="mmAIForm"><textarea id="mmAIInput" rows="3" placeholder="针对这个节点提问…" aria-label="向 AI 提问" maxlength="10000"></textarea><div class="mm-ai-send"><span id="mmAIStatus">AI 模型尚未接入</span><button class="mm-b" id="mmAIStop" type="button" hidden>停止</button><button class="mm-b" id="mmAISend" type="submit">发送</button></div></form>`;
  document.body.appendChild(sidebar);
  const $ = id => document.getElementById(id), esc = window.MMContent.escape;
  let target = null, messages = [], pending = null;
  const key = () => `mm_ai_v1_${target.map}_${target.node}`;
  function draft(text) { try { localStorage.setItem(key()+"_draft",text); } catch {} }
  function save() { try { localStorage.setItem(key(), JSON.stringify(messages.slice(-40))); } catch {} }
  function context() {
    const state = window.Mindmap.state(), map = state.cur;
    if (!map || map.id !== target.map) throw new Error("当前导图已切换，请在当前节点右键重新提问。");
    const node = window.Mindmap.findNode(target.node)?.n;
    if (!node) throw new Error("这个节点已删除，请重新选择节点。");
    const edges = (map.edges || []).filter(e => e.from.node === node.id || e.to.node === node.id);
    const ids = new Set(edges.flatMap(e => [e.from.node, e.to.node])); ids.delete(node.id);
    return { map: map.title, node: { id: node.id, text: node.text.slice(0,12000) }, neighbors: [...ids].slice(0,8).map(id => ({ id, text: (window.Mindmap.findNode(id)?.n.text || "").slice(0,2000) })), edges };
  }
  function render() {
    $("mmAIMessages").innerHTML = messages.length ? messages.map((m,i) => `<article class="mm-ai-message ${m.role}"><small>${m.role === "user" ? "你" : "AI"}</small><div class="mm-rich">${window.MMContent.render(m.content)}</div>${m.role === "assistant" ? `${m.summary ? `<section class="mm-ai-summary"><small>节点总结 · ${Array.from(summaryText(m,i)).length} 字符（含公式源码，仅供参考）</small><div class="mm-rich">${window.MMContent.render(summaryText(m,i))}</div><p>对当前的总结内容大体满意吗？满意的话，点击“推送”按钮将内容推送到节点上；不满意的话，继续发送提问。</p></section>` : ""}<div class="mm-ai-actions"><button class="mm-b" data-ai="${m.summary ? "push" : "modify"}" data-index="${i}" ${m.pushed && window.Mindmap.findNode(m.pushed) ? "disabled" : ""}>${m.pushed && window.Mindmap.findNode(m.pushed) ? "已推送" : m.summary ? "推送" : "修改思维导图"}</button><button class="mm-b" data-ai="refresh">刷新画布渲染</button></div>` : ""}</article>`).join("") : `<p class="mm-ai-empty">节点内容会随问题一起发送。回答支持 Markdown 和 LaTeX 公式。</p>`;
    $("mmAIMessages").scrollTop = $("mmAIMessages").scrollHeight;
  }
  function close() { sidebar.classList.add("hidden"); document.body.classList.remove("mm-ai-open"); window.dispatchEvent(new Event("resize")); }
  function busy(on) { $("mmAISend").disabled = on; $("mmAIStop").hidden = !on; $("mmAIInput").disabled = on; }
  const networkError = () => new Error("连接本地 AI 服务失败。请确认服务正在运行，并从 http://127.0.0.1:8788/ 打开页面后重试。");
  async function request(url, options) {
    let response;
    try { response = await fetch(url, options); }
    catch(error) { if(error.name === "AbortError") throw error; throw networkError(); }
    let data; try { data = await response.json(); } catch { throw new Error("AI 接口返回异常，请重启本地服务并刷新页面。"); }
    if(!response.ok) throw new Error(data.error || "AI 请求失败");
    return data;
  }
  function delay(signal) {
    return new Promise((resolve,reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("已停止", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort",abort); resolve(); }, 1000);
      signal.addEventListener("abort",abort,{once:true}); if(signal.aborted) abort();
    });
  }
  function turnOf(m,i) { return m.turn || messages.slice(0,i+1).filter(x => x.role === "assistant").length; }
  function summaryText(m,i) { return `# 第${turnOf(m,i)}次提问：${m.summary.title}\n\n${m.summary.text}`; }
  async function runAI(payload,controller,label) {
    let job = null;
    try {
      let data = await request("/api/ai/chat", {method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify(payload)});
      if(data.job) {
        job = data.job; const started = Date.now(); let retries = 0;
        while(data.status === "running") {
          if(Date.now()-started > 270000) throw new Error("AI 回答等待超时，请稍后重试。");
          if(pending === controller) $("mmAIStatus").textContent = `问题已送达 · ${label}（${Math.floor((Date.now()-started)/1000)} 秒）`;
          await delay(controller.signal);
          try { data = await request(`/api/ai/jobs/${encodeURIComponent(job)}`, {signal:controller.signal}); retries = 0; }
          catch(error) { if(error.name === "AbortError" || ++retries >= 3 || !error.message.startsWith("连接本地")) throw error; }
        }
        if(data.status !== "completed") throw new Error(data.error || "对话已停止，请重试。");
      }
      return data;
    } finally { if(job) fetch(`/api/ai/jobs/${encodeURIComponent(job)}`,{method:"DELETE"}).catch(()=>{}); }
  }
  function open(id) {
    if (pending) { if(pending.kind === "chat") messages.pop(); pending.abort(); pending = null; save(); busy(false); }
    target = { map: window.Mindmap.state().cur.id, node: id };
    try { $("mmAIInput").value = localStorage.getItem(key()+"_draft") || ""; } catch { $("mmAIInput").value = ""; }
    try { messages = JSON.parse(localStorage.getItem(key()) || "[]").filter(m => ["user","assistant"].includes(m.role) && typeof m.content === "string"); } catch { messages = []; }
    window.dispatchEvent(new Event("mm:close-shortcuts")); sidebar.classList.remove("hidden"); document.body.classList.add("mm-ai-open");
    $("mmAIContext").textContent = "当前节点：" + (context().node.text.replace(/\s+/g," ").slice(0,100) || "空白节点");
    $("mmAIStatus").textContent = "AI 模型尚未接入"; render(); window.dispatchEvent(new Event("resize")); $("mmAIInput").focus();
  }
  $("mmAIClose").onclick = close;
  $("mmAIStop").onclick = () => pending?.abort();
  $("mmAIInput").addEventListener("input", () => { if(target) draft($("mmAIInput").value); });
  sidebar.addEventListener("keydown", e => { if(e.key === "Escape") { e.stopPropagation(); close(); } });
  $("mmAIInput").addEventListener("keydown", e => { if(e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("mmAIForm").requestSubmit(); } });
  $("mmAIForm").addEventListener("submit", async e => {
    e.preventDefault(); const input = $("mmAIInput"), text = input.value.trim(); if(!text || pending) return;
    let ctx; try { ctx = context(); } catch(error) { $("mmAIStatus").textContent = error.message; return; }
    draft(text);
    const controller = new AbortController(); controller.kind = "chat"; pending = controller; busy(true);
    messages.push({ role: "user", content: text }); save(); render(); input.value = ""; $("mmAIStatus").textContent = "AI 正在思考…";
    try {
      const data = await runAI({context:ctx,messages:messages.slice(-20).map(m=>({role:m.role,content:m.content}))},controller,"AI 正在回答");
      if(typeof data.reply !== "string") throw new Error("AI 返回无效回答");
      if(pending !== controller) return;
      const turn = Math.max(0,...messages.map((m,i)=>m.role === "assistant" ? turnOf(m,i) : 0))+1;
      messages.push({ role: "assistant", content: data.reply, turn }); draft(""); save(); render(); $("mmAIStatus").textContent = "回答完成";
    } catch(error) { if(pending === controller) { $("mmAIStatus").textContent = error.name === "AbortError" ? "已停止，可重新发送" : error.message; input.value = text; messages.pop(); save(); render(); } }
    finally {
      if(pending === controller) { pending = null; busy(false); if(!sidebar.classList.contains("hidden")) input.focus(); }
    }
  });
  sidebar.addEventListener("click", async e => {
    const button = e.target.closest("[data-ai]"); if(!button) return;
    try { context(); } catch(error) { $("mmAIStatus").textContent = error.message; return; }
    if(button.dataset.ai === "refresh") { window.Mindmap.refresh(); $("mmAIStatus").textContent = "画布已重新渲染"; }
    else if(!pending) {
      const i = Number(button.dataset.index), message = messages[i]; if(!message || message.role !== "assistant") return;
      if(button.dataset.ai === "push") {
        try { message.pushed = window.Mindmap.pushAISummary(target.map,target.node,summaryText(message,i)); save(); render(); $("mmAIStatus").textContent = "总结已推送，新节点指向提问节点。"; }
        catch(error) { $("mmAIStatus").textContent = error.message; }
        return;
      }
      const controller = new AbortController(); controller.kind = "summary"; pending = controller; busy(true); button.disabled = true; button.textContent = "正在总结…";
      try {
        const data = await runAI({mode:"summary",context:context(),messages:messages.slice(0,i+1).slice(-20).map(m=>({role:m.role,content:m.content}))},controller,"正在生成总结");
        if(pending !== controller) return;
        const summary = window.MMAISummary.normalizeSummary(data.summary);
        message.summary = summary;
        save(); render(); $("mmAIStatus").textContent = "总结已生成，请确认后推送，或继续提问。";
      } catch(error) { if(pending === controller) { $("mmAIStatus").textContent = error.name === "AbortError" ? "已停止总结，可重试" : error.message; render(); } }
      finally { if(pending === controller) { pending = null; busy(false); } }
    }
  });
  window.MMAI = { open, close };
})();
