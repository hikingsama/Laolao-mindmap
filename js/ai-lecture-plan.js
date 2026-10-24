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
   if(!value || !['extract','merge'].includes(value.stage) || !Array.isArray(value.documents) || !value.documents.length)fail('课件整理任务无效');
   const ids=new Set(),documents=value.documents.map(d=>{
     if(!d || !validId(d.id) || ids.has(d.id) || typeof d.name!=='string' || !d.name.trim() || d.name.length>255 || !Number.isSafeInteger(d.pageCount) || d.pageCount<1)fail('课件文档信息无效');
     ids.add(d.id);return{id:d.id,name:d.name,pageCount:d.pageCount};
   });
   const result={stage:value.stage,strategy:value.strategy==='fusion'?'fusion':'branches',documents};
   let size=0;const citationPages=new Set();
   if(value.stage==='extract'){
     if(documents.length!==1)fail('每批页面应来自同一份讲义，请分别处理后再汇总');
     if(!Array.isArray(value.pages) || !value.pages.length)fail('请提供本批课件页面');
     if(value.topicHints!==undefined){if(!Array.isArray(value.topicHints) || value.topicHints.length>40 || value.topicHints.some(t=>typeof t!=='string' || t.length>80))fail('课件主题提示无效');result.topicHints=value.topicHints;}
     result.pages=value.pages.map(p=>{
       citations([p],{documents});
       if(typeof p.text!=='string' || p.text.length>24000 || !Number.isSafeInteger(p.part) || !Number.isSafeInteger(p.parts) || p.part<1 || p.parts<p.part)fail('课件页面文字或分段无效');
       size+=p.text.length;citationPages.add(p.documentId+':'+p.page);
       return{documentId:p.documentId,page:p.page,text:p.text,part:p.part,parts:p.parts,visual:!!p.visual};
     });
   }else{
     if(!Array.isArray(value.fragments) || !value.fragments.length)fail('请提供已整理的章节结果');
     result.fragments=value.fragments.map(f=>{
       if(!f || !Array.isArray(f.nodes) || !f.nodes.length || f.nodes.length>40)fail('章节结果无效');
       const nodes=f.nodes.map(n=>{
         if(typeof n.title!=='string' || typeof n.text!=='string' || n.text.length>12000)fail('章节摘要正文无效');
         size+=n.text.length+n.title.length;
         const refs=citations(n.citations,{documents});for(const c of refs)citationPages.add(c.documentId+':'+c.page);
         return{...(typeof n.brief==='string'?{brief:n.brief.slice(0,280)}:{}),...(typeof n.topic==='string' && n.topic.length<=80?{topic:n.topic}:{}),title:n.title,text:n.text,origin:n.origin==='supplement'?'supplement':'source',citations:refs,excerpted:!!n.excerpted};
       });
       return{title:typeof f.title==='string'?f.title.slice(0,160):'',nodes};
     });
   }
   if(size>60000)fail('单批课件输入过长，请分批处理');
   return{value:result,normalization:{outline:true,documents,citationPages,requireCitations:true}};
 }
 function compact(graph){return{title:graph.title || graph.nodes[0]?.title || '',nodes:graph.nodes.map(n=>({title:n.title,...(n.brief?{brief:n.brief}:{}),...(n.topic?{topic:n.topic}:{}),text:n.text.slice(0,180),origin:n.origin,citations:n.citations || [],excerpted:n.text.length>180}))};}
 function groups(fragments,max=20000){
   const out=[];let group=[],bytes=0;
   for(const fragment of fragments){
     const count=JSON.stringify(fragment).length;
     if(count>max){for(let i=0;i<fragment.nodes.length;i+=4){const part={...fragment,nodes:fragment.nodes.slice(i,i+4)};out.push([part]);}continue;}
     if(group.length && bytes+count>max){out.push(group);group=[];bytes=0;}group.push(fragment);bytes+=count;
   }if(group.length)out.push(group);return out;
 }
 const api={citations,task,compact,groups};
 if(typeof module==='object' && module.exports)module.exports=api;else root.MMAILecturePlan=api;
})(typeof window==='object'?window:globalThis);
