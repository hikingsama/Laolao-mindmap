'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),P=require('./ai-lecture-plan.js'),PDF=require('./lecture-pdf.cjs');
const {create}=require('./lecture-task-store.cjs'),controller=new AbortController();let task,store,config,chat,finished=false,parentInstance;
const save=()=>{const current=store.read(task.id);if(task.status==='running'&&current?.status==='cancelling'){task.status='cancelling';controller.abort();}task.updatedAt=Date.now();task.record.updatedAt=task.updatedAt;store.write(task.id,task);};
const stage=text=>{task.stage=text;save();};
const signal=controller.signal;
async function one(key,title,payload){
 try{if(!process.connected||JSON.parse(fs.readFileSync(path.join(store.root,'.owner.json'),'utf8')).instance!==parentInstance)controller.abort();process.kill(process.ppid,0);}catch{controller.abort();}signal.throwIfAborted();let phase=task.record.runs.find(r=>r.key===key);
 if(phase?.status==='completed'&&phase.inspection?.output)return structuredClone(phase.inspection.output);
 if(!phase){phase={id:randomUUID(),key,order:task.record.runs.length+1,stage:payload.fileTask.stage,title};task.record.runs.push(phase);}
 else if(phase.inspection){(phase.previousAttempts ||= []).push({status:phase.status,error:phase.error,inspection:phase.inspection});delete phase.inspection;delete phase.error;}
 phase.status='running';phase.startedAt=Date.now();task.stage=title;task.inFlight={key,startedAt:Date.now(),mayHaveCharged:true};save();
 try{const result=await chat.run({...payload,requestId:phase.id},{signal,config,studentProfile:task.studentProfile,onUpdate:data=>{phase.inspection=data.inspection;phase.calls=data.calls;task.stage=title+' · '+(data.stage || '处理中');save();}});
  phase.inspection=result.inspection;phase.calls=result.calls;phase.status='completed';phase.completedAt=Date.now();delete task.inFlight;save();return structuredClone(result.summary);
 }catch(e){phase.status=signal.aborted?'stopped':'failed';phase.error=String(e.message).replaceAll(config.apiKey,'[密钥已隐藏]');if(e.inspection)phase.inspection=e.inspection;save();throw e;}
}
const refsOf=pages=>P.citations(pages,{documents:task.record.documents});
function overview(){
 const units=task.record.semanticPlan.units,root={id:'lecture_root',layoutRole:'overview',title:task.title,text:'### 主题与阅读顺序\n\n'+units.map((u,i)=>(i+1)+'. '+u.title).join('\n'),brief:'本组材料按'+[...new Set(units.map(u=>u.topic))].join('、')+'组织。',origin:'source',citations:task.record.documents.map(d=>({documentId:d.id,page:1}))},nodes=[root],edges=[];
 if(task.options.strategy==='branches')for(const [i,d] of task.record.documents.entries()){const n={id:'doc'+i,layoutRole:'document',parentId:root.id,title:d.name,text:'### 本讲义的内容单元\n\n'+units.filter(u=>u.citations.some(c=>c.documentId===d.id)).map(u=>'- '+u.title).join('\n'),origin:'source',citations:[{documentId:d.id,page:1}]};nodes.push(n);edges.push({from:root.id,to:n.id,kind:'hierarchy',label:''});}
 return{nodes,edges};
}
async function run(){
 const record=task.record,documents=record.documents,fileFor=d=>store.file(task.id,d.id);task.status='running';delete task.error;save();
 for(const d of documents)if(!d.pageCount){stage('读取页数 · '+d.name);d.pageCount=await PDF.metadata(fileFor(d),signal);save();}
 record.contentIndex=[];
 for(const d of documents){d.status='running';const surveyed=new Map();
  for await(const batch of PDF.batches(d,fileFor(d),{signal,reading:task.options.reading,onPage:p=>stage('通览 '+d.name+' · 第'+p+'/'+d.pageCount+'页')})){
   const key='survey:'+d.id+':'+batch.pages.map(p=>p.page+'-'+p.part).join(','),payload={mode:'lecture',messages:[{role:'user',content:'建立内容索引'}],fileTask:{stage:'survey',strategy:task.options.strategy,documents:[d],pages:batch.pages},...(batch.images.length?{media:{kind:'pdf',name:d.name,images:batch.images}}:{})};
   const result=await one(key,'全文通览 · '+d.name,payload),phase=record.runs.find(r=>r.key===key);for(const [i,u] of result.units.entries())record.contentIndex.push({...u,id:'s'+phase.order+'_'+(i+1)});
   for(const p of batch.pages){const item=surveyed.get(p.page)||{parts:p.parts,done:new Set()};item.done.add(p.part);surveyed.set(p.page,item);}d.surveyedPages=[...surveyed].filter(([,v])=>v.done.size===v.parts).map(([n])=>n);save();
  }d.status='surveyed';save();
 }
 if(documents.some(d=>d.surveyedPages.length!==d.pageCount))throw Error('全部页面尚未通览完成');
 const planTask={stage:'plan',strategy:task.options.strategy,documents,index:record.contentIndex};P.task(planTask);
 record.semanticPlan=await one('plan','全文主题与步骤规划',{mode:'lecture',messages:[{role:'user',content:'通览全部索引后安排完整主题与步骤'}],fileTask:planTask});save();
 const graphs=[],results=new Map();record.sections=[];
 for(const [i,u] of record.semanticPlan.units.entries()){
  signal.throwIfAborted();u.status='running';stage('回读原文 · '+u.title);
  const material=await PDF.readUnit(documents,fileFor,u.citations,{signal,reading:task.options.reading}),contextFragments=u.dependsOn.map(id=>{if(!results.has(id))throw Error('依赖前文尚未完成');return P.compact(results.get(id));}),sourceIds=new Set(material.pages.map(p=>p.documentId));
  for(const f of contextFragments)for(const n of f.nodes)for(const c of n.citations||[])sourceIds.add(c.documentId);
  const context=units=>units.map(v=>({title:v.title,goal:v.goal})),fileTask={stage:'extract',strategy:task.options.strategy,documents:documents.filter(d=>sourceIds.has(d.id)),pages:material.pages,unit:{...u,previous:context(record.semanticPlan.units.slice(Math.max(0,i-2),i)),next:context(record.semanticPlan.units.slice(i+1,i+3))},contextFragments};P.task(fileTask);
  const key='unit:'+u.id,summary=await one(key,'内容单元 · '+u.title,{mode:'lecture',outline:{allowSupplement:task.options.allowSupplement},messages:[{role:'user',content:'完整整理当前内容单元'}],fileTask,...(material.images.length?{media:{kind:'pdf',name:'当前单元原始页面',images:material.images}}:{})});
  results.set(u.id,summary);u.status='completed';const ids=new Map(summary.nodes.map((n,j)=>[n.id,'u'+i+'n'+j])),graph={nodes:summary.nodes.map(n=>({...n,id:ids.get(n.id),topic:u.topic,...(n.parentId?{parentId:ids.get(n.parentId)}:{})})),edges:summary.edges.map(e=>({...e,from:ids.get(e.from),to:ids.get(e.to)}))},phase=record.runs.find(r=>r.key===key);
  graphs.push({graph,unitId:u.id,documentId:task.options.strategy==='branches'?u.citations[0].documentId:null,phaseId:phase.id});record.sections.push({id:phase.id,runId:phase.id,title:u.title,pages:[...new Set(u.citations.map(c=>c.page))],citations:u.citations,generatedIds:[]});
  const pending=new Set(record.semanticPlan.units.filter(v=>v.status!=='completed').flatMap(v=>v.citations.map(c=>c.documentId+':'+c.page)));
  for(const d of documents){d.processedPages=d.surveyedPages.filter(p=>!pending.has(d.id+':'+p));d.status=d.processedPages.length===d.pageCount?'completed':'surveyed';}save();
 }
 const top=overview(),nodes=[...top.nodes,...graphs.flatMap(v=>v.graph.nodes)],edges=[...top.edges,...graphs.flatMap(v=>[...v.graph.edges,{from:v.documentId?'doc'+documents.findIndex(d=>d.id===v.documentId):'lecture_root',to:v.graph.nodes[0].id,kind:'hierarchy',label:''}])];
 if(record.structureReview?.status!=='completed'){
  task.inFlight={key:'structure-review',mayHaveCharged:true};save();record.structureReview=await require('./ai-structure-review.cjs').run({input:{title:task.title,nodes:nodes.map(n=>({id:n.id,title:n.title,brief:n.brief||'',topic:n.topic||'',excerpt:n.text.slice(0,320)})),relations:edges},studentProfile:task.studentProfile,config,fetchImpl:fetch,signal,onStage:stage,onUpdate:a=>{record.structureReview=a;save();}});delete task.inFlight;
 }
 const result={overview:top,sections:graphs,structurePlan:record.structureReview?.status==='completed'?record.structureReview.plan:null,record};store.write(task.id,result,'result.json');task.status='completed';record.status='completed';task.stage=record.runs.some(r=>['partial','failed'].includes(r.inspection?.sectionReview?.status))?'生成完成；部分节点分节待检查，可查看过程后加入导图':'生成完成，结果已保存，可加入导图';task.completedAt=Date.now();delete task.inFlight;save();
}
process.on('message',async message=>{
 if(message.type==='cancel'){controller.abort();return;}if(message.type!=='start'||task)return;
 config=message.config;parentInstance=message.instance;store=create(message.root);task=store.read(message.id);if(!task)return process.exit(1);chat=require('./ai-chat.cjs').createService({getConfig:()=>config,getStudentProfile:()=>task.studentProfile});
 try{await run();}catch(e){task.status=signal.aborted?(process.connected?'stopped':'interrupted'):'failed';task.record.status=task.status;task.error=String(e.message).replaceAll(config.apiKey,'[密钥已隐藏]').slice(0,1200);task.stage=task.status==='interrupted'?'服务中断，已完成阶段保留':'任务已停止或未完成';try{save();}catch{}}
 finally{finished=true;chat.dispose();process.send?.({type:'finished'});process.disconnect?.();}
});
process.on('disconnect',()=>{if(!finished)controller.abort();});
