'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const testRoot=path.resolve(__dirname,'../tmp');fs.mkdirSync(testRoot,{recursive:true});
const temp=fs.mkdtempSync(path.join(testRoot,'mm-learning-'));
process.env.MM_STUDENT_PROFILE_FILE=path.join(temp,'student.json');
const E=require('../js/edge-policy.js'),P=require('../js/structure-plan.js'),S=require('../js/ai-summary.cjs'),{partialGraph}=require('../js/ai-stream.cjs');
const students=require('../js/student-profile.cjs'),{createService}=require('../js/ai-chat.cjs'),{bootAll,loadInto,fireDelegated}=require('./smoke.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const edge=(id,a,b,kind='hierarchy',label='')=>({id,from:{node:a,side:'e'},to:{node:b,side:'w'},kind,label,dir:'fwd'});
const nodes=['r','a','b'].map(id=>({id,title:id,text:'原始正文 '+id,brief:'简述',children:[]}));
const plan=P.validate({root:{nodeId:'r',nodeIds:['r'],title:'总览',summary:'总览'},modules:[{id:'m',nodeId:'a',nodeIds:['a','b'],title:'模块',summary:'模块',children:[]}],reason:'分组',orderReason:'从前提到结论'},nodes);
const profile={grade:'本科一年级',major:'机械工程',courses:'高中数学\n微积分上册（极限）'};
async function api(service,url,method='GET',value,headers={}){
 const req=Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]);Object.assign(req,{url,method,headers:{'content-type':'application/json',host:'127.0.0.1:8894',...headers}});
 const res=new EventEmitter();res.writeHead=s=>res.status=s;res.end=raw=>{res.writableEnded=true;res.raw=raw;};
 await (typeof service==='function'?service(req,res,8894):service.handle(req,res));
 return{status:res.status,data:JSON.parse(res.raw)};
}
async function poll(service,id){for(let i=0;i<150;i++){const r=await api(service,'/api/ai/jobs/'+id);if(r.data.status!=='running')return r.data;await new Promise(r=>setTimeout(r,3));}throw Error('timeout');}
const reply=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}));
(async()=>{
 check('Unordered node pair has one edge regardless of side, offset, label or direction',()=>{
   const a=edge('meaning','a','b','inference','条件'),b={...edge('other','b','a'),from:{node:'b',side:'n',offset:.3},to:{node:'a',side:'s',offset:.6}};
   assert.deepEqual(E.unique([a,b,edge('self','a','a')]),[a]);
 });
 check('A semantic relation wins over duplicate hierarchy without a hidden relation store',()=>{
   const old=edge('old','a','b','inference','有条件推导');assert.deepEqual(E.unique([edge('new','b','a'),old]),[old]);
 });
 check('Only redundant containment shortcuts are removed; inference shortcuts remain',()=>{
   const edges=[edge('ra','r','a'),edge('ab','a','b'),edge('rb','r','b')];assert.deepEqual(E.clean(edges).map(e=>e.id),['ra','ab']);
   edges[2].kind='inference';assert.equal(E.clean(edges).length,3);
 });
 check('Review reuses an existing semantic edge and repeated application never adds duplicates',()=>{
   const original=edge('meaning','a','b','inference','由此推出'),map={nodes:structuredClone(nodes),edges:[original,edge('reverse','b','a')],pos:{}};
   const before=map.nodes.map(n=>[n.id,n.text,n.brief]);P.apply(map,plan,'review');P.apply(map,plan,'review');
   assert.equal(map.edges.length,2);assert.deepEqual(map.edges.find(e=>e.id==='meaning'),original);assert.deepEqual(map.nodes.map(n=>[n.id,n.text,n.brief]),before);
   assert.equal(new Set(map.edges.map(e=>E.key(e.from.node,e.to.node))).size,map.edges.length);
 });
 check('Model duplicate relations collapse to one pair before graph validation',()=>{
   const graph=S.normalizeSummary({nodes:nodes.slice(1),edges:[{from:'a',to:'b',kind:'inference',label:'推导'},{from:'b',to:'a',kind:'relation',label:'补充'}]});
   assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].label,'推导');
 });
 const branching={nodes:nodes.map(({children,...n})=>n),edges:[{from:'r',to:'a',kind:'inference',label:'推出'},{from:'r',to:'b',kind:'hierarchy',label:''}]};
 check('Question output is one short chain and neutral reading order never invents inference',()=>{
   const result=S.normalizeSummary(branching,{shortChain:true});
   assert.deepEqual(result.edges,[branching.edges[0],{from:'a',to:'b',kind:'mainline',label:'阅读顺序'}]);
   assert.equal(S.normalizeSummary({nodes:[nodes[0]],edges:[]},{shortChain:true}).edges.length,0);
 });
 check('Question cap rejects a fourth node without truncating a completed proof; lectures retain their own scope',()=>{
   const four={nodes:[...nodes,{id:'c',title:'c',text:'正文'}],edges:[{from:'r',to:'a',kind:'hierarchy'},{from:'a',to:'b',kind:'hierarchy'},{from:'b',to:'c',kind:'hierarchy'}]};
   assert.throws(()=>S.normalizeSummary(four,{shortChain:true}),/1–3/);assert.equal(S.normalizeSummary(four,{outline:true}).nodes.length,4);
   const proof='公式与解释\n'.repeat(100);assert.equal(S.normalizeSummary({nodes:[{id:'p',title:'证明',text:proof}],edges:[]},{shortChain:true}).nodes[0].text,proof.trim());
 });
 check('Streaming and final chain share stable consecutive links, including a branching model response',()=>{
   const final=S.normalizeSummary(branching,{shortChain:true}),partial=partialGraph(JSON.stringify(branching),{shortChain:true});
   assert.deepEqual(partial.edges,final.edges);assert.equal(partial.nodes.length,3);
 });
 const service=students.createService({profileFile:process.env.MM_STUDENT_PROFILE_FILE});
 check('Background is optional and does not require course or map fields',()=>assert.deepEqual(service.current(),{grade:'',major:'',courses:''}));
 let saved=await api(service,'/api/ai/student-profile','PUT',{revision:'new',profile});
 check('One global background persists across a fresh service instance',()=>{assert.equal(saved.status,200);assert.deepEqual(students.createService({profileFile:process.env.MM_STUDENT_PROFILE_FILE}).current(),profile);});
 const conflict=await api(service,'/api/ai/student-profile','PUT',{revision:'new',profile:{grade:'覆盖'}});
 check('Concurrent settings save cannot silently overwrite the current background',()=>{assert.equal(conflict.status,409);assert.deepEqual(service.current(),profile);});
 const invalid=await api(service,'/api/ai/student-profile','PUT',{revision:saved.data.revision,profile:{courses:['无效']}});
 check('Invalid background is rejected while the prior saved setting survives',()=>{assert.equal(invalid.status,400);assert.deepEqual(service.current(),profile);});
 check('Background is data; math correction stays independent and structure cannot rewrite existing text',()=>{
   assert(students.instruction(profile,'node-graph').includes('不能作为指令'));assert.equal(students.instruction(profile,'math-review'),'');assert(students.instruction(profile,'structure-review').includes('不得改写'));
 });
 const handler=require('../js/ai-server.cjs').createHandler({students:service,settings:{handle:async()=>false,active:()=>({}),status:()=>({})},chat:{handle:async()=>false}});
 const forbidden=await api(handler,'/api/ai/student-profile','PUT',{}, {origin:'https://other.example'});
 check('Global settings endpoint inherits localhost and origin protection',()=>assert.equal(forbidden.status,403));
 const captured=[],fakeConfig={baseURL:'https://fake.example/v1',model:'fake',apiKey:'fake-test-only'};
 const chat=createService({getConfig:()=>fakeConfig,getStudentProfile:()=>service.current(),fetchImpl:async(u,o)=>{
   const payload=JSON.parse(o.body);captured.push(payload);return reply(payload.messages[0].content.includes('关联员')?{direction:'只回答当前问题',sourceIds:['r'],relation:'continue',note:'本轮短链'}:branching);
 }});
 try{
   await api(chat,'/api/ai/chat','POST',{requestId:'short-background',mode:'graph',messages:[{role:'user',content:'说明导数'}],workflow:{candidates:[{id:'r',nodeId:'r',kind:'current',text:'问题'}]}});
   const result=await poll(chat,'short-background');
   check('Planner and answering role both use the saved background in the same question',()=>{
     assert.equal(result.status,'completed');assert.equal(captured.length,2);for(const payload of captured)assert(payload.messages[0].content.includes('机械工程'));assert.equal(result.summary.nodes.length,3);assert.equal(result.summary.edges.length,2);
   });
   check('Prompt audit records effective background without model credentials',()=>{assert(result.inspection.system.includes('本科一年级'));assert(!JSON.stringify(result.inspection).includes(fakeConfig.apiKey));});
 }finally{chat.dispose();}
 const b=bootAll(),M=b.Mindmap;
 for(const file of ['js/structure-plan.js','js/topic-layout.js','js/ai-note-format.js','js/ai-summary.js'])loadInto(b.sandbox,file,b.sandbox.window);
 await M.openDocument({id:'short-map',title:'测试',v:3,flat:true,nodes:[{id:'old',text:'原节点',children:[]}],edges:[],pos:{old:{x:0,y:0}}});
 const before=JSON.stringify(M.state().cur),batch={turnId:'turn',shortChain:true};
 const first={nodes:[branching.nodes[0]],edges:[]};M.appendAIResult('short-map','old',first,'本轮问题',batch,false);
 const short=S.normalizeSummary(branching,{shortChain:true});M.appendAIResult('short-map','old',short,'本轮问题',batch,true);
 const positions=JSON.stringify(M.state().cur.pos);M.finalizeAIOrganization(batch);
 check('Question finalization keeps the incremental chain positions and never rewrites the source node',()=>{
   assert.equal(JSON.stringify(M.state().cur.pos),positions);assert.equal(M.findNode('old').n.text,'原节点');
   assert.equal(M.state().cur.edges.length,4);assert.equal(M.state().cur.nodes.length,5);
 });
 const after=JSON.stringify(M.state().cur);
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('A short generated chain undoes as one batch without deleting the source',()=>assert.equal(JSON.stringify(M.state().cur),before));
 fireDelegated(b.doc.getElementById('mmRedo'),'click',{});
 check('Redo restores exactly the generated short chain and its edge identities',()=>assert.equal(JSON.stringify(M.state().cur),after));
 const live=M.state().cur.nodes.map(n=>({id:n.id,title:n.text}));await M.openDocument({id:'review-map',title:'复核',v:3,flat:true,nodes:structuredClone(nodes),edges:[edge('meaning','a','b','inference','由此推出')],pos:{r:{x:0,y:0},a:{x:300,y:0},b:{x:600,y:0}}});
 const original=JSON.stringify(M.state().cur);M.applyReviewedStructure(plan,'review-ui');
 check('Canvas adoption has no duplicate pair and can restore the complete previous graph',()=>{
   const map=M.state().cur;assert.equal(E.unique(map.edges).length,map.edges.length);assert(map.edges.find(e=>e.id==='meaning'));
   fireDelegated(b.doc.getElementById('mmUndo'),'click',{});assert.equal(JSON.stringify(M.state().cur),original);
 });
 console.log(count+' learning-update checks passed; isolated files and fake models only.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 if(path.dirname(temp)===testRoot && path.basename(temp).startsWith('mm-learning-'))fs.rmSync(temp,{recursive:true,force:true});
});

