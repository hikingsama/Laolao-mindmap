'use strict';
// Reproduce limits with fake streams only. No personal data, keys or paid POSTs.
const assert=require('node:assert/strict'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const {readCompletion}=require('../js/ai-stream.cjs'),{createService}=require('../js/ai-chat.cjs');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const event=data=>'data: '+JSON.stringify(data)+'\n\n';
const content=text=>event({choices:[{delta:{content:text}}]});
const end=event({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n';
const smallPlan=JSON.stringify({direction:'解释本步',sourceIds:['a'],relation:'continue',note:'当前路径'});
const graph={nodes:[{id:'n1',title:'定义',text:'先理解当前变量。'}],edges:[]};
function response(wire,{json=false,keepOpen=false,chunk=32768}={}){
  const bytes=Buffer.from(wire);let index=0,cancelled=false;
  const body=new ReadableStream({pull(c){if(index<bytes.length){const next=Math.min(bytes.length,index+chunk);c.enqueue(bytes.subarray(index,next));index=next;}else if(!keepOpen)c.close();},cancel(){cancelled=true;}});
  return {value:new Response(body,{headers:{'Content-Type':json?'application/json':'text/event-stream'}}),cancelled:()=>cancelled};
}
const noise=(n,size=1600)=>Array.from({length:n},()=>event({metadata:'x'.repeat(size),choices:[{delta:{reasoning_content:'仅计数的思考片段'}}]})).join('');
async function api(service,url,method='GET',value){
  const req=Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]);Object.assign(req,{url,method,headers:{'content-type':'application/json'}});
  const res=new EventEmitter();res.writeHead=status=>res.status=status;res.end=raw=>{res.writableEnded=true;res.raw=raw;};
  await service.handle(req,res);return JSON.parse(res.raw);
}
async function run(planResponse,answerResponse=()=>response(content(JSON.stringify(graph))+end).value){
  const calls=[],service=createService({getConfig:()=>({baseURL:'https://example.invalid/v1',apiKey:'fake-limit-key',model:'fake'}),fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?planResponse():answerResponse();}});
  try{
    await api(service,'/api/ai/chat','POST',{requestId:'limit-test',mode:'graph',messages:[{role:'user',content:'解释本步'}],workflow:{candidates:[{id:'a',nodeId:'a',treeId:'tree',kind:'current',title:'当前步骤',text:'当前资料'},{id:'b',nodeId:'b',kind:'related',text:'无关资料'}],direction:'沿当前路径解释'}});
    for(let i=0;i<300;i++){
      const result=await api(service,'/api/ai/jobs/limit-test');if(result.status!=='running')return {result,calls};
      await new Promise(r=>setTimeout(r,2));
    }throw Error('timeout');
  }finally{service.dispose();}
}
(async()=>{
  let stats;const planningWire=noise(200)+content(smallPlan)+end;
  const plan=await readCompletion(response(planningWire).value,{limit:256*1024,maxWireBytes:8*1024*1024,onStats:s=>stats=s});
  check('Short planner output survives more than 256KB of SSE envelopes and reasoning',()=>{assert(Buffer.byteLength(planningWire)>256*1024);assert.equal(plan,smallPlan);assert.equal(stats.answerBytes,Buffer.byteLength(smallPlan));assert(stats.reasoningBytes>0);});
  const answerWire=noise(4000)+content(JSON.stringify(graph))+end;
  const reply=await readCompletion(response(answerWire).value,{onStats:s=>stats=s});
  check('Short answer survives more than the old 6MB wire ceiling',()=>{assert(Buffer.byteLength(answerWire)>6*1024*1024);assert.deepEqual(JSON.parse(reply),graph);assert.equal(stats.transportBytes,Buffer.byteLength(answerWire));});
  const tooMuch=response(content('中中中')+end,{keepOpen:true,chunk:1});let error;
  try{await readCompletion(tooMuch.value,{limit:8});}catch(e){error=e;}
  check('Actual answer limit counts UTF-8 bytes and cancels transport',()=>{assert.equal(error?.code,'AI_OUTPUT_LIMIT');assert(error.message.includes('正文'));assert(tooMuch.cancelled());assert.equal(error.transfer.answerBytes,0);});
  const transport=response(noise(10)+content('小回答')+end,{keepOpen:true,chunk:512});error=null;
  try{await readCompletion(transport.value,{maxWireBytes:2048});}catch(e){error=e;}
  check('Unbounded reasoning and envelopes still hit a separate transport limit',()=>{assert.equal(error?.code,'AI_TRANSPORT_LIMIT');assert(transport.cancelled());assert(error.transfer.transportBytes>2048);});
  for(const completeFrame of [true,false]){
    const frame=response(completeFrame?event({metadata:'x'.repeat(2000)}):'data: '+ 'x'.repeat(2000),{keepOpen:true,chunk:256});error=null;
    try{await readCompletion(frame.value,{maxFrameBytes:1024});}catch(e){error=e;}
    check((completeFrame?'Complete':'Unterminated')+' oversized SSE frame is bounded and cancelled',()=>{assert.equal(error?.code,'AI_STREAM_FRAME_LIMIT');assert(frame.cancelled());});
  }
  const jsonWire=JSON.stringify({choices:[{message:{content:'短正文',reasoning_content:'思考'.repeat(150000)},finish_reason:'stop'}]});
  const jsonReply=await readCompletion(response(jsonWire,{json:true}).value,{limit:20,onStats:s=>stats=s});
  check('Nonstream JSON also separates reasoning from the final answer',()=>{assert.equal(jsonReply,'短正文');assert.equal(stats.answerBytes,9);assert.equal(stats.reasoningBytes,900000);});
  await assert.rejects(readCompletion(response(JSON.stringify({choices:[{message:{content:'中中中'}}]}),{json:true}).value,{limit:8}),e=>e.code==='AI_OUTPUT_LIMIT');count++;console.log('PASS Nonstream answer limit remains enforced');
  const workflow=await run(()=>response(planningWire).value,()=>response(answerWire).value);
  check('Both workflow roles succeed with larger wrappers and retain only numeric counters',()=>{assert.equal(workflow.result.status,'completed');assert.equal(workflow.result.workflow.planningStatus,'completed');assert.equal(workflow.calls.length,2);assert(workflow.result.transfer.planning.transportBytes>256*1024);assert(workflow.result.transfer.answer.transportBytes>6*1024*1024);assert(Object.values(workflow.result.transfer).every(s=>Object.values(s).every(Number.isFinite)));});
  const cases=[
    ['planner answer exceeding 256KB',()=>response(content('x'.repeat(256*1024+1))+end).value],
    ['malformed planner SSE',()=>response('data: invalid-json\n\n').value],
    ['interrupted planner stream',()=>response(content('{"direction":"unfinished')).value],
    ['planner token truncation',()=>response(content(smallPlan)+event({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n').value],
    ['oversized planner transport',()=>response(noise(5400)+content(smallPlan)+end).value]
  ];
  for(const [name,factory] of cases){
    const {result,calls}=await run(factory);
    check(name+' falls back to the current path and continues without retry',()=>{assert.equal(result.status,'completed');assert.equal(result.workflow.planningStatus,'fallback');assert.deepEqual(result.workflow.sources.map(s=>s.id),['a']);assert.equal(result.workflow.direction,'沿当前路径解释');assert.equal(calls.length,2);assert(calls[1].messages.at(-2).content.includes('当前资料'));});
  }
  for(const status of [401,403]){
    const {result,calls}=await run(()=>new Response('{}',{status}));
    check('Planner HTTP '+status+' remains fatal and never starts a second paid request',()=>{assert.equal(result.status,'failed');assert(result.error.includes('验证失败'));assert.equal(calls.length,1);});
  }
  const {result,calls}=await run(()=>response(content(smallPlan)+end).value,()=>response(content('x'.repeat(1024*1024+1))+end).value);
  check('Genuinely excessive final answer fails distinctly with numeric diagnostics and no retry',()=>{assert.equal(result.status,'failed');assert(result.error.includes('正文超过'));assert.equal(result.workflow.planningStatus,'completed');assert(result.transfer.answer.transportBytes>1024*1024);assert.equal(calls.length,2);});
  console.log(count+' stream limit and workflow recovery checks passed; fake model only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
