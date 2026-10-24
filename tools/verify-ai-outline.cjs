'use strict';
const assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const S=require('../js/ai-summary.cjs'),{partialGraph}=require('../js/ai-stream.cjs');
const {bootAll,loadInto,fireDelegated}=require('./smoke.js');
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const options={outline:true,allowSupplement:false};
const plan={edges:[{from:'n1',to:'n2',kind:'contains'},{from:'n2',to:'n3',kind:'prerequisite'},{from:'n3',to:'n4',kind:'application'},{from:'n2',to:'n4',kind:'contrast'}],nodes:[
 {id:'n1',title:'导数',text:'研究函数的局部变化。',origin:'source'},
 {id:'n2',title:'定义',blocks:[{type:'text',text:'用极限定义：'},{type:'math',latex:"f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}h"}],origin:'source'},
 {id:'n3',title:'条件',text:'可导则连续。',origin:'source'},
 {id:'n4',title:'应用',text:'切线估算。',origin:'source'}]};
const normalized=S.parseSummary(JSON.stringify(plan),options);
async function api(service,url,method='GET',value){const req=Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]);Object.assign(req,{url,method,headers:{'content-type':'application/json'}});const res=new EventEmitter();res.writeHead=s=>res.status=s;res.end=s=>{res.raw=s;res.writableEnded=true;};await service.handle(req,res);return{status:res.status,data:JSON.parse(res.raw)};}
async function done(service,id){for(let i=0;i<100;i++){const r=await api(service,'/api/ai/jobs/'+id);if(r.data.status!=='running')return r.data;await new Promise(r=>setTimeout(r,2));}throw Error('job timeout');}
(async()=>{
 check('Outline accepts content relations and independent formulas',()=>{assert.equal(normalized.nodes.length,4);assert(normalized.nodes[1].text.includes('$$\n'));assert.deepEqual(normalized.edges.map(e=>S.relationLabels[e.kind]),['包含','前提','应用','对比']);});
 const many={nodes:Array.from({length:40},(_,i)=>({id:'p'+i,title:'知识'+i,text:'原文'+i})),edges:Array.from({length:39},(_,i)=>({from:'p'+i,to:'p'+(i+1),kind:'progression'}))};
 check('Dedicated outline supports forty nodes without changing ordinary question limits',()=>{assert.equal(S.normalizeSummary(many,options).nodes.length,40);assert.throws(()=>S.normalizeSummary(many));assert.throws(()=>S.normalizeSummary({...many,nodes:[...many.nodes,{id:'extra',title:'多余',text:'多余'}]},options));});
 check('Every branch must be reachable from the central topic, with no cycles or dangling edges',()=>{assert.throws(()=>S.normalizeSummary({...many,edges:many.edges.map(e=>({from:e.to,to:e.from,kind:e.kind}))},options));assert.throws(()=>S.normalizeSummary({...plan,edges:[...plan.edges,{from:'n4',to:'n1',kind:'mainline'}]},options));});
 const extra={nodes:[{id:'a',title:'解释',text:'补充解释',origin:'supplement'}],edges:[]};
 check('Supplement nodes require explicit permission and remain visibly marked',()=>{assert.throws(()=>S.normalizeSummary(extra,options));assert(S.nodeText(S.normalizeSummary(extra,{...options,allowSupplement:true}).nodes[0]).startsWith('# 【补充】'));});
 check('Stream parser retains all forty stable nodes and outline relation kinds',()=>{const part=partialGraph(JSON.stringify(many),options);assert.equal(part.nodes.length,40);assert.equal(part.edges.length,39);assert.equal(partialGraph(JSON.stringify(plan),options).edges.length,4);});
 check('Unfinished items and unapproved supplements never enter the streamed canvas',()=>{assert.equal(partialGraph(JSON.stringify(extra),options).nodes.length,0);const text=JSON.stringify(plan),cut=text.indexOf('{"id":"n3"');assert.equal(partialGraph(text.slice(0,cut)+'{"id":"n3","title":"未完成',options).nodes.length,2);});
 const calls=[],chat=require('../js/ai-chat.cjs').createService({getConfig:()=>({baseURL:'https://example.invalid/v1',model:'shared-model',apiKey:'fake-outline-key',maxOutputTokens:65536}),fetchImpl:async(url,init)=>{calls.push({url,...JSON.parse(init.body)});return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)},finish_reason:'stop'}]}));}});
 try{
   await api(chat,'/api/ai/chat','POST',{requestId:'outline-one',mode:'outline',outline:{title:'课堂整理'},messages:[{role:'user',content:'原文：导数、可导条件与应用。'}]});const first=await done(chat,'outline-one');
   check('One shared-model streaming call performs outline understanding without an extra planner or history',()=>{assert.equal(first.status,'completed');assert.equal(calls.length,1);assert.equal(calls[0].model,'shared-model');assert.equal(calls[0].stream,true);assert.equal(calls[0].max_tokens,65536);assert.equal(first.inspection.limits.maxOutputTokens,65536);assert.equal(first.inspection.transfer.finishReason,'stop');assert.equal(calls[0].messages.length,2);assert.equal(JSON.parse(calls[0].messages[1].content).source,'原文：导数、可导条件与应用。');assert(calls[0].messages[0].content.includes('严格依据原文'));});
   await api(chat,'/api/ai/chat','POST',{requestId:'outline-long',mode:'outline',outline:{title:'长输入',allowSupplement:true},messages:[{role:'user',content:'字'.repeat(200000)}]});const second=await done(chat,'outline-long');
   check('Full two-hundred-thousand-character input is accepted separately from its title',()=>{assert.equal(second.status,'completed');assert.equal(JSON.parse(calls[1].messages[1].content).source.length,200000);assert(calls[1].messages[0].content.includes('允许为理解'));});
   const before=calls.length;
   const bads=[{messages:[{role:'assistant',content:'历史'},{role:'user',content:'原文'}]},{workflow:{}},{media:{kind:'image'}},{outline:{allowSupplement:'yes'}}];
   for(const [i,bad] of bads.entries()){const r=await api(chat,'/api/ai/chat','POST',{requestId:'invalid-'+i,mode:'outline',messages:[{role:'user',content:'本次内容'}],...bad});assert.equal(r.status,400);}
   check('Mixed history, attachments, planner workflow and malformed options are rejected before charging',()=>assert.equal(calls.length,before));
 }finally{chat.dispose();}
 const b=bootAll(),M=b.Mindmap;loadInto(b.sandbox,'js/ai-note-format.js',b.sandbox.window);loadInto(b.sandbox,'js/ai-summary.js',b.sandbox.window);loadInto(b.sandbox,'js/ai-branch.js',b.sandbox.window);
 const fixture=()=>({id:'outline-test',title:'原图',v:3,flat:true,nodes:[{id:'old',text:'原文节点',children:[]},{id:'other',text:'其他节点',children:[]}],pos:{old:{x:0,y:0},other:{x:300,y:0}},size:{old:{w:160,h:70},other:{w:180,h:70}},edges:[{id:'occupied',from:{node:'old',side:'e'},to:{node:'other',side:'w'},dir:'fwd'}]});
 await M.openDocument(fixture());const before=JSON.stringify(M.state().cur),batch={kind:'outline',recordId:'source-one'},one={nodes:normalized.nodes.slice(0,2),edges:normalized.edges.slice(0,1)};
 M.saveOutlineSource({id:'source-one',text:'完整原文',status:'running'});M.appendAIResult('outline-test',null,one,'文字整理',batch);
 const positions=JSON.parse(JSON.stringify(M.state().cur.pos));M.appendAIResult('outline-test',null,normalized,'文字整理',batch,true);
 check('Outline streams directly into blank area without question-entry duplication',()=>{const map=M.state().cur;assert.equal(map.nodes.length,6);assert(map.nodes.filter(n=>n.outlineSourceId==='source-one').every(n=>!n.aiEntry));assert.equal(map.edges.length,5);for(const [id,pos] of Object.entries(positions))assert.deepEqual(JSON.parse(JSON.stringify(map.pos[id])),pos);});
 check('Generated nodes keep coordinates on the map layer and avoid all existing rectangles',()=>{const map=M.state().cur;for(const node of map.nodes){assert(!('x' in node));assert(!('y' in node));}const boxes=[...M.state().L.nodes.values()];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],c=boxes[j];assert(!(a.x<c.x+c.w && a.x+a.w>c.x && a.y<c.y+c.h && a.y+a.h>c.y));}});
 const final=JSON.stringify(M.state().cur);M.saveOutlineSource({id:'source-one',status:'completed'});fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('One undo removes every streamed node while retaining its original source record',()=>{const map={...M.state().cur};delete map.outlineSources;assert.equal(JSON.stringify(map),before);assert.equal(M.state().cur.outlineSources[0].text,'完整原文');});
 fireDelegated(b.doc.getElementById('mmRedo'),'click',{});
 check('Redo restores all generated IDs and edges, keeping latest source status',()=>{const map=M.state().cur;assert.equal(map.nodes.length,6);assert.equal(map.outlineSources[0].status,'completed');assert.equal(map.nodes.map(n=>n.id).join(','),JSON.parse(final).nodes.map(n=>n.id).join(','));});
 await M.openDocument(fixture());const attached={kind:'outline',recordId:'attached'};M.appendAIResult('outline-test','old',normalized,'整理',attached,true);
 check('Attached generation uses a free port and preserves the mother chain',()=>{const e=M.state().cur.edges.find(e=>e.label==='整理');assert.equal(e.from.node,'old');assert.notEqual(e.from.side,'e');assert(M.state().cur.edges.some(e=>e.id==='occupied'));});
 await M.openDocument(fixture());const localBefore=JSON.stringify(M.state().cur);await M.generateTextOutline('# 章节\n## 定义\n- 条件\n## 应用',{placement:'node',sourceId:'old',recordId:'local'});
 check('Local outline append preserves all hierarchy edges without an AI call',()=>{const map=M.state().cur;assert.equal(map.nodes.length,6);assert.equal(map.edges.filter(e=>e.label==='包含').length,3);assert.equal(map.edges.filter(e=>e.label==='整理').length,1);});
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('Local hierarchy generation also undoes as one canvas operation',()=>assert.equal(JSON.stringify(M.state().cur),localBefore));
 await M.openDocument(fixture());const gone={kind:'outline',recordId:'gone'};M.appendAIResult('outline-test',null,one,'整理',gone);M.editMap(()=>{const m=M.state().cur;m.nodes=m.nodes.filter(n=>n.id!==gone.mapping.n1);});
 check('Deleting the generated center stops later chunks instead of resurrecting it',()=>assert.throws(()=>M.appendAIResult('outline-test',null,normalized,'整理',gone,true)));
 const created=await M.createOutlineDocument('独立新图');const empty=JSON.stringify(M.state().cur);M.appendAIResult(created,null,normalized,'独立新图',{kind:'outline',recordId:'new'},true);
 check('New document has exactly the generated nodes, with no dummy seed or duplicate central entry',()=>assert.equal(M.state().cur.nodes.length,4));
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});check('New-map generation undoes cleanly to its empty canvas',()=>assert.equal(JSON.stringify(M.state().cur),empty));
 await M.generateTextOutline('# 原始题名\n## 要点',{placement:'new',title:'自定名称'});
 check('Local generation honors an explicit document title while preserving the original heading',()=>{assert.equal(M.state().cur.title,'自定名称');assert(M.state().cur.nodes.some(n=>n.text==='原始题名'));});
 console.log(count+' outline checks passed; fake model and in-memory maps only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
