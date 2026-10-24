(function(root){
 'use strict';
 const structure=typeof module==='object' && module.exports?require('./structure-plan.js'):root.MMStructurePlan,learning=typeof module==='object' && module.exports?require('./module-learning.js'):root.MMModuleLearning;
 const palette=['#527d82','#6c78a1','#ae7958','#7c8d59','#947797','#5b8c79','#a28c50','#8a789b'];
 const overlap=(a,b,gap=0)=>a.x<b.x+b.w+gap && a.x+a.w+gap>b.x && a.y<b.y+b.h+gap && a.y+a.h+gap>b.y;
 const extent=boxes=>{if(!boxes.length)return{x:0,y:0,w:0,h:0};const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return{x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};};
 const title=n=>String(n?.text || '').split('\n').find(s=>s.trim())?.replace(/^#+\s*/,'').trim().slice(0,100) || '未命名主题';
 function branch(map,seeds){
   const known=new Set(map.nodes.map(n=>n.id)),ids=new Set(seeds.filter(id=>known.has(id)));
   for(let pass=0;pass<map.nodes.length;pass++){let changed=false;for(const n of map.nodes)if(n.layoutParent && ids.has(n.layoutParent) && !ids.has(n.id)){ids.add(n.id);changed=true;}
     for(const e of map.edges || []){if(['relation','contrast','parallel'].includes(e.kind) && !e.lectureStructure)continue;const from=e.dir==='rev'?e.to.node:e.from.node,to=e.dir==='rev'?e.from.node:e.to.node;if(ids.has(from) && !ids.has(to) && known.has(to)){ids.add(to);changed=true;}}
     if(!changed)break;
   }return ids;
 }
 function describe(map,ids=map.nodes.map(n=>n.id)){
   const wanted=new Set(ids),nodes=map.nodes.filter(n=>wanted.has(n.id)),byId=new Map(nodes.map(n=>[n.id,n])),incoming=new Map(nodes.map(n=>[n.id,[]]));
   for(const e of map.edges || [])if(byId.has(e.from.node) && byId.has(e.to.node) && e.dir!=='rev' && !['contrast','parallel'].includes(e.kind))incoming.get(e.to.node).push(e);
   const parents=new Map();
   for(const n of nodes){const es=incoming.get(n.id),e=es.find(e=>['hierarchy','contains'].includes(e.kind)) || es.find(e=>!['relation'].includes(e.kind)) || es[0],p=byId.has(n.layoutParent)?n.layoutParent:e?.from.node;if(p && p!==n.id)parents.set(n.id,p);}
   for(const n of nodes){const seen=new Set([n.id]);let p=parents.get(n.id);while(p){if(seen.has(p)){parents.delete(n.id);break;}seen.add(p);p=parents.get(p);}}
   const text=nodes.filter(n=>!n.pdf && !n.image && !n.mapLink && n.layoutRole!=='document'),roots=text.filter(n=>!parents.has(n.id));
   const center=text.find(n=>n.aiEntry) || roots.find(n=>n.layoutRole==='overview') || roots[0] || text[0];
   const support=new Set(nodes.filter(n=>n.pdf || n.image || n.mapLink || n.layoutRole==='document').map(n=>n.id));
   const groups=new Map();
   function fallback(n){let id=n.id,p=parents.get(id),seen=new Set([id]);while(p && p!==center?.id && !support.has(p) && !seen.has(p)){seen.add(p);id=p;p=parents.get(p);}return id;}
   for(const n of text){if(n.id===center?.id)continue;if(n.layoutRole==='overview' && !n.topic){support.add(n.id);continue;}const key=n.topic?(n.topicScope || map.id || '')+'::'+n.topic:'branch::'+fallback(n);if(!groups.has(key))groups.set(key,{key,title:n.topic || title(byId.get(fallback(n))),nodes:[]});groups.get(key).nodes.push(n);}
   // Batch overviews remain readable, but are leaves rather than a column of false centers.
   for(const n of text.filter(n=>support.has(n.id))){const next=(map.edges || []).filter(e=>e.from.node===n.id).map(e=>e.to.node),g=[...groups.values()].find(g=>g.nodes.some(v=>next.includes(v.id))) || [...groups.values()][0];if(g){g.nodes.push(n);support.delete(n.id);}}
   for(const g of groups.values()){const members=new Set(g.nodes.map(n=>n.id));g.center=g.nodes.find(n=>n.topic && (!parents.has(n.id) || !members.has(parents.get(n.id)))) || g.nodes[0];}
   const data={nodes,byId,parents,center,groups:[...groups.values()],support:nodes.filter(n=>support.has(n.id))};return structure?.describe(map,data) || data;
 }
 function organize(map,boxes,{ids=map.nodes.map(n=>n.id),fixed=[],scope='manual',origin}={}){
   const locked=new Set(fixed),selected=ids.filter(id=>boxes.has(id) && !locked.has(id)),moving=new Set(selected),d=describe(map,selected),{groups,parents,center,byId}=d;
   if(!selected.length)return{positions:{},colors:{},levels:{},groups:[],ports:{},ids:[]};
   const positions={},colors={},levels={},frames=[],blockedColors=new Set();
   for(const e of map.edges || [])if(moving.has(e.from.node)!==moving.has(e.to.node)){const n=map.nodes.find(n=>n.id===(moving.has(e.from.node)?e.to.node:e.from.node));if(n?.color)blockedColors.add(n.color.toLowerCase());}
   const previous=Array.isArray(map.topicGroups)?map.topicGroups:[],usedColors=new Set();let colorIndex=0;
   const all=describe(map),reserves=learning?.reserve(map,all.groups,all.center) || {},shape=n=>{const b=boxes.get(n.id);return{w:Math.max(b.w,reserves[n.id]?.w || 0),h:b.h+(reserves[n.id]?.h ?? (n.aiEntry?180:36))};};
   const trees=[];
   for(const g of groups){
     const old=previous.find(v=>v.key===g.key || v.title===g.title && v.nodeIds?.some(id=>g.nodes.some(n=>n.id===id))),existing=g.nodes.find(n=>n.color && palette.includes(n.color))?.color;
     let color=old?.color || existing || palette[colorIndex++%palette.length],attempts=0;
     while((blockedColors.has(color.toLowerCase()) || usedColors.has(color)) && attempts++<palette.length)color=palette[colorIndex++%palette.length];usedColors.add(color);
     const members=new Set(g.nodes.map(n=>n.id)),local=new Map(),children=new Map(g.nodes.map(n=>[n.id,[]]));
     for(const n of g.nodes)if(n.id!==g.center.id){let p=parents.get(n.id);if(!members.has(p) || n.layoutRole==='overview')p=g.center.id;local.set(n.id,p);}
     // Choosing a representative must not turn an existing ancestor into its own descendant.
     for(const [id,p] of local){const seen=new Set([id]);let q=p;while(q){if(seen.has(q)){local.set(id,g.center.id);break;}seen.add(q);q=local.get(q);}}
     for(const [id,p] of local)children.get(p)?.push(id);
     const spans=new Map(),widths=[];
     function measure(id,depth){const n=byId.get(id),b=shape(n);widths[depth]=Math.max(widths[depth] || 0,b.w);const kids=children.get(id) || [],h=Math.max(b.h,kids.reduce((v,k)=>v+measure(k,depth+1),0)+Math.max(0,kids.length-1)*80);spans.set(id,h);return h;}
     const h=measure(g.center.id,0),xs=widths.map((_,i)=>widths.slice(0,i).reduce((v,w)=>v+w+180,0));
     function place(id,depth,top){const n=byId.get(id),b=shape(n),kids=children.get(id) || [];positions[id]={x:xs[depth],y:top+(spans.get(id)-b.h)/2};colors[id]=color;const p=local.get(id),edge=(map.edges || []).find(e=>e.from.node===p && e.to.node===id);levels[id]=p?(levels[p] || 0)+(n.layoutParent===p || ['hierarchy','contains'].includes(edge?.kind)?1:0):0;let y=top+(spans.get(id)-kids.reduce((v,k)=>v+spans.get(k),0)-Math.max(0,kids.length-1)*80)/2;for(const k of kids){place(k,depth+1,y);y+=spans.get(k)+80;}}
     place(g.center.id,0,0);trees.push({g,color,h,w:xs.at(-1)+widths.at(-1)});frames.push({id:scope+'::'+frames.length,key:g.key,title:g.title,color,centerId:g.center.id,nodeIds:g.nodes.map(n=>n.id),scope,...(Number.isInteger(g.order)?{order:g.order}:{} )});
   }
   if(center?.topic){const g=frames.find(g=>g.title===center.topic);if(g){colors[center.id]=g.color;g.nodeIds.unshift(center.id);}else{let c=palette.find(c=>!blockedColors.has(c.toLowerCase())) || palette[0];colors[center.id]=c;}}
   const rootBox=center?shape(center):{w:260,h:100},sides={left:[],right:[]},heights={left:0,right:0};
   const ordered=trees.some(t=>Number.isInteger(t.g.order)),split=Math.ceil(trees.length/2);
   for(const [i,t]of (ordered?trees:[...trees].sort((a,b)=>b.h-a.h)).entries()){const side=ordered?(i<split?'left':'right'):(heights.left<heights.right?'left':'right');sides[side].push(t);heights[side]+=t.h+150;}
   if(center){positions[center.id]={x:-rootBox.w/2,y:-rootBox.h/2};levels[center.id]=0;}
   for(const side of ['left','right']){let top=-(heights[side]-150)/2;for(const t of sides[side]){for(const n of t.g.nodes){const p=positions[n.id],b=shape(n);p.x=side==='left'?-rootBox.w/2-240-p.x-b.w:rootBox.w/2+240+p.x;p.y+=top;}top+=t.h+150;}}
   const textBounds=extent(Object.entries(positions).map(([id,p])=>({...p,...shape(byId.get(id))})));let supportX=textBounds.x,supportY=textBounds.y+textBounds.h+220,rowH=0;
   // File size never determines which side of the knowledge tree can be used.
   for(const n of d.support){const b=shape(n);if(supportX>textBounds.x && supportX+b.w>textBounds.x+Math.max(1000,textBounds.w)){supportX=textBounds.x;supportY+=rowH+100;rowH=0;}positions[n.id]={x:supportX,y:supportY};supportX+=b.w+100;rowH=Math.max(rowH,b.h);}
   const localBoxes=selected.map(id=>({...positions[id],...shape(byId.get(id))})),bounds=extent(localBoxes),base=origin || (center?boxes.get(center.id):boxes.get(selected[0]));let dx=base.x+(center?rootBox.w/2:0),dy=base.y+(center?rootBox.h/2:0);
   const obstacles=map.nodes.filter(n=>!moving.has(n.id)).map(n=>{const b=boxes.get(n.id);return b?{...b,...shape(n)}:null;}).filter(Boolean);for(const a of map.annotations || [])if([a.x1,a.y1,a.x2,a.y2].every(Number.isFinite))obstacles.push({x:Math.min(a.x1,a.x2),y:Math.min(a.y1,a.y2),w:Math.abs(a.x2-a.x1),h:Math.abs(a.y2-a.y1)});
   for(let guard=0;guard<obstacles.length+2;guard++){const area={x:bounds.x+dx,y:bounds.y+dy,w:bounds.w,h:bounds.h},hits=obstacles.filter(b=>overlap(area,b,80));if(!hits.length)break;dy=Math.max(...hits.map(b=>b.y+b.h))+100-bounds.y;}
   for(const p of Object.values(positions)){p.x+=dx;p.y+=dy;}
   const ports={},slots=new Map();
   for(const e of map.edges || [])if(moving.has(e.from.node) && moving.has(e.to.node))for(const end of ['from','to']){const own=e[end].node,other=e[end==='from'?'to':'from'].node,a={...positions[own],...shape(byId.get(own))},b={...positions[other],...shape(byId.get(other))},dx=b.x+b.w/2-a.x-a.w/2,dy=b.y+b.h/2-a.y-a.h/2,side=Math.abs(dx)>a.w/2?(dx<0?'w':'e'):(dy<0?'n':'s'),key=own+':'+side;if(!slots.has(key))slots.set(key,[]);slots.get(key).push({e,end,side,order:side==='w'||side==='e'?b.y:b.x});}
   for(const [key,list] of slots){list.sort((a,b)=>a.order-b.order || String(a.e.id).localeCompare(String(b.e.id)));const [node,side]=[key.slice(0,key.lastIndexOf(':')),key.slice(-1)],reserved=(map.edges || []).flatMap(e=>moving.has(e.from.node) && moving.has(e.to.node)?[]:[e.from,e.to]).filter(p=>p.node===node && p.side===side).map(p=>p.offset ?? .5);for(let i=0;i<list.length;i++){const v=list[i];let offset=.12+.76*(i+1)/(list.length+1);for(let j=1;j<=128 && reserved.some(n=>Math.abs(n-offset)<.18/(list.length+reserved.length+1));j++)offset=.06+.88*((j*37)%129)/129;reserved.push(offset);(ports[v.e.id] ||= {})[v.end]={...v.e[v.end],side:v.side,offset};}}
   const groupFrames=frames.map(g=>{const b=extent(g.nodeIds.map(id=>({...positions[id],...shape(byId.get(id))})));return{id:g.id,key:g.key,x:b.x-28,y:b.y-52,w:Math.max(100,b.w+56),h:Math.max(80,b.h+80)};});
   return{positions,colors,levels,groups:frames,groupFrames,reserves,sizes:Object.fromEntries([...boxes].map(([id,b])=>[id,{w:b.w,h:b.h}])),ports,centerId:center?.id,ids:selected};
 }
 function apply(map,plan){
   const ids=new Set(plan.ids);for(const n of map.nodes)if(ids.has(n.id)){if(plan.positions[n.id])(map.pos ||= {})[n.id]={...plan.positions[n.id]};if(plan.colors[n.id])n.color=plan.colors[n.id];}
   const levels=(map.topicLevels ||= {});for(const id of ids)if(Number.isInteger(plan.levels[id]))levels[id]=plan.levels[id];
   const previous=Array.isArray(map.topicGroups)?map.topicGroups:[];
   const incoming=plan.groups.map(g=>{const old=previous.find(v=>v.key===g.key && v.nodeIds.some(id=>g.nodeIds.includes(id)) && v.nodeIds.every(id=>ids.has(id)));return{...g,nodeIds:[...g.nodeIds],frameId:old?.frameId || old?.id || g.id};});
   map.topicGroups=[...previous.map(g=>{const nodeIds=(Array.isArray(g.nodeIds)?g.nodeIds:[]).filter(id=>!ids.has(id));return{...g,nodeIds,centerId:nodeIds.includes(g.centerId)?g.centerId:nodeIds[0]};}).filter(g=>g.nodeIds.length),...incoming];
   for(const e of map.edges || [])if(plan.ports?.[e.id])Object.assign(e,plan.ports[e.id]);
   // Reuse real spatial frames, keeping distant expansions in separate physical regions.
   if(plan.groupFrames){
     const keys=new Set(map.topicGroups.map(g=>g.frameId || g.id)),groups=(map.groups ||= []);
     for(let i=groups.length-1;i>=0;i--)if(groups[i].topicRegion && !keys.has(groups[i].topicRegion))groups.splice(i,1);
     for(const topic of map.topicGroups){
       const frameId=topic.frameId || topic.id;let group=groups.find(g=>g.topicRegion===frameId),rect=plan.groupFrames.find(r=>r.id===topic.id);
       if(!rect && !group)continue;
       const items=topic.nodeIds.map(id=>{const n=map.nodes.find(n=>n.id===id),p=map.pos?.[id],z=map.size?.[id] || plan.sizes?.[id];return p && z?{...p,h:z.h+(plan.reserves?.[id]?.h ?? (n?.aiEntry?180:36)),w:Math.max(z.w,plan.reserves?.[id]?.w || 0)}:null;});
       if(items.length && items.every(Boolean)){const b=extent(items);rect={x:b.x-28,y:b.y-52,w:Math.max(100,b.w+56),h:Math.max(80,b.h+80)};}
       if(!rect)continue;
       if(group)Object.assign(group,{x:rect.x,y:rect.y,w:rect.w,h:rect.h,...(Number.isInteger(topic.order)?{moduleOrder:topic.order}:{moduleOrder:null})});
       else groups.push({id:'topic-frame-'+frameId,title:topic.title,x:rect.x,y:rect.y,w:rect.w,h:rect.h,color:topic.color,opacity:6,width:1,topicKey:topic.key,topicRegion:frameId,...(Number.isInteger(topic.order)?{moduleOrder:topic.order}:{})});
     }
   }

 }
 const api={organize,apply,branch,describe,title,extent,palette};if(typeof module==='object' && module.exports)module.exports=api;else root.MMTopicLayout=api;
})(typeof window==='object'?window:globalThis);
