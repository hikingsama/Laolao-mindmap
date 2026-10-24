(function(root){
 'use strict';
 const steps=[
  ['通览结构','看目录、学习目标和模块概览，知道这部分要解决什么。'],
  ['精读提炼','读原讲义，提炼概念、适用条件、结论和代表例子。'],
  ['串联关系','说明前后依赖、异同和联系，补出自己不明白的连接。'],
  ['主动复现','暂时合上讲义，用自己的话复述、画图，或复现关键推导。'],
  ['应用自检','用小题、案例或反例检查理解，回原讲义或教材核对并处理疑点。']
 ];
 const normalize=v=>({checked:steps.map((_,i)=>v?.checked?.[i]===true),expanded:v?.expanded!==false});
 const ids=g=>[...new Set((g.nodes?g.nodes.map(n=>n.id):g.nodeIds || []))].sort();
 const records=m=>Array.isArray(m.moduleLearning?.records)?m.moduleLearning.records.filter(r=>r && Array.isArray(r.nodeIds) && r.nodeIds.length && r.nodeIds.every(id=>typeof id==='string')):[];
 const find=(map,g)=>{const key=JSON.stringify(ids(g));return records(map).find(r=>JSON.stringify(r.nodeIds)===key);};
 const state=(map,g)=>normalize(find(map,g));
 const progress=(map,g)=>state(map,g).checked.filter(Boolean).length;
 function update(map,g,patch){
  if(!g.reviewed || !ids(g).length || !patch)return false;
  const value=state(map,g);if(typeof patch.expanded==='boolean')value.expanded=patch.expanded;
  if(Array.isArray(patch.checked))value.checked=normalize(patch).checked;
  let r=find(map,g);if(r && JSON.stringify(normalize(r))===JSON.stringify(value))return true;
  if(!r){if(!map.moduleLearning || typeof map.moduleLearning!=='object' || Array.isArray(map.moduleLearning))map.moduleLearning={version:1,records:[]};if(!Array.isArray(map.moduleLearning.records))map.moduleLearning.records=[];r={nodeIds:ids(g)};map.moduleLearning.records.push(r);}
  Object.assign(r,value);return true;
 }
 function summary(map,groups){const modules=groups.filter(g=>g.reviewed);return{modules:modules.length,completed:modules.filter(g=>progress(map,g)===steps.length).length,checked:modules.reduce((n,g)=>n+progress(map,g),0),total:modules.length*steps.length};}
 function remap(map,mapping){for(const r of records(map))r.nodeIds=r.nodeIds.map(id=>mapping.get(id)).filter(Boolean).sort();}
 // Canvas cards are attached UI, not extra knowledge nodes or saved coordinates.
 const overlap=(a,b,gap=8)=>a.x<b.x+b.w+gap && a.x+a.w+gap>b.x && a.y<b.y+b.h+gap && a.y+a.h+gap>b.y;
 function reserve(map,groups,center){const extra={};for(const g of groups.filter(g=>g.reviewed))extra[g.center.id]={w:260,h:(g.center.aiEntry?192:36)+224};if(center && groups.some(g=>g.reviewed) && !extra[center.id])extra[center.id]={w:240,h:(center.aiEntry?192:36)+60};return extra;}
 function canvas(map,boxes,groups,center){
  const modules=groups.filter(g=>g.reviewed),cards=[],occupied=[...boxes.values()].map(b=>({...b,h:b.h+(b.n?.aiEntry?180:28)}));
  function place(anchor,w,h,offset){const base={x:anchor.x,y:anchor.y+anchor.h+offset,w,h},candidates=[base,{...base,x:anchor.x+anchor.w+32},{...base,x:anchor.x-w-32}];let rect=candidates.find(c=>!occupied.some(b=>overlap(c,b)));
   if(!rect){rect={...base};for(let i=0;i<occupied.length+2;i++){const hits=occupied.filter(b=>overlap(rect,b));if(!hits.length)break;rect.y=Math.max(...hits.map(b=>b.y+b.h))+24;}}
   occupied.push(rect);return rect;}
  for(const g of modules){const anchor=boxes.get(g.center.id);if(!anchor)continue;const value=state(map,g),box=place(anchor,Math.max(260,Math.min(360,anchor.w)),value.expanded?224:44,anchor.n?.aiEntry?192:36);cards.push({kind:'module',key:g.key,anchorId:g.center.id,group:g,learning:{key:g.key,...value},box});}
  const anchor=center && boxes.get(center.id);if(anchor && modules.length && !cards.some(c=>c.anchorId===center.id))cards.push({kind:'summary',anchorId:center.id,summary:summary(map,modules),box:place(anchor,Math.max(240,Math.min(360,anchor.w)),58,anchor.n?.aiEntry?192:36)});
  return cards;
 }
 const api={steps,normalize,state,progress,summary,update,remap,reserve,canvas};if(typeof module==='object' && module.exports)module.exports=api;else root.MMModuleLearning=api;
})(typeof window==='object'?window:globalThis);
