"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const PRESETS = {deepseek:"https://api.deepseek.com",glm:"https://open.bigmodel.cn/api/paas/v4",kimi:"https://api.moonshot.cn/v1",custom:""};
const IDS = Object.keys(PRESETS);
function fail(message, status=400) { return Object.assign(new Error(message), {status}); }
function text(value, max, label) {
  if(typeof value!=="string" || value.length>max || /[\x00-\x1f\x7f]/.test(value)) throw fail(label+"格式不正确");
  return value.trim();
}
function address(value) {
  value=text(value,2048,"接口地址"); if(!value)return "";
  let url;try{url=new URL(value);}catch{throw fail("请输入完整的接口基础地址");}
  if(url.username || url.password || url.search || url.hash)throw fail("接口地址不能含账号、密码、查询参数或片段");
  if(url.protocol!=="https:" && !(url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))throw fail("接口地址请使用 HTTPS；本机服务可使用 HTTP");
  return url.href.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}
function json(res,status,value) {res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));}
async function body(req) {
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))throw fail("请使用 JSON 格式提交",415);
  let size=0;const parts=[];
  for await(const part of req){size+=part.length;if(size>32768)throw fail("配置内容过大",413);parts.push(part);}
  try{const value=JSON.parse(Buffer.concat(parts).toString("utf8"));if(!value || typeof value!=="object" || Array.isArray(value))throw 0;return value;}catch{throw fail("配置数据不是有效的 JSON 对象");}
}
exports.createService = ({configFile=process.env.MM_AI_CONFIG_FILE || path.join(__dirname,"../.local/ai-config.json"),fetchImpl=globalThis.fetch,timeoutMs=30000}={}) => {
  function load() {
    let source;try{source=fs.readFileSync(configFile,"utf8");}catch(error){if(error.code!=="ENOENT")throw fail("无法读取本机 AI 配置，请检查文件权限",500);}
    if(source===undefined)return {version:1,activeProvider:"deepseek",profiles:Object.fromEntries(IDS.map(id=>[id,{baseURL:PRESETS[id],model:"",apiKey:""}])),revision:"new"};
    try{
      const value=JSON.parse(source);
      if(value.version!==1 || !IDS.includes(value.activeProvider) || !value.profiles)throw 0;
      for(const id of IDS){const p=value.profiles[id];if(!p || typeof p.baseURL!=="string" || typeof p.model!=="string" || typeof p.apiKey!=="string")throw 0;}
      return {...value,revision:crypto.createHash("sha256").update(source).digest("hex")};
    }catch{throw fail("本机 AI 配置文件损坏；为避免覆盖，请先备份并检查该文件",500);}
  }
  function publicConfig(config) {
    return {activeProvider:config.activeProvider,revision:config.revision,profiles:Object.fromEntries(IDS.map(id=>{const p=config.profiles[id];return [id,{baseURL:p.baseURL,model:p.model,hasKey:!!p.apiKey}];}))};
  }
  function profile(input,old) {
    if(!input || typeof input!=="object" || Array.isArray(input))throw fail("服务商配置格式不正确");
    const baseURL=address(input.baseURL),model=text(input.model,200,"模型名称"),typedKey=text(input.apiKey===undefined?"":input.apiKey,4096,"密钥");
    if(input.clearKey!==undefined && typeof input.clearKey!=="boolean")throw fail("清除密钥选项格式不正确");
    if(!typedKey && !input.clearKey && old.apiKey && baseURL!==address(old.baseURL))throw fail("接口地址已改变，请重新填写密钥或先清除已保存密钥");
    return {baseURL,model,apiKey:typedKey || (input.clearKey?"":old.apiKey)};
  }
  function save(input) {
    const old=load();if(input.revision!==old.revision)throw fail("配置已被另一个窗口修改，请关闭后重新打开再保存",409);
    if(!IDS.includes(input.activeProvider) || !input.profiles)throw fail("服务商配置不正确");
    const next={version:1,activeProvider:input.activeProvider,profiles:Object.fromEntries(IDS.map(id=>[id,profile(input.profiles[id],old.profiles[id])]))};
    // Keep legacy configuration inert; removing the feature must not erase local settings.
    if(old.drawing!==undefined)next.drawing=old.drawing;
    const dir=path.dirname(configFile),temp=configFile+"."+crypto.randomUUID()+".tmp";
    try{fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(temp,JSON.stringify(next,null,2)+"\n",{mode:0o600,flag:"wx"});fs.renameSync(temp,configFile);}catch{try{fs.unlinkSync(temp);}catch{}throw fail("配置保存失败，请检查本机目录权限；原配置已保留",500);}
    return publicConfig(load());
  }
  async function test(input,res) {
    if(!IDS.includes(input.provider))throw fail("请选择正确的服务商");
    const current=profile(input.profile,load().profiles[input.provider]);
    if(!current.baseURL || !current.model || !current.apiKey)throw fail("请填写接口地址、模型名称和密钥后再测试");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),start=Date.now();
    const cancel=()=>controller.abort();res.once("close",cancel);
    try {
      const response=await fetchImpl(current.baseURL+"/chat/completions",{method:"POST",redirect:"error",signal:controller.signal,headers:{"Content-Type":"application/json","Authorization":"Bearer "+current.apiKey},body:JSON.stringify({model:current.model,messages:[{role:"user",content:"Connection test. Reply only OK."}],stream:false,max_tokens:256})});
      if(!response.ok){await response.body?.cancel();const status=response.status;throw fail(status===401?"密钥验证失败，请检查 API Key":status===403?"平台拒绝访问，请检查密钥权限和模型权限":status===429?"平台限流或额度不足，请在服务商控制台检查":status===404?"接口地址或模型不存在，请检查地址和模型名称":status===400?"平台不接受此请求，请检查模型名称和接口兼容性":status>=500?"模型平台暂时异常，请稍后再试":"平台返回错误（HTTP "+status+"）",502);}
      const reader=response.body.getReader();let size=0;const parts=[];
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw fail("平台返回内容过大，已停止测试",502);}parts.push(Buffer.from(value));}}finally{reader.releaseLock();}
      let data;try{data=JSON.parse(Buffer.concat(parts).toString("utf8"));}catch{throw fail("接口未返回有效的 JSON，请检查接口地址",502);}
      const choice=data.choices?.[0],message=choice?.message;
      if(!message || !(typeof message.content==="string" && message.content.trim()) && !(typeof message.reasoning_content==="string" && message.reasoning_content.trim()))throw fail("接口未返回有效的聊天回答，请检查模型兼容性",502);
      return {ok:true,latencyMs:Date.now()-start,message:choice.finish_reason==="length"?"连接成功，已收到模型响应；测试输出达到长度上限。":"连接成功，已收到模型响应。"};
    }catch(error){if(error.status)throw error;if(controller.signal.aborted)throw fail("测试已停止或等待超时（30 秒），请稍后重试",504);throw fail("无法连接模型平台，请检查接口地址、网络或 HTTPS 证书",502);}finally{clearTimeout(timer);res.removeListener("close",cancel);}
  }
  return {active() {
    const config=load(),provider=config.activeProvider,p=config.profiles[provider];
    if(!p.baseURL || !p.model || !p.apiKey)throw fail("请先在顶部大模型 API 接入中填写并保存完整配置",503);
    return {provider,baseURL:address(p.baseURL),model:p.model,apiKey:p.apiKey};
  },status() {
    const config=load(),p=config.profiles[config.activeProvider];
    return {available:!!(p.baseURL && p.model && p.apiKey),provider:config.activeProvider,model:p.model};
  },async handle(req,res,port) {
    if(!["/api/ai/config","/api/ai/test"].includes(req.url))return false;
    if(!["127.0.0.1:"+port,"localhost:"+port].includes(req.headers.host) || req.headers.origin && !["http://127.0.0.1:"+port,"http://localhost:"+port].includes(req.headers.origin)){req.resume();json(res,403,{error:"仅允许本机页面访问"});return true;}
    try {
      if(req.url==="/api/ai/config" && req.method==="GET")json(res,200,publicConfig(load()));
      else if(req.url==="/api/ai/config" && req.method==="PUT")json(res,200,save(await body(req)));
      else if(req.url==="/api/ai/test" && req.method==="POST")json(res,200,await test(await body(req),res));
      else{req.resume();json(res,405,{error:"请求方法不支持"});}
    }catch(error){req.resume();if(!res.destroyed)json(res,error.status || 500,{error:error.status?error.message:"本机 AI 配置操作失败"});}
    return true;
  }};
};
