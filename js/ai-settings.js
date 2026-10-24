(() => {
  "use strict";
  const button = document.getElementById("mmAPISettingsButton");
  if (!button) return;

  // Keys are sent to the local service only; saved keys are never returned to this page.
  const providers = {
    deepseek: { name: "DeepSeek", url: "https://api.deepseek.com" },
    glm: { name: "智谱 GLM", url: "https://open.bigmodel.cn/api/paas/v4" },
    kimi: { name: "Kimi", url: "https://api.moonshot.cn/v1" },
    custom: { name: "自定义兼容服务", url: "" }
  };
  const dialog = document.createElement("dialog");
  dialog.id = "mmAPISettingsDialog";
  dialog.className = "mm-api-dialog";
  dialog.setAttribute("aria-labelledby", "mmAPISettingsTitle");
  dialog.setAttribute("aria-describedby", "mmAPISettingsNotice");
  dialog.innerHTML = `
    <form id="mmAPISettingsForm" autocomplete="off">
      <div class="mm-api-heading">
        <h2 id="mmAPISettingsTitle">大模型 API 接入</h2>
        <button class="mm-b ic" id="mmAPISettingsClose" type="button" aria-label="关闭大模型 API 接入">✕</button>
      </div>
      <div class="mm-api-body">
        <div class="mm-api-notice" id="mmAPISettingsNotice">
          <strong>本机配置与连接测试</strong>
          <p>保存后用于节点提问和导图生成。图片与PDF提问需要所选模型支持图片输入。</p>
        </div>
        <div class="mm-api-field">
          <label for="mmAPIProvider">服务商</label>
          <select id="mmAPIProvider" name="provider" autofocus>
            <option value="deepseek">DeepSeek</option>
            <option value="glm">智谱 GLM</option>
            <option value="kimi">Kimi</option>
            <option value="custom">自定义兼容服务</option>
          </select>
          <small>保存时将此服务商设为当前配置。各服务商的填写内容分别保留。</small>
        </div>
        <div class="mm-api-field">
          <label for="mmAPIBaseURL">接口地址（Base URL）</label>
          <input id="mmAPIBaseURL" name="baseURL" type="url" spellcheck="false" autocapitalize="none" placeholder="https://你的服务地址/v1" aria-describedby="mmAPIURLHelp">
          <small id="mmAPIURLHelp">填写基础地址，不需要在末尾加 /chat/completions。</small>
        </div>
        <div class="mm-api-field">
          <label for="mmAPIKey">API Key（密钥）</label>
          <div class="mm-api-secret">
            <input id="mmAPIKey" name="apiKey" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" placeholder="填写对应平台的 API Key" aria-describedby="mmAPIKeyHelp">
            <button class="mm-b" id="mmAPIKeyToggle" type="button" aria-controls="mmAPIKey" aria-pressed="false">显示</button>
          </div>
          <small id="mmAPIKeyHelp">密钥单独保存在本机，不进入导图或浏览器存储。已保存的密钥不会传回页面。</small>
          <button class="mm-b danger mm-api-clear" id="mmAPIKeyClear" type="button" hidden>清除已保存密钥</button>
        </div>
        <div class="mm-api-field">
          <label for="mmAPIModel">模型名称（Model ID）</label>
          <input id="mmAPIModel" name="model" type="text" spellcheck="false" autocapitalize="none" placeholder="填写平台提供的模型 ID" aria-describedby="mmAPIModelHelp">
          <small id="mmAPIModelHelp">从平台的模型说明中复制准确名称；不同服务商的模型名称不通用。</small>
        </div>
        <div class="mm-api-field"><label for="mmAPIMaxOutput">单次输出上限（tokens）</label><input id="mmAPIMaxOutput" type="number" min="1024" max="131072" step="1" value="32768" required><small>默认32768。填写所选模型支持的值；平台可能另有限制，token不是字数。各环节可使用更小预算，长任务仍会分批处理。</small></div>
        <p class="mm-api-protocol">接口格式：OpenAI 兼容聊天接口。配置仅供本 AI 副本使用，密钥以明文保存在本机 .local 文件夹中。</p>
      </div>
      <div class="mm-api-footer">
        <p id="mmAPIActionsHelp">测试会发送一条简短消息，可能产生少量费用；不携带导图内容，也不自动保存配置。</p>
        <p id="mmAPIResult" class="mm-api-result" role="status" aria-live="polite"></p>
        <div class="mm-api-actions">
          <button class="mm-b" id="mmAPITest" type="button" aria-describedby="mmAPIActionsHelp">测试连接</button>
          <span class="mm-api-action-gap"></span>
          <button class="mm-b" id="mmAPISettingsCancel" type="button">取消</button>
          <button class="mm-b pri" id="mmAPISave" type="submit" aria-describedby="mmAPIActionsHelp">保存配置</button>
        </div>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const $ = id => document.getElementById(id);
  const form = $("mmAPISettingsForm"), provider = $("mmAPIProvider");
  const baseURL = $("mmAPIBaseURL"), apiKey = $("mmAPIKey"), model = $("mmAPIModel"),maxOutput = $("mmAPIMaxOutput");
  const toggle = $("mmAPIKeyToggle");
  const testButton=$("mmAPITest"),saveButton=$("mmAPISave"),clearButton=$("mmAPIKeyClear"),result=$("mmAPIResult");
  let drafts=null,selected="deepseek",revision=null,session=0,pending=null,operation="",loaded=false;

  function report(message,kind="") {result.textContent=message;result.dataset.kind=kind;}
  function busy(kind="") {
    operation=kind;
    for(const el of [provider,baseURL,apiKey,model,maxOutput,toggle,clearButton])el.disabled=!!kind;
    testButton.disabled=saveButton.disabled=!!kind || !loaded;
    $("mmAPISettingsClose").disabled=$("mmAPISettingsCancel").disabled=kind==="save";
    testButton.textContent=kind==="test"?"测试中…":"测试连接";
    saveButton.textContent=kind==="save"?"保存中…":"保存配置";
    form.setAttribute("aria-busy",String(!!kind));
  }
  async function request(url,options,signal) {
    let response;
    try{response=await fetch(url,{...options,signal});}catch(error){if(error.name==="AbortError")throw error;throw new Error("连接本机服务失败，请确认服务已启动。");}
    let data;try{data=await response.json();}catch{throw new Error("本机接口返回异常，请重启服务后刷新页面。");}
    if(!response.ok)throw new Error(response.status===404?"本机服务尚未更新，请重启服务后刷新页面。":data.error || "配置操作失败");
    return data;
  }
  function accept(config) {
    revision=config.revision;selected=provider.value=config.activeProvider;
    drafts=Object.fromEntries(Object.keys(providers).map(id=>{const p=config.profiles[id];return [id,{url:p.baseURL,model:p.model,maxOutputTokens:p.maxOutputTokens??32768,key:"",hasKey:p.hasKey,clearKey:false}];}));
    loaded=true;showProvider();
  }
  function remember() {if(!drafts)return;Object.assign(drafts[selected],{url:baseURL.value,model:model.value,maxOutputTokens:Number(maxOutput.value),key:apiKey.value});}
  function keyState() {
    const d=drafts[selected];
    apiKey.placeholder=d.clearKey?"保存后将删除旧密钥；也可填写新密钥":d.hasKey?"已保存密钥；留空保留，填写可替换":"填写对应平台的 API Key";
    clearButton.hidden=!d.hasKey || d.clearKey;
  }
  const payload=d=>({baseURL:d.url,model:d.model,maxOutputTokens:d.maxOutputTokens,apiKey:d.key,clearKey:d.clearKey});

  function concealKey() {
    apiKey.type = "password";
    toggle.textContent = "显示";
    toggle.setAttribute("aria-pressed", "false");
  }
  function showProvider() {
    const draft = drafts[selected];
    baseURL.value = draft.url;
    apiKey.value = draft.key;
    model.value = draft.model;maxOutput.value=draft.maxOutputTokens;
    keyState();
    concealKey();
  }
  function reset() {
    drafts = null;
    revision=null;loaded=false;
    form.reset();
    baseURL.value = apiKey.value = model.value = "";
    concealKey();
  }
  function close() {
    if(operation==="save")return;
    ++session;pending?.abort();pending=null;
    dialog.close();
    reset();
    busy();report("");
    button.focus({ preventScroll: true });
  }

  button.addEventListener("pointerdown", event => event.preventDefault());
  button.addEventListener("click", async () => {
    if (dialog.open || document.querySelector("dialog[open]")) return;
    drafts = Object.fromEntries(Object.entries(providers).map(([id, preset]) => [id, { url: preset.url, key: "", model: "",maxOutputTokens:32768,hasKey:false,clearKey:false }]));
    selected = provider.value = "deepseek";
    showProvider();
    dialog.showModal();
    const token=++session,controller=new AbortController();pending=controller;
    busy("load");report("正在读取本机配置…");
    try{const config=await request("/api/ai/config",{},controller.signal);if(session!==token || !dialog.open)return;accept(config);report("已读取本机配置。修改后点击保存才会写入磁盘。");}
    catch(error){if(session===token && error.name!=="AbortError")report(error.message,"error");}
    finally{if(session===token && dialog.open){pending=null;busy();provider.focus();}}
  });
  provider.addEventListener("change", () => {
    remember();
    selected = provider.value;
    showProvider();
    report("修改后点击保存配置才会生效。测试连接不会自动保存。");
  });
  clearButton.addEventListener("click",()=>{drafts[selected].clearKey=true;apiKey.value="";drafts[selected].key="";concealKey();keyState();report("旧密钥将在保存后删除；取消关闭则保留原配置。");});
  for(const field of [baseURL,apiKey,model,maxOutput])field.addEventListener("input",()=>report("有未保存的修改。测试连接使用当前填写内容，不会自动保存。"));
  toggle.addEventListener("click", () => {
    const visible = apiKey.type === "password";
    apiKey.type = visible ? "text" : "password";
    toggle.textContent = visible ? "隐藏" : "显示";
    toggle.setAttribute("aria-pressed", String(visible));
  });
  $("mmAPISettingsClose").addEventListener("click", close);
  $("mmAPISettingsCancel").addEventListener("click", close);
  async function run(kind) {
    if(operation || !loaded)return;
    remember();const token=session,controller=new AbortController();pending=controller;
    const data=kind==="save"?{revision,activeProvider:selected,profiles:Object.fromEntries(Object.entries(drafts).map(([id,d])=>[id,payload(d)]))}:{provider:selected,profile:payload(drafts[selected])};
    busy(kind);report(kind==="save"?"正在保存本机配置…":"正在测试连接，最多等待约 30 秒…");
    try {
      const reply=await request(kind==="save"?"/api/ai/config":"/api/ai/test",{method:kind==="save"?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)},controller.signal);
      if(session!==token || !dialog.open)return;
      if(kind==="save"){accept(reply);report("配置已保存到本机，将用于后续的节点提问和 AI 导图生成。","success");window.dispatchEvent(new Event("mm:ai-config-saved"));}
      else report(reply.message+" 用时 "+(reply.latencyMs/1000).toFixed(1)+" 秒。测试没有保存配置。","success");
    }catch(error){if(session===token && error.name!=="AbortError")report(error.message,"error");}
    finally{if(session===token && dialog.open){pending=null;busy();}}
  }
  testButton.addEventListener("click",()=>run("test"));
  form.addEventListener("submit",event=>{event.preventDefault();run("save");});
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { if (!dialog.open){++session;pending?.abort();pending=null;reset();busy();} });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });

  // Loaded before canvas handlers: native text editing, Tab and Esc still work,
  // while map shortcuts and clipboard actions cannot affect the map behind it.
  for (const type of ["keydown", "copy", "cut", "paste"]) {
    document.addEventListener(type, event => {
      if (!dialog.open) return;
      event.stopImmediatePropagation();
      if (type === "keydown" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
    }, true);
  }
})();
