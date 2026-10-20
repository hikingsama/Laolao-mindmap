"use strict";
const assert=require("node:assert/strict"),{Readable}=require("node:stream"),{EventEmitter}=require("node:events");
const {createService}=require("../js/ai-chat.cjs"),{parsePages,pageSpec}=require("../js/ai-media.js");
let mode="ok",calls=[],key="fake-chat-secret",counter=0;
const service=createService({getConfig:()=>({provider:"custom",model:"fake-model",baseURL:"https://model.example/v1",apiKey:key}),timeoutMs:40,ttlMs:2000,fetchImpl:async(url,options)=>{
  calls.push({url,options,body:JSON.parse(options.body)});
  if(mode==="wait")return new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));
  if(mode==="error")return new Response(JSON.stringify({error:{message:key}}),{status:400});
  if(mode==="network")throw new Error(key);
  if(mode==="badjson")return new Response("not json");
  const content=mode==="summary"?'```json\n'+JSON.stringify({nodes:[{id:"n1",title:"主题",text:"保留公式 $x^2$"},{id:"n2",title:"例题",text:"独立知识点"},{id:"n3",title:"结论",text:"简短结论"}]})+'\n```':mode==="badsummary"?"not a summary":mode==="empty"?null:"答案 $x^2$ "+key;
  return new Response(JSON.stringify({choices:[{message:{content},finish_reason:mode==="truncated"?"length":"stop"}]}));
}});
async function api(url,method="GET",data,headers={}){
  const req=Readable.from(data===undefined?[]:[Buffer.from(typeof data==="string"?data:JSON.stringify(data))]);Object.assign(req,{url,method,headers:{"content-type":"application/json",...headers}});
  const res=new EventEmitter();res.writeHead=status=>res.status=status;res.end=text=>{res.raw=text;res.writableEnded=true;};
  await service.handle(req,res);return {status:res.status,data:res.raw?JSON.parse(res.raw):null,raw:res.raw};
}
const base=()=>({requestId:"check-"+(++counter),context:{map:"学习",node:{id:"a",text:"公式 $x$"},neighbors:[{id:"b",text:"相邻资料"}],edges:[{from:{node:"b"},to:{node:"a"},dir:"fwd"}]},messages:[{role:"user",content:"解释一下"}]});
const image="data:image/png;base64,"+Buffer.from([137,80,78,71,13,10,26,10,0]).toString("base64");
let count=0;const check=(name,fn)=>{fn();count++;console.log("PASS "+name);};
async function completed(id){for(let i=0;i<100;i++){const r=await api("/api/ai/jobs/"+id);if(r.data.status!=="running")return r;await new Promise(r=>setTimeout(r,2));}throw Error("poll timeout");}
(async()=>{
  let p=base(),r=await api("/api/ai/chat","POST",p);check("submit returns asynchronous job",()=>{assert.equal(r.status,202);assert.equal(r.data.job,p.requestId);});
  let done=await completed(p.requestId);
  check("chat forwards saved model, context and question without leaking key",()=>{assert.equal(done.data.status,"completed");assert(done.data.reply.includes("$x^2$"));assert(!done.raw.includes(key));assert.equal(calls[0].options.headers.Authorization,"Bearer "+key);assert.equal(calls[0].options.redirect,"error");assert(calls[0].body.messages[1].content.includes("相邻资料"));assert.equal(calls[0].body.messages.at(-1).content,"解释一下");});
  const n=calls.length;await api("/api/ai/chat","POST",p);check("duplicate request ID does not charge a second request",()=>assert.equal(calls.length,n));
  mode="summary";p={...base(),mode:"summary",messages:[{role:"user",content:"问题"},{role:"assistant",content:"讨论结果"}]};await api("/api/ai/chat","POST",p);done=await completed(p.requestId);
  check("summary returns multiple validated cards and Markdown bodies",()=>{assert.equal(done.data.summary.nodes.length,3);assert.equal(done.data.summary.nodes[0].title,"主题");assert(done.data.summary.nodes[0].text.includes("$x^2$"));assert(done.data.summary.nodes.every(n=>n.type==="text" && n.selected));assert(calls.at(-1).body.messages[0].content.includes("通常3–6个"));});
  mode="ok";p={...base(),media:{kind:"image",name:"image.png",images:[{dataUrl:image}]}};await api("/api/ai/chat","POST",p);await completed(p.requestId);
  check("image uses actual inline image_url block",()=>{const last=calls.at(-1).body.messages.at(-1);assert(Array.isArray(last.content));assert.equal(last.content[1].type,"image_url");assert.equal(last.content[1].image_url.url,image);});
  p={...base(),media:{kind:"pdf",name:"notes.pdf",text:"第2页的正文",images:[{page:2,dataUrl:image},{page:4,dataUrl:image}]}};await api("/api/ai/chat","POST",p);await completed(p.requestId);
  check("PDF includes selected page labels, images and extracted text",()=>{const parts=calls.at(-1).body.messages.at(-1).content;assert(parts[0].text.includes("第2页的正文"));assert.deepEqual(parts.filter(p=>p.type==="text").slice(1).map(p=>p.text),["以下图片为PDF第2页。","以下图片为PDF第4页。"]);assert.equal(parts.filter(p=>p.type==="image_url").length,2);});
  for(const value of ["error","network","badjson","empty","truncated","badsummary"]){mode=value;p={...base(),...(value==="badsummary"?{mode:"summary"}:{}),...(value==="error"?{media:{kind:"image",name:"x",images:[{dataUrl:image}]}}:{})};await api("/api/ai/chat","POST",p);done=await completed(p.requestId);check(value+" returns safe failure",()=>{assert.equal(done.data.status,"failed");assert(!done.raw.includes(key));if(value==="error")assert(done.data.error.includes("视觉"));});}
  mode="wait";p=base();await api("/api/ai/chat","POST",p);await api("/api/ai/jobs/"+p.requestId,"DELETE");check("stop aborts upstream and removes job",()=>assert(calls.at(-1).options.signal.aborted));assert.equal((await api("/api/ai/jobs/"+p.requestId)).status,404);
  p=base();await api("/api/ai/chat","POST",p);done=await completed(p.requestId);check("waiting request times out",()=>assert.equal(done.data.status,"cancelled"));
  mode="ok";
  const bad=[{},null,{...base(),messages:[{role:"system",content:"inject"}]},{...base(),messages:[{role:"assistant",content:"last"}]},{...base(),requestId:"../escape"},{...base(),media:{kind:"image",images:[{dataUrl:"https://remote.example/x.png"}]}},{...base(),media:{kind:"pdf",images:[{page:0,dataUrl:image}]}},{...base(),media:{kind:"pdf",images:[{page:1,dataUrl:image},{page:1,dataUrl:image}]}}];
  for(const data of bad)assert.equal((await api("/api/ai/chat","POST",data)).status,400);
  check("rejects invalid roles, payloads, remote attachment URLs and invalid page identities",()=>{});
  assert.equal((await api("/api/ai/chat","POST",base(),{"content-type":"text/plain"})).status,415);
  check("PDF page parser validates and deduplicates bounded ranges",()=>{assert.deepEqual(parsePages("1，3-4,3",10),[1,3,4]);for(const raw of ["0","3-1","1-1000000000","2.5"])assert.throws(()=>parsePages(raw,10));assert.throws(()=>parsePages("11",10));});
  check("PDF defaults to all pages and permits explicit ranges beyond six",()=>{assert.deepEqual(parsePages('',12),Array.from({length:12},(_,i)=>i+1));assert.equal(parsePages('1-12',12).length,12);assert.deepEqual(parsePages('7,8,9',12),[7,8,9]);});
  check("Only explicit page references narrow a PDF, without confusing problem or chapter numbers",()=>{for(const q of ['第五题详细步骤','第5题','第2章的例题','这份PDF共8页，解释第五题','读全文，尤其是第2页','整份PDF'])assert.equal(pageSpec(q),'');for(const [q,pages] of [['第2页的第五题',[2]],['只看第2页到第4页',[2,3,4]],['第2至4页',[2,3,4]],['只看2-4页',[2,3,4]],['第2、4页',[2,4]],['第7页和第8页',[7,8]],['第十二页',[12]],['pages 7-9',[7,8,9]]])assert.deepEqual(parsePages(pageSpec(q),20),pages,q);});
  const largeImage='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(1100000)]).toString('base64');
  const fullText='完整正文'.repeat(7000)+'末页尾标记';
  p={...base(),media:{kind:'pdf',name:'full.pdf',text:fullText,images:Array.from({length:14},(_,i)=>({page:i+1,dataUrl:largeImage}))}};
  assert(Buffer.byteLength(JSON.stringify(p))>18*1024*1024);await api('/api/ai/chat','POST',p);done=await completed(p.requestId);
  check("Backend forwards every page above the old count and byte ceilings, with untruncated text",()=>{assert.equal(done.data.status,'completed');const parts=calls.at(-1).body.messages.at(-1).content;assert.equal(parts.filter(p=>p.type==='image_url').length,14);assert(parts[0].text.includes(fullText));assert(parts.some(p=>p.text==='以下图片为PDF第14页。'));});
  const chunk=Buffer.alloc(1024*1024),largeRequest=Readable.from(Array(129).fill(chunk));Object.assign(largeRequest,{url:'/api/ai/chat',method:'POST',headers:{'content-type':'application/json'}});
  const limitedResponse=new EventEmitter();limitedResponse.writeHead=status=>limitedResponse.status=status;limitedResponse.end=raw=>{limitedResponse.raw=raw;limitedResponse.writableEnded=true;};await service.handle(largeRequest,limitedResponse);
  check('Request byte ceiling is explicit and independent of page count',()=>{assert.equal(limitedResponse.status,413);assert(JSON.parse(limitedResponse.raw).error.includes('128MB'));});
  console.log(count+" chat and media checks passed; simulated model, no real credentials.");
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>service.dispose());
