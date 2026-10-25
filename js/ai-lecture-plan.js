(function(root){
 'use strict';
 const validId=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,60}$/.test(id);
 const fail=message=>{throw new Error(message);};
 function citations(raw,options={}){
   if(raw===undefined)raw=[];
   if(!Array.isArray(raw) || raw.length>2000)fail('课件出处格式无效');
   const docs=options.documents,allowed=options.citationPages,seen=new Set(),out=[];
   for(const c of raw){
     if(!c || !validId(c.documentId) || !Number.isSafeInteger(c.page) || c.page<1)fail('课件出处必须包含文档编号和有效页码');
     const doc=docs?.find(d=>d.id===c.documentId);
     if(docs && (!doc || c.page>doc.pageCount))fail('课件出处引用了不存在的文档或页码');
     const key=c.documentId+':'+c.page;
     if(allowed && !allowed.has(key))fail('课件出处超出了本阶段实际提供的页面');
     if(!seen.has(key)){seen.add(key);out.push({documentId:c.documentId,page:c.page});}
   }
   return out;
 }
 function task(value){
   if(!value || !['survey','plan','extract','merge'].includes(value.stage) || !Array.isArray(value.documents) || !value.documents.length)fail('课件整理任务无效');
   const ids=new Set(),documents=value.documents.map(d=>{
     if(!d || !validId(d.id) || ids.has(d.id) || typeof d.name!=='string' || !d.name.trim() || d.name.length>255 || !Number.isSafeInteger(d.pageCount) || d.pageCount<1)fail('课件文档信息无效');
     ids.add(d.id);return{id:d.id,name:d.name,pageCount:d.pageCount};
   });
   const result={stage:value.stage,strategy:value.strategy==='fusion'?'fusion':'branches',documents};
   let size=0;const citationPages=new Set();
   if(value.stage==='plan'){
     result.index=contentIndex(value.index,documents);
     if(JSON.stringify(result.index).length>200000)fail('课件全文索引过大，请按课程主题减少本次材料；索引已保留，未按页切断生成');
     return{value:result,normalization:{lectureStage:'plan',index:result.index,documents,strategy:result.strategy}};
   }
   if(value.stage==='extract' || value.stage==='survey'){
     if(value.stage==='survey' && documents.length!==1)fail('课件通览的一次传输应来自同一份讲义');
     if(!Array.isArray(value.pages) || !value.pages.length)fail('请提供本批课件页面');
     if(value.topicHints!==undefined){if(!Array.isArray(value.topicHints) || value.topicHints.length>40 || value.topicHints.some(t=>typeof t!=='string' || t.length>80))fail('课件主题提示无效');result.topicHints=value.topicHints;}
     result.pages=value.pages.map(p=>{
       citations([p],{documents});
       if(typeof p.text!=='string' || p.text.length>24000 || !Number.isSafeInteger(p.part) || !Number.isSafeInteger(p.parts) || p.part<1 || p.parts<p.part)fail('课件页面文字或分段无效');
       size+=p.text.length;citationPages.add(p.documentId+':'+p.page);
       return{documentId:p.documentId,page:p.page,text:p.text,part:p.part,parts:p.parts,visual:!!p.visual};
     });
     if(value.unit!==undefined)result.unit=unitContext(value.unit);
     if(value.contextFragments!==undefined){
       if(value.stage!=='extract' || !Array.isArray(value.contextFragments) || value.contextFragments.length>2000)fail('课件依赖前文无效');
       result.contextFragments=value.contextFragments.map(f=>{
         if(!f || !Array.isArray(f.nodes) || !f.nodes.length || f.nodes.length>40)fail('课件依赖前文节点无效');
         return{title:string(f.title,160,'前文标题'),nodes:f.nodes.map(n=>{
           if(typeof n.text!=='string' || n.text.length>20000)fail('课件依赖前文正文无效');
           const refs=citations(n.citations,{documents});for(const c of refs)citationPages.add(c.documentId+':'+c.page);size+=n.text.length;
           return{title:string(n.title,160,'前文节点标题'),text:n.text,citations:refs,origin:n.origin==='supplement'?'supplement':'source'};
         })};
       });
     }
   }else{
     if(!Array.isArray(value.fragments) || !value.fragments.length)fail('请提供已整理的章节结果');
     result.fragments=value.fragments.map(f=>{
       if(!f || !Array.isArray(f.nodes) || !f.nodes.length || f.nodes.length>40)fail('章节结果无效');
       const nodes=f.nodes.map(n=>{
         if(typeof n.title!=='string' || typeof n.text!=='string' || n.text.length>20000)fail('章节正文无效');
         size+=n.text.length+n.title.length;
         const refs=citations(n.citations,{documents});for(const c of refs)citationPages.add(c.documentId+':'+c.page);
         return{...(typeof n.brief==='string'?{brief:n.brief.slice(0,280)}:{}),...(typeof n.topic==='string' && n.topic.length<=80?{topic:n.topic}:{}),title:n.title,text:n.text,origin:n.origin==='supplement'?'supplement':'source',citations:refs,excerpted:!!n.excerpted};
       });
       return{title:typeof f.title==='string'?f.title.slice(0,160):'',nodes};
     });
   }
   if(size>60000)fail('课件内容单元与依赖前文超过60000字符，请按完整子论证调整材料；未截断正文');
   return{value:result,normalization:value.stage==='survey'?{lectureStage:'survey',documents,citationPages}:{outline:true,documents,citationPages,requireCitations:true,...(result.unit?{semanticUnit:{...result.unit,citations:citations(result.pages,{documents})}}: {})}};
 }
 function string(value,max,label){if(typeof value!=='string' || !value.trim() || value.length>max)fail('课件'+label+'无效');return value.trim();}
 function unitContext(value){
   if(!value || !validId(value.id))fail('课件知识单元编号无效');
   const out={id:value.id,title:string(value.title,160,'单元标题'),topic:string(value.topic,80,'主题'),goal:string(value.goal,1500,'整理范围')};
   for(const key of ['previous','next']){if(value[key]!==undefined){if(!Array.isArray(value[key]) || value[key].length>3)fail('课件前后文无效');out[key]=value[key].map(v=>({title:string(v.title,160,'上下文标题'),goal:string(v.goal,1500,'上下文范围')}));}}
   return out;
 }
 function contentIndex(raw,documents){
   if(!Array.isArray(raw) || !raw.length || raw.length>2000)fail('课件全文索引无效');
   const seen=new Set();return raw.map(u=>{
     if(!u || !validId(u.id) || seen.has(u.id))fail('课件索引编号重复或无效');seen.add(u.id);
     if(typeof u.continuesBefore!=='boolean' || typeof u.continuesAfter!=='boolean')fail('课件跨页衔接标记应为布尔值');
     const refs=citations(u.citations,{documents});if(!refs.length)fail('课件索引缺少出处');
     return{id:u.id,title:string(u.title,160,'索引标题'),topic:string(u.topic,80,'索引主题'),key:string(u.key,240,'内容标识'),scope:string(u.scope,1000,'内容范围'),continuesBefore:!!u.continuesBefore,continuesAfter:!!u.continuesAfter,citations:refs};
   });
 }
 function parseStage(reply,options){
   let raw;try{raw=JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{fail('课件通览或主题计划不是有效JSON');}
   if(!Array.isArray(raw?.units) || !raw.units.length || raw.units.length>(options.lectureStage==='survey'?80:2000))fail('课件内容单元清单无效');
   if(options.lectureStage==='survey'){
     const units=contentIndex(raw.units.map((u,i)=>({...u,id:'u'+(i+1)})),options.documents),covered=new Set();
     for(const u of units)for(const c of citations(u.citations,options))covered.add(c.documentId+':'+c.page);
     if([...options.citationPages].some(p=>!covered.has(p)))fail('课件通览遗漏了本次提供的页面，未继续生成');
     return{units};
   }
   const lookup=new Map(options.index.map(u=>[u.id,u])),used=new Set(),ids=new Set();
   const units=raw.units.map(u=>{
     const normalized=unitContext(u);if(ids.has(u.id))fail('课件主题计划单元编号重复');
     if(!Array.isArray(u.sourceIds) || !u.sourceIds.length || u.sourceIds.length>2000)fail('课件主题计划缺少原文索引');
     for(const id of u.sourceIds){if(!lookup.has(id) || used.has(id))fail('课件主题计划引用了不存在或重复分配的索引');used.add(id);}
     if(!Array.isArray(u.dependsOn) || u.dependsOn.some(id=>!ids.has(id)))fail('课件主题计划依赖应引用前面的单元');
     const refs=citations(u.sourceIds.flatMap(id=>lookup.get(id).citations),options);
     if(options.strategy==='branches' && new Set(refs.map(c=>c.documentId)).size>1)fail('按讲义分支的单元不能混合不同文件');
     ids.add(u.id);return{...normalized,sourceIds:[...u.sourceIds],dependsOn:[...new Set(u.dependsOn)],citations:refs};
   });
   if(used.size!==lookup.size)fail('课件主题计划遗漏了原文索引，未按不完整计划生成');
   return{units};
 }
 function bindUnit(graph,unit){
   const covered=new Set(graph.nodes.flatMap(n=>n.citations || []).map(c=>c.documentId+':'+c.page));
   if(unit.citations.some(c=>!covered.has(c.documentId+':'+c.page)))fail('课件知识单元缺少计划中的页面出处');
   return{...graph,nodes:graph.nodes.map(n=>({...n,topic:unit.topic}))};
 }
 // Kept for older callers: a brief is navigation metadata, never a replacement for the body.
 function compact(graph){return{title:graph.title || graph.nodes[0]?.title || '',nodes:graph.nodes.map(n=>({title:n.title,...(n.brief?{brief:n.brief}:{}),...(n.topic?{topic:n.topic}:{}),text:n.text,origin:n.origin,citations:n.citations || [],excerpted:false}))};}
 function groups(fragments,max=20000){
   const out=[];let group=[],bytes=0;
   for(const fragment of fragments){
     const count=JSON.stringify(fragment).length;
     if(count>max){if(group.length){out.push(group);group=[];bytes=0;}let part=[];for(const node of fragment.nodes){if(part.length && JSON.stringify({...fragment,nodes:[...part,node]}).length>max){out.push([{...fragment,nodes:part}]);part=[];}part.push(node);}if(part.length)out.push([{...fragment,nodes:part}]);continue;}
     if(group.length && bytes+count>max){out.push(group);group=[];bytes=0;}group.push(fragment);bytes+=count;
   }if(group.length)out.push(group);return out;
 }
 const api={citations,task,compact,groups,parseStage,contentIndex,unitContext,bindUnit};
 if(typeof module==='object' && module.exports)module.exports=api;else root.MMAILecturePlan=api;
})(typeof window==='object'?window:globalThis);
