'use strict';
const assert=require('node:assert/strict'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const P=require('../js/ai-lecture-plan.js'),S=require('../js/ai-summary.cjs'),prompts=require('../js/ai-prompts.cjs');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const documents=[{id:'q',name:'试题.pdf',pageCount:6},{id:'a',name:'答案.pdf',pageCount:6}];
const refs=[{documentId:'q',page:3},{documentId:'q',page:4},{documentId:'a',page:3}];
const index=refs.map((c,i)=>({id:'s'+i,title:'选择题第3题',topic:'定积分',key:'选择题第3题：零值判断',scope:'题干、四个选项或解答',continuesBefore:i===1,continuesAfter:i===0,citations:[c]}));
const planned={units:[{id:'u1',title:'选择题第3题',topic:'定积分',goal:'完整整理跨页题目与答案，逐项分析',sourceIds:['s0','s1','s2'],dependsOn:[]}]};
const options=P.task({stage:'plan',strategy:'fusion',documents,index}).normalization;
check('Global planning joins a cross-window question and its answer across files',()=>{const unit=P.parseStage(JSON.stringify(planned),options).units[0];assert.deepEqual(unit.citations,refs);assert.equal(unit.sourceIds.length,3);});
check('Global planning rejects omitted, invented and multiply assigned source units',()=>{
 for(const sourceIds of [['s0','s1'],['s0','s1','missing'],['s0','s1','s2','s2']])assert.throws(()=>P.parseStage(JSON.stringify({units:[{...planned.units[0],sourceIds}]}),options));
 assert.throws(()=>P.parseStage(JSON.stringify({units:[planned.units[0],{...planned.units[0],id:'u2'}]}),options));
});
check('Learning dependencies must precede the unit and cannot form a cycle',()=>{assert.throws(()=>P.parseStage(JSON.stringify({units:[{...planned.units[0],dependsOn:['u1']}]}),options));assert.throws(()=>P.parseStage(JSON.stringify({units:[{...planned.units[0],dependsOn:['future']}]}),options));});
check('Branch strategy retains file boundaries while fusion can combine them',()=>assert.throws(()=>P.parseStage(JSON.stringify(planned),{...options,strategy:'branches'})));
const pages=refs.slice(0,2).map(c=>({...c,text:'原文',part:1,parts:1,visual:true})),surveyOptions=P.task({stage:'survey',documents:documents.slice(0,1),pages}).normalization;
check('Survey must account for every provided page without pretending a window is a document',()=>{assert.equal(P.parseStage(JSON.stringify({units:[{...index[0],citations:refs.slice(0,2)}]}),surveyOptions).units.length,1);assert.throws(()=>P.parseStage(JSON.stringify({units:[index[0]]}),surveyOptions));assert.throws(()=>P.parseStage(JSON.stringify({units:[{...index[0],citations:[{documentId:'q',page:6}]}]}),surveyOptions));});
const fullText='### 题目与选项\n\n'+ '这里保留完整题干与四个选项。'.repeat(40)+'\n\n### 第一步：分析条件\n\n推导依据。\n\n### 结论\n\n末尾仍然存在。';
const graph={nodes:[{id:'n1',title:'选择题第3题',text:fullText,origin:'source',citations:refs}],edges:[]};
check('Legacy compact and grouping preserve complete long bodies including their ending',()=>{const compact=P.compact(graph);assert.equal(compact.nodes[0].text,fullText);assert.equal(compact.nodes[0].excerpted,false);assert.equal(P.groups([compact],300)[0][0].nodes[0].text,fullText);});
check('Semantic extraction carries all selected pages and preserves Markdown sections',()=>{const unit=P.parseStage(JSON.stringify(planned),options).units[0],input=P.task({stage:'extract',strategy:'fusion',documents,pages:refs.map(c=>({...c,text:'全文',part:1,parts:1})),unit});const bound=P.bindUnit(S.normalizeSummary(graph,input.normalization),input.normalization.semanticUnit);assert.equal(bound.nodes[0].text,fullText);assert.equal(bound.nodes[0].topic,'定积分');assert.throws(()=>P.bindUnit({...bound,nodes:[{...bound.nodes[0],citations:refs.slice(0,2)}]},unit));});
check('Direct dependencies keep their entire body and citations without replacing current raw pages',()=>{const unit=P.parseStage(JSON.stringify(planned),options).units[0],input=P.task({stage:'extract',documents,pages:[{documentId:'q',page:3,text:'当前原文',part:1,parts:1}],unit,contextFragments:[P.compact(graph)]});assert.equal(input.value.contextFragments[0].nodes[0].text,fullText);assert(input.normalization.citationPages.has('a:3'));assert.deepEqual(input.normalization.semanticUnit.citations,[refs[0]]);});
check('Shared section instructions reach all body-generating scenarios, keeping question limits',()=>{
 for(const id of ['node-graph','node-chat','node-summary','outline','lecture-extract','lecture-merge','map-summary'])assert(prompts.render(id).includes('节点内部的分节与分步规则'));
 for(const id of ['math-review','structure-review','lecture-survey','lecture-plan'])assert(!prompts.render(id).includes('节点内部的分节与分步规则'));
 assert(prompts.render('node-graph').includes('100–250'));assert(prompts.render('node-graph').includes('下一步可以问'));assert(prompts.catalog().find(p=>p.id==='outline').sharedRules);
});
async function api(service,url,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method:body?'POST':'GET',headers:{'content-type':'application/json'}});const res=new EventEmitter();res.writeHead=s=>res.status=s;res.end=t=>{res.writableEnded=true;res.value=JSON.parse(t);};await service.handle(req,res);return{http:res.status,...res.value};}
async function done(service,id){for(let i=0;i<100;i++){const value=await api(service,'/api/ai/jobs/'+id);if(value.status!=='running')return value;await new Promise(r=>setTimeout(r,2));}throw Error('timeout');}
(async()=>{
 const calls=[],image='data:image/png;base64,iVBORw0KGgo=';
 const service=require('../js/ai-chat.cjs').createService({getConfig:()=>({baseURL:'https://fake.invalid',model:'fake-only',apiKey:'test-key-only'}),fetchImpl:async(url,init)=>{const input=JSON.parse(init.body);calls.push(input);const content=input.messages.at(-1).content,task=JSON.parse((Array.isArray(content)?content[0].text:content).split('\n\n附带')[0]);const output=task.stage==='survey'?{units:[{...index[0],citations:task.pages.map(p=>({documentId:p.documentId,page:p.page}))}]}:task.stage==='plan'?planned:graph;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));}});
 try{
  await api(service,'/api/ai/chat',{requestId:'survey',mode:'lecture',messages:[{role:'user',content:'通览'}],fileTask:{stage:'survey',documents:documents.slice(0,1),pages},media:{kind:'pdf',name:'试题',images:[{documentId:'q',page:3,dataUrl:image}]}});
  const survey=await done(service,'survey');
  check('Survey has a structured inspectable index and does not invoke math review or publish knowledge',()=>{assert.equal(survey.status,'completed');assert.equal(survey.summary.units.length,1);assert.equal(survey.inspection.promptId,'lecture-survey');assert(!survey.graph?.nodes?.length);assert.equal(calls.length,1);});
  await api(service,'/api/ai/chat',{requestId:'plan',mode:'lecture',messages:[{role:'user',content:'全文规划'}],fileTask:{stage:'plan',strategy:'fusion',documents,index}});const plan=await done(service,'plan');
  check('Global-plan endpoint validates references and retains its exact output for investigation',()=>{assert.equal(plan.status,'completed');assert.equal(plan.summary.units[0].citations.length,3);assert.equal(plan.inspection.promptId,'lecture-plan');});
  const unit=plan.summary.units[0];await api(service,'/api/ai/chat',{requestId:'extract',mode:'lecture',messages:[{role:'user',content:'完整整理'}],fileTask:{stage:'extract',strategy:'fusion',documents,unit,pages:refs.map(c=>({...c,text:'完整原文',part:1,parts:1,visual:true}))},media:{kind:'pdf',name:'试题与答案',images:[{documentId:'q',page:3,dataUrl:image},{documentId:'a',page:3,dataUrl:image}]}});const extracted=await done(service,'extract');
  check('Same-numbered page images from different documents stay distinct and correctly labelled',()=>{assert.equal(extracted.status,'completed');const content=calls.at(-1).messages.at(-1).content;assert.equal(content.filter(p=>p.type==='image_url').length,2);assert(content.some(p=>p.text?.includes('文档 q 的第3页')));assert(content.some(p=>p.text?.includes('文档 a 的第3页')));assert.equal(extracted.summary.nodes[0].text,fullText);assert(!JSON.stringify(extracted.inspection).includes('base64'));});
  const before=calls.length,bad=await api(service,'/api/ai/chat',{requestId:'bad-image',mode:'lecture',messages:[{role:'user',content:'完整整理'}],fileTask:{stage:'extract',documents,unit,pages:refs.map(c=>({...c,text:'完整原文',part:1,parts:1}))},media:{kind:'pdf',name:'试题',images:[{documentId:'a',page:5,dataUrl:image}]}});
  check('Unprovided or ambiguous PDF images are rejected before any paid request',()=>{assert.equal(bad.http,400);assert.equal(calls.length,before);});
 }finally{service.dispose();}
 console.log(count+' semantic planning and provenance checks passed; fake models only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
