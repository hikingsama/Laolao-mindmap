'use strict';
const assert=require('node:assert/strict'),C=require('../js/ai-math-check.js'),review=require('../js/ai-math-review.cjs');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const text='设有 n 个质点，坐标为 (x_k,y_k,z_k)，质量为 m_k，其中 k=1,2,\\cdots,n。分子 \\sum x_k m_k 是静矩。';
const plan={nodes:[{id:'n1',title:'质心',text,origin:'source',citations:[{documentId:'doc',page:1}]}],edges:[]};
const patch=expression=>({nodeId:'n1',field:'text',expression,display:false,reason:'补充行内公式定界'});
check('Local inspection catches indices, commands, Greek symbols and contextual variables',()=>{const issues=C.inspect(text+' 密度为 ρ(x,y,z)。');assert(issues.some(i=>i.text==='m_k'));assert(issues.some(i=>i.text==='\\sum'));assert(issues.some(i=>i.text==='n'));assert(issues.some(i=>i.text==='ρ'));});
check('Valid inline equations, summations and display blocks are already ready',()=>{assert.deepEqual(C.inspect('其中 $k=1,2,\\cdots,n$，分子 $\\sum x_k m_k$。\n\n$$\nx=1\n$$'),[]);});
check('Code, filenames, paths, links and Markdown syntax are protected',()=>assert.deepEqual(C.inspect('`m_k`\n```tex\nx_k\n```\nhttps://example.com/x_k C:\\data\\n_1.txt [文件](x_k.pdf) **加粗** user_name'),[]));
check('Malformed existing LaTeX is detected without inventing missing mathematics',()=>assert(C.inspect('公式 $\\frac{1}{$。').some(i=>i.code==='syntax')));
check('Wrapping preserves exact expressions, node IDs, citations and edges',()=>{const r=C.apply(plan,[patch('(x_k,y_k,z_k)'),patch('m_k'),patch('k=1,2,\\cdots,n'),patch('\\sum x_k m_k')]);assert.equal(r.changes.length,4);assert.equal(r.plan.nodes[0].text.replaceAll('$',''),text);assert.deepEqual(r.plan.nodes[0].citations,plan.nodes[0].citations);assert.deepEqual(r.plan.edges,plan.edges);});
check('Review patches cannot rewrite math, touch code or wrap a partial identifier',()=>{const r=C.apply(plan,[patch('m_j'),patch('x'),{...patch('m_k'),expression:'质量为 m_k'}]);assert.equal(r.changes.length,0);assert.equal(r.rejected.length,3);assert.equal(r.plan.nodes[0].text,text);});
check('Explicit math and inline placement cannot be overridden',()=>{const p={nodes:[{id:'n1',title:'质心',text:'质量为 m_k，变量 $n$。'}],edges:[]};assert.equal(C.apply(p,[patch('n'),{...patch('m_k'),display:true}]).changes.length,0);});
check('Repeated expressions stay pending instead of guessing an occurrence',()=>assert.equal(C.apply({...plan,nodes:[{...plan.nodes[0],text:'质量 m_k 与 m_k。'}]},[patch('m_k')]).changes.length,0));
check('Suspect stream nodes and their successors wait for review without changing ready nodes',()=>{const p={nodes:[{id:'a',title:'概述',text:'已知条件。'},...plan.nodes,{id:'c',title:'应用',text:'后续'}],edges:[{from:'a',to:'n1',kind:'hierarchy',label:''}]};const ready=C.readyPrefix(p);assert.equal(ready.nodes.length,1);assert.equal(ready.nodes[0].id,'a');assert.equal(ready.edges.length,0);});
const config={baseURL:'https://example.invalid',model:'shared-model',apiKey:'fake-math-secret'};
(async()=>{
 let calls=0;
 const fixed=await review.run({plan,config,fetchImpl:async(url,init)=>{calls++;const request=JSON.parse(init.body);assert.equal(request.model,config.model);assert.equal(request.messages.length,2);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({patches:[patch('(x_k,y_k,z_k)'),patch('m_k'),patch('k=1,2,\\cdots,n'),patch('\\sum x_k m_k'),patch('n')]})},finish_reason:'stop'}]}));}});
 check('One shared-model review handles all fields and stores before/after audit without credentials',()=>{assert.equal(calls,1);assert.equal(fixed.audit.changes.length,5);assert.equal(fixed.audit.status,'completed');assert(!JSON.stringify(fixed).includes(config.apiKey));assert(fixed.plan.nodes[0].text.includes('$m_k$'));assert.equal(fixed.plan.nodes[0].mathWarnings,undefined);});
 await review.run({plan:fixed.plan,config,fetchImpl:()=>{throw Error('must not call');}});
 check('Already valid content causes no second paid review request',()=>assert.equal(calls,1));
 const failed=await review.run({plan,config,fetchImpl:async()=>{calls++;return new Response('{}',{status:503});}});
 check('Reviewer failure preserves original answer, marks pending math and never retries',()=>{assert.equal(calls,2);assert.equal(failed.plan.nodes[0].text,text);assert.equal(failed.audit.status,'failed');assert(failed.plan.nodes[0].mathWarnings.length);});
 const controller=new AbortController();controller.abort();await assert.rejects(review.run({plan,config,signal:controller.signal,fetchImpl:async(_url,init)=>{init.signal.throwIfAborted();}}),e=>e.name==='AbortError');
 check('Cancellation aborts review rather than publishing an unchecked late replacement',()=>assert(controller.signal.aborted));
 const waitingFetch=async(_url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('已停止','AbortError')),{once:true});});
 const during=new AbortController(),stopping=review.run({plan,config,signal:during.signal,fetchImpl:waitingFetch});setTimeout(()=>during.abort(),5);await assert.rejects(stopping,e=>e.name==='AbortError');
 check('Stopping during an in-flight paid review aborts its actual transport',()=>assert(during.signal.aborted));
 const timed=await review.run({plan,config,fetchImpl:waitingFetch,timeoutMs:5});
 check('Reviewer timeout retains original text and records an unresolved warning',()=>{assert.equal(timed.audit.status,'failed');assert(timed.audit.note.includes('超时'));assert.equal(timed.plan.nodes[0].text,text);});
 const {createService}=require('../js/ai-chat.cjs');let apiCalls=0;
 const service=createService({getConfig:()=>config,fetchImpl:async(_url,init)=>{apiCalls++;const request=JSON.parse(init.body),isReview=request.messages[0].content.includes('你是数学排版复核员');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(isReview?{patches:[patch('m_k')]}:{nodes:[{id:'n1',title:'质量',text:'质量为 m_k。'}],edges:[]})},finish_reason:'stop'}]}));}});
 async function api(url,method='GET',body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method,headers:{'content-type':'application/json',host:'127.0.0.1:8897'}});const res=new EventEmitter();res.writeHead=()=>{};res.end=value=>{res.data=JSON.parse(value);res.writableEnded=true;};await service.handle(req,res);return res.data;}
 try{await api('/api/ai/chat','POST',{requestId:'math',mode:'graph',messages:[{role:'user',content:'说明质量符号'}]});let result;for(let i=0;i<100;i++){result=await api('/api/ai/jobs/math');if(result.status!=='running')break;await new Promise(r=>setTimeout(r,2));}
 check('Actual chat pipeline returns reviewed nodes plus inspectable original output and review prompt',()=>{assert.equal(result.status,'completed');assert.equal(apiCalls,2);assert.equal(result.summary.nodes[0].text,'质量为 $m_k$。');assert.equal(result.inspection.generatedOutput.nodes[0].text,'质量为 m_k。');assert.equal(result.inspection.mathReview.inspection.promptId,'math-review');});
 await api('/api/ai/chat','POST',{requestId:'manual-math',mode:'math-review',messages:[{role:'user',content:'# 已有节点\n\n质量为 m_k。'}]});
 for(let i=0;i<100;i++){result=await api('/api/ai/jobs/manual-math');if(result.status!=='running')break;await new Promise(r=>setTimeout(r,2));}
 check('Existing-node API performs only review and retains the original Markdown heading',()=>{assert.equal(result.status,'completed');assert.equal(apiCalls,3);assert.equal(result.summary.nodes[0].text,'# 已有节点\n\n质量为 $m_k$。');});
 }finally{service.dispose();}
 console.log(count+' math review checks passed; fake models only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
