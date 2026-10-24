"use strict";
// Uses fake credentials, temporary storage and an injected model transport. No network.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {Readable}=require("node:stream"),{EventEmitter}=require("node:events");
const {createService}=require("../js/ai-config.cjs");
const testRoot=path.resolve(__dirname,"../tmp");fs.mkdirSync(testRoot,{recursive:true});
const temp=fs.mkdtempSync(path.join(testRoot,"mm-ai-config-check-"));
process.env.MM_STORAGE_DIR=path.join(temp,"maps");
process.env.MM_AI_CONFIG_FILE=path.join(temp,"private","ai-config.json");
const port=8893,file=process.env.MM_AI_CONFIG_FILE;
let calls=[],mode="ok",passed=0;
const transport=async(url,options)=>{
  calls.push({url,options,payload:JSON.parse(options.body)});
  if(mode==="timeout" || mode==="cancel")return new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));
  if(mode==="network")throw new Error("private diagnostic includes secret");
  if(mode==="unauthorized")return new Response(JSON.stringify({error:{message:"fake-secret-original"}}),{status:401});
  if(mode==="rate")return new Response("quota",{status:429});
  if(mode==="badjson")return new Response("not json");
  if(mode==="badshape")return new Response(JSON.stringify({choices:[]}));
  if(mode==="oversize")return new Response("x".repeat(1024*1024+1));
  return new Response(JSON.stringify({choices:[{message:mode==="reasoning"?{reasoning_content:"thinking"}:{content:"OK fake-secret-original"},finish_reason:mode==="reasoning"?"length":"stop"}]}));
};
let service=createService({configFile:file,fetchImpl:transport,timeoutMs:30});
function request(url,method="GET",data,headers={}) {
  const req=Readable.from(data===undefined?[]:[Buffer.from(typeof data==="string"?data:JSON.stringify(data))]);
  Object.assign(req,{url,method,headers:{host:"127.0.0.1:"+port,"content-type":"application/json",...headers}});
  const res=new EventEmitter();res.destroyed=false;res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};
  let raw="";res.end=value=>{raw+=value || "";};
  const done=service.handle(req,res,port).then(handled=>({handled,status:res.status,raw,data:raw?JSON.parse(raw):null,headers:res.headers}));
  return {done,res};
}
const api=async(...args)=>request(...args).done;
function check(name,fn){fn();passed++;console.log("PASS "+name);}
const clone=value=>JSON.parse(JSON.stringify(value));
(async()=>{
  const initial=await api("/api/ai/config");
  check("fresh defaults do not create a config file",()=>{assert.equal(initial.status,200);assert.equal(initial.data.revision,"new");assert(!fs.existsSync(file));assert(!initial.data.profiles.deepseek.hasKey);});
  let payload={revision:initial.data.revision,activeProvider:"deepseek",profiles:Object.fromEntries(Object.entries(initial.data.profiles).map(([id,p])=>[id,{baseURL:p.baseURL,model:p.model,apiKey:""}]))};
  payload.profiles.deepseek.model="fake-model";payload.profiles.deepseek.apiKey="fake-secret-original";
  let saved=await api("/api/ai/config","PUT",payload);
  check("save persists separate config and redacts keys",()=>{assert.equal(saved.status,200,saved.data.error);assert.equal(JSON.parse(fs.readFileSync(file)).profiles.deepseek.apiKey,"fake-secret-original");assert(saved.data.profiles.deepseek.hasKey);assert(!saved.raw.includes("fake-secret-original"));assert(!saved.raw.includes('"apiKey"'));assert.equal(saved.headers["Cache-Control"],"no-store");assert(!fs.existsSync(process.env.MM_STORAGE_DIR));});
  const diskBefore=fs.readFileSync(file,"utf8");
  const conflict=await api("/api/ai/config","PUT",payload);
  check("a stale window cannot overwrite newer configuration",()=>assert.equal(conflict.status,409));
  service=createService({configFile:file,fetchImpl:transport,timeoutMs:30});
  const reopened=await api("/api/ai/config");
  check("saved settings survive a service restart without returning keys",()=>{assert.equal(reopened.data.profiles.deepseek.model,"fake-model");assert(reopened.data.profiles.deepseek.hasKey);assert(!reopened.raw.includes("fake-secret-original"));});
  const profile={baseURL:payload.profiles.deepseek.baseURL,model:"fake-model",apiKey:""};
  let test=await api("/api/ai/test","POST",{provider:"deepseek",profile});
  check("test reuses saved key and sends only a bounded connection message",()=>{assert.equal(test.status,200);assert.equal(calls.length,1);assert.equal(calls[0].url,"https://api.deepseek.com/chat/completions");assert.equal(calls[0].options.headers.Authorization,"Bearer fake-secret-original");assert.equal(calls[0].options.redirect,"error");assert.deepEqual(Object.keys(calls[0].payload).sort(),["max_tokens","messages","model","stream"]);assert.equal(calls[0].payload.messages.length,1);assert.equal(calls[0].payload.max_tokens,256);assert(!test.raw.includes("fake-secret-original"));assert.equal(fs.readFileSync(file,"utf8"),diskBefore);});
  const moved={...profile,baseURL:"https://other.example/v1"};
  const movedReply=await api("/api/ai/test","POST",{provider:"deepseek",profile:moved});
  check("address change cannot silently reuse a saved credential",()=>assert.equal(movedReply.status,400));
  const fresh={...moved,apiKey:"fake-unsaved-key"};
  test=await api("/api/ai/test","POST",{provider:"deepseek",profile:fresh});
  check("unsaved fields can be tested without modifying disk",()=>{assert.equal(test.status,200);assert.equal(calls.at(-1).options.headers.Authorization,"Bearer fake-unsaved-key");assert.equal(fs.readFileSync(file,"utf8"),diskBefore);});
  for(const [value,status] of [["unauthorized",502],["rate",502],["network",502],["badjson",502],["badshape",502],["oversize",502],["timeout",504]]){
    mode=value;const reply=await api("/api/ai/test","POST",{provider:"deepseek",profile});
    check(value+" produces a safe useful failure",()=>{assert.equal(reply.status,status);assert(reply.data.error);assert(!reply.raw.includes("fake-secret-original"));assert(!reply.raw.includes("private diagnostic"));});
  }
  mode="reasoning";test=await api("/api/ai/test","POST",{provider:"deepseek",profile});
  check("reasoning-only response at test token limit confirms connectivity",()=>assert.equal(test.status,200));
  mode="cancel";const active=request("/api/ai/test","POST",{provider:"deepseek",profile});
  await new Promise(resolve=>setTimeout(resolve,2));active.res.emit("close");await active.done;
  check("closing a test aborts the model transport",()=>assert(calls.at(-1).options.signal.aborted));mode="ok";
  for(const [url,method,data,headers,status] of [
    ["/api/ai/config","GET",undefined,{host:"evil.example"},403],
    ["/api/ai/config","PUT",payload,{origin:"https://evil.example"},403],
    ["/api/ai/test","POST",{}, {"content-type":"text/plain"},415],
    ["/api/ai/config","PUT","{broken",{},400],
    ["/api/ai/config","DELETE",undefined,{},405],
    ["/api/ai/test","POST",{provider:"unknown",profile}, {},400],
    ["/api/ai/test","POST",{provider:"custom",profile:{baseURL:"http://remote.example",model:"m",apiKey:"x"}}, {},400],
    ["/api/ai/test","POST",{provider:"custom",profile:{baseURL:"https://user:password@example.com",model:"m",apiKey:"x"}}, {},400],
    ["/api/ai/test","POST",{provider:"custom",profile:{baseURL:"https://example.com?key=x",model:"m",apiKey:"x"}}, {},400],
    ["/api/ai/config","PUT","x".repeat(32769),{},413]
  ])assert.equal((await api(url,method,data,headers)).status,status);
  check("rejects foreign pages, invalid methods/data/URLs and oversized input",()=>{});
  payload.revision=(await api("/api/ai/config")).data.revision;payload.profiles.deepseek.apiKey="";payload.profiles.glm.model="glm-test";payload.profiles.glm.apiKey="fake-glm-key";payload.activeProvider="glm";
  saved=await api("/api/ai/config","PUT",payload);
  check("multiple providers persist independently and blank keeps saved key",()=>{assert.equal(saved.status,200,saved.data.error);const disk=JSON.parse(fs.readFileSync(file));assert.equal(disk.activeProvider,"glm");assert.equal(disk.profiles.deepseek.apiKey,"fake-secret-original");assert.equal(disk.profiles.glm.apiKey,"fake-glm-key");});
  payload.revision=saved.data.revision;payload.profiles.glm.apiKey="";payload.profiles.deepseek.clearKey=true;
  saved=await api("/api/ai/config","PUT",payload);
  check("explicit key removal works without erasing another provider",()=>{assert.equal(saved.status,200,saved.data.error);assert(!saved.data.profiles.deepseek.hasKey);assert(saved.data.profiles.glm.hasKey);});
  const beforeBad=fs.readFileSync(file,"utf8");payload.revision=saved.data.revision;payload.profiles.glm.apiKey="bad\nkey";
  assert.equal((await api("/api/ai/config","PUT",payload)).status,400);
  check("failed validation preserves original file",()=>assert.equal(fs.readFileSync(file,"utf8"),beforeBad));
  const capacityConfig=(await api('/api/ai/config')).data;
  const capacityPayload={revision:capacityConfig.revision,activeProvider:'glm',profiles:Object.fromEntries(Object.entries(capacityConfig.profiles).map(([id,p])=>[id,{baseURL:p.baseURL,model:p.model,apiKey:'',maxOutputTokens:p.maxOutputTokens}]))};capacityPayload.profiles.glm.maxOutputTokens=65536;
  const capacitySaved=await api('/api/ai/config','PUT',capacityPayload);
  check('Per-model output budgets persist and are included in the active model configuration',()=>{assert.equal(capacitySaved.status,200);assert.equal(service.active().maxOutputTokens,65536);assert.equal(capacitySaved.data.profiles.glm.maxOutputTokens,65536);});
  capacityPayload.revision=capacitySaved.data.revision;capacityPayload.profiles.glm.maxOutputTokens=131073;const capacityBefore=fs.readFileSync(file,'utf8');assert.equal((await api('/api/ai/config','PUT',capacityPayload)).status,400);
  check('Out-of-range output budgets cannot overwrite saved settings',()=>assert.equal(fs.readFileSync(file,'utf8'),capacityBefore));
  const {handle}=require("../js/ai-server.cjs");
  const old=service;service={handle};
  assert.equal((await api("/api/ai/status")).data.available,true);
  assert.equal((await api("/api/ai/chat","POST",{})).status,400);
  check("saved config enables status while invalid chat payload is rejected",()=>{});service=old;
  fs.writeFileSync(file,"corrupt");
  assert.equal((await api("/api/ai/config")).status,500);
  assert.equal((await api("/api/ai/config","PUT",payload)).status,500);
  check("corrupt config is reported and not overwritten",()=>assert.equal(fs.readFileSync(file,"utf8"),"corrupt"));
  console.log(passed+" AI configuration checks passed; no real key or network used.");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  const target=path.resolve(temp),parent=testRoot;
  if(path.dirname(target)===parent && path.basename(target).startsWith("mm-ai-config-check-"))fs.rmSync(target,{recursive:true,force:true});
});
