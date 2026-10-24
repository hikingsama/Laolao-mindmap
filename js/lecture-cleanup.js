(function(root){
 'use strict';
 const bodies=new Set(['正在逐页整理；查看生成过程可确认处理范围。','正在逐页整理。','按共同主题整理多份讲义；详细章节可从生成记录展开。','按讲义与章节组织；节点出处可返回原PDF页面。']);
 function placeholder(n){
   if(!n || n.pdf || n.image)return false;
   if(n.lecturePlaceholderText!==undefined)return n.text===n.lecturePlaceholderText;
   const body=String(n.text || '').replace(/^#[^\n]*\n\n/,'').trim();
   return n.layoutRole==='overview' && bodies.has(body) || n.layoutRole==='document' && /^共 \d+ 页；本文件的处理范围见生成过程。$/.test(body);
 }
 function plan(map,{ids=map.nodes.map(n=>n.id),recordId,force=false}={}){
   const scope=new Set(ids),removed=[],replacement={},promoted={};
   for(const r of map.outlineSources || []){
     if(r.mode!=='lecture' || recordId && r.id!==recordId || !force && !['completed','partial'].includes(r.status))continue;
     const nodes=map.nodes.filter(n=>n.outlineSourceId===r.id),trash=nodes.filter(n=>scope.has(n.id) && placeholder(n)),discard=new Set(trash.map(n=>n.id));
     const real=nodes.filter(n=>scope.has(n.id) && !discard.has(n.id) && !n.pdf && !n.image && n.layoutRole!=='document');
     const center=real.find(n=>n.layoutRole==='overview') || real[0];if(!trash.length || !center)continue;
     promoted[r.id]=center.id;for(const n of trash){removed.push(n.id);replacement[n.id]=center.id;}
   }return{removed,replacement,promoted};
 }
 function apply(map,plan,layers=['pos','size','fold','sizing','pdfViews','topicLevels']){
   const gone=new Set(plan.removed);if(!gone.size)return;
   map.nodes=map.nodes.filter(n=>!gone.has(n.id));const live=new Set(map.nodes.map(n=>n.id)),original=map.edges || [],kept=original.filter(e=>!gone.has(e.from.node) && !gone.has(e.to.node)),pairs=new Set(kept.map(e=>e.from.node+'\0'+e.to.node));
   for(const e of original){if(!gone.has(e.from.node) && !gone.has(e.to.node))continue;const from=plan.replacement[e.from.node] || e.from.node,to=plan.replacement[e.to.node] || e.to.node,key=from+'\0'+to;if(from===to || !live.has(from) || !live.has(to) || pairs.has(key))continue;
     const structural=gone.has(e.from.node) && ['hierarchy','contains'].includes(e.kind);
     kept.push({...e,from:{...e.from,node:from},to:{...e.to,node:to},...(structural?{kind:'relation',label:'',lectureStructure:true}:{})});pairs.add(key);
   }map.edges=kept;
   for(const name of layers)if(map[name])for(const id of gone)delete map[name][id];
   for(const n of map.nodes)if(gone.has(n.layoutParent))delete n.layoutParent;
   if(Array.isArray(map.topicGroups))map.topicGroups=map.topicGroups.map(g=>{const nodeIds=g.nodeIds.filter(id=>!gone.has(id));return{...g,nodeIds,centerId:nodeIds.includes(g.centerId)?g.centerId:nodeIds[0]};}).filter(g=>g.nodeIds.length);
 }
 const api={placeholder,plan,apply};if(typeof module==='object' && module.exports)module.exports=api;else root.MMLectureCleanup=api;
})(typeof window==='object'?window:globalThis);
