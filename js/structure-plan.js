(function(root){
 'use strict';
 const bad=s=>{throw new Error('结构复核：'+s);},safe=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !['__proto__','constructor','prototype'].includes(id);
 const str=(v,max,label)=>{if(typeof v!=='string' || !v.trim() || v.length>max)bad(label+'无效');return v.trim();};
 function input(v){
   if(!v || !Array.isArray(v.nodes) || !v.nodes.length || v.nodes.length>1200)bad('节点数量应为1–1200');const ids=new Set();
   const nodes=v.nodes.map(n=>{if(!safe(n?.id) || ids.has(n.id))bad('节点编号无效或重复');ids.add(n.id);return{id:n.id,title:str(n.title,160,'标题'),brief:typeof n.brief==='string'?n.brief.slice(0,280):'',topic:typeof n.topic==='string'?n.topic.slice(0,80):'',...(typeof n.parentId==='string'?{parentId:n.parentId}:{}),...(typeof n.excerpt==='string'?{excerpt:n.excerpt.slice(0,320)}:{})};});
   const catalog=Array.isArray(v.catalog)?v.catalog.slice(0,12).filter(s=>typeof s==='string').map(s=>s.slice(0,1400)):[];
   const relations=(Array.isArray(v.relations)?v.relations:[]).slice(0,2400).filter(e=>ids.has(e?.from) && ids.has(e?.to) && e.from!==e.to).map(e=>({from:e.from,to:e.to,kind:typeof e.kind==='string'?e.kind.slice(0,40):'relation',label:typeof e.label==='string'?e.label.slice(0,40):''}));
   const value={title:typeof v.title==='string'?v.title.slice(0,160):'知识结构',nodes,catalog,relations};if(JSON.stringify(value).length>250000)bad('输入过大，请分开复核');return value;
 }
 function validate(v,nodes){
   const expected=new Set(nodes.map(n=>n.id)),seen=new Set(),groups=new Set();
   function refs(a){if(!Array.isArray(a) || a.length>1200)bad('归属列表无效');return a.map(id=>{if(!expected.has(id) || seen.has(id))bad('存在未知、重复归属的节点');seen.add(id);return id;});}
   function group(g,child=false){if(!g || !safe(g.id) || groups.has(g.id))bad('模块编号无效或重复');groups.add(g.id);const nodeIds=refs(g.nodeIds),children=child?[]:(g.children || []);if(!Array.isArray(children) || children.length>10 || child && g.children?.length)bad('只允许模块和子主题两级');const parsed=children.map(c=>group(c,true)),all=[...nodeIds,...parsed.flatMap(c=>c.nodeIds)];if(!all.length || !all.includes(g.nodeId))bad('模块中心必须属于本模块');return{id:g.id,title:str(g.title,80,'模块名称'),summary:str(g.summary,280,'模块概述'),nodeId:g.nodeId,nodeIds,children:parsed};}
   if(!v?.root || !Array.isArray(v.modules) || v.modules.length>12)bad('总体结构无效');const rootIds=refs(v.root.nodeIds);if(!rootIds.includes(v.root.nodeId))bad('总览中心无效');const modules=v.modules.map((g,i)=>({...group(g),order:i+1}));if(seen.size!==expected.size)bad('遗漏了原知识节点');return{root:{nodeId:v.root.nodeId,title:str(v.root.title,160,'总览标题'),summary:str(v.root.summary,280,'总览概述'),nodeIds:rootIds},modules,reason:str(v.reason,1600,'调整理由'),orderReason:typeof v.orderReason==='string' && v.orderReason.trim()?str(v.orderReason,1600,'排序理由'):''};
 }
 const members=g=>[...g.nodeIds,...(g.children || []).flatMap(c=>c.nodeIds)];
 const clone=v=>JSON.parse(JSON.stringify(v));
 function apply(map,plan,scope){
   const sourceIds=[...plan.root.nodeIds,...plan.modules.flatMap(members)],ids=new Set(sourceIds),byId=new Map(map.nodes.map(n=>[n.id,n]));if(sourceIds.some(id=>!byId.has(id)))bad('节点已删除，请重新复核');
   const parent=new Map(),centers=new Set([plan.root.nodeId]);
   for(const id of plan.root.nodeIds)if(id!==plan.root.nodeId)parent.set(id,plan.root.nodeId);
   for(const m of plan.modules){centers.add(m.nodeId);parent.set(m.nodeId,plan.root.nodeId);for(const id of m.nodeIds)if(id!==m.nodeId)parent.set(id,m.nodeId);for(const c of m.children){centers.add(c.nodeId);if(c.nodeId!==m.nodeId)parent.set(c.nodeId,m.nodeId);for(const id of c.nodeIds)if(id!==c.nodeId && id!==m.nodeId)parent.set(id,c.nodeId);}
     for(const id of members(m)){const n=byId.get(id);n.topic=m.title;n.topicScope=scope;n.structureScope=scope;delete n.structureRoot;}}
   for(const id of plan.root.nodeIds){const n=byId.get(id);n.structureScope=scope;n.structureRoot=id===plan.root.nodeId;delete n.topic;delete n.topicScope;}
   for(const id of ids){const n=byId.get(id);if(parent.has(id))n.layoutParent=parent.get(id);else delete n.layoutParent;}
   // Hierarchy is editable structure; inference/application/reference edges retain their meaning.
   map.edges=(map.edges || []).filter(e=>!(ids.has(e.from.node) && ids.has(e.to.node) && (['hierarchy','contains'].includes(e.kind) || e.lectureStructure || e.structureReviewId)));
   for(const e of map.edges)if(!ids.has(e.from.node) && ids.has(e.to.node) && e.label==='整理')e.to={...e.to,node:plan.root.nodeId};
   for(const [to,from] of parent){if(from===to)continue;map.edges.push({id:'sr_'+scope+'_'+to,from:{node:from,side:'e'},to:{node:to,side:'w'},kind:'hierarchy',label:'',dir:'fwd',structureReviewId:scope});}
   for(const [key,s]of Object.entries(map.structures || {}))if(s.sourceIds?.some(id=>ids.has(id)))delete map.structures[key];
   (map.structures ||= {})[scope]={plan:clone(plan),sourceIds};
 }
 function reviewed(map,ids=map.nodes.map(n=>n.id)){
   const live=new Set(ids),result=[];for(const [scope,s] of Object.entries(map.structures || {})){if(!s?.plan?.root)continue;const plan=s.plan,rootIds=plan.root.nodeIds.filter(id=>live.has(id)),modules=plan.modules.map(m=>({...m,nodeIds:m.nodeIds.filter(id=>live.has(id)),children:m.children.map(c=>({...c,nodeIds:c.nodeIds.filter(id=>live.has(id))})).filter(c=>c.nodeIds.length)})).filter(m=>members(m).length);if(!rootIds.length && !modules.length)continue;
     const pick=(id,a)=>live.has(id)?id:a[0];for(const m of modules){m.nodeId=pick(m.nodeId,members(m));for(const c of m.children)c.nodeId=pick(c.nodeId,c.nodeIds);}const rootId=pick(plan.root.nodeId,[...rootIds,...modules.flatMap(members)]);result.push({scope,root:{...plan.root,nodeId:rootId,nodeIds:rootIds},modules});}return result;
 }
 function describe(map,d){
   const entries=reviewed(map,d.nodes.map(n=>n.id));if(!entries.length)return d;const assigned=new Set(),groups=[];let center=d.center,rootView=null;const support=[...d.support];
   for(const entry of entries){const {scope,root,modules}=entry;if(!rootView && d.byId.has(root.nodeId)){center=d.byId.get(root.nodeId);rootView=root;}for(const id of root.nodeIds){assigned.add(id);if(id!==center?.id && d.byId.has(id) && !support.some(n=>n.id===id))support.push(d.byId.get(id));}
     for(const m of modules){const nodes=members(m).map(id=>d.byId.get(id)).filter(Boolean);nodes.forEach(n=>assigned.add(n.id));groups.push({key:scope+'::'+m.id,title:m.title,summary:m.summary,reviewed:true,...(Number.isInteger(m.order)?{order:m.order}:{}),nodes,center:d.byId.get(m.nodeId),subgroups:m.children.map(c=>({key:scope+'::'+c.id,title:c.title,summary:c.summary,nodeIds:c.nodeIds,centerId:c.nodeId}))});}}
   for(const id of assigned){const n=d.byId.get(id);if(n?.layoutParent && d.byId.has(n.layoutParent))d.parents.set(id,n.layoutParent);}if(center)d.parents.delete(center.id);
   const remaining=d.groups.map(g=>({...g,nodes:g.nodes.filter(n=>!assigned.has(n.id))})).filter(g=>g.nodes.length).map(g=>({...g,center:g.nodes.includes(g.center)?g.center:g.nodes[0]}));
   const projected=[...groups,...remaining].map(g=>{const nodes=g.nodes.filter(n=>n.id!==center?.id);return{...g,nodes,center:nodes.includes(g.center)?g.center:nodes[0],subgroups:(g.subgroups || []).map(c=>({...c,nodeIds:c.nodeIds.filter(id=>id!==center?.id)})).filter(c=>c.nodeIds.length).map(c=>({...c,centerId:c.nodeIds.includes(c.centerId)?c.centerId:c.nodeIds[0]}))};}).filter(g=>g.nodes.length),grouped=new Set(projected.flatMap(g=>g.nodes.map(n=>n.id)));
   return{...d,center,rootView,groups:projected,support:support.filter(n=>n.id!==center?.id && !grouped.has(n.id))};
 }
 function remap(map,mapping){for(const s of Object.values(map.structures || {})){if(!s?.plan)continue;const convert=g=>{g.nodeId=mapping.get(g.nodeId);g.nodeIds=g.nodeIds.map(id=>mapping.get(id)).filter(Boolean);for(const c of g.children || [])convert(c);};convert(s.plan.root);s.plan.modules.forEach(convert);s.sourceIds=s.sourceIds.map(id=>mapping.get(id)).filter(Boolean);}}
 const api={input,validate,apply,members,reviewed,describe,remap};if(typeof module==='object' && module.exports)module.exports=api;else root.MMStructurePlan=api;
})(typeof window==='object'?window:globalThis);
