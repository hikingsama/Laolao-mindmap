(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MMMapLibraryModel=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
 function nodes(map){const result=[],seen=new Set();function visit(n,depth){if(!n||depth>80||result.length>=10000)throw Error('导图节点过多或层级过深');if(!validId(n.id)||seen.has(n.id))throw Error('导图节点编号无效或重复');seen.add(n.id);result.push(n);for(const child of n.children||[])visit(child,depth+1);}for(const n of map.nodes||[])visit(n,0);return result;}
 function preview(map){
  const boxes=nodes(map).slice(0,240).map((n,i)=>{const p=map.pos?.[n.id],s=map.size?.[n.id];return{id:n.id,x:Number.isFinite(p?.x)?p.x:i%5*190,y:Number.isFinite(p?.y)?p.y:Math.floor(i/5)*110,w:Math.max(45,Math.min(800,Number(s?.w)||150)),h:Math.max(30,Math.min(1200,Number(s?.h)||70)),color:/^#[0-9a-f]{6}$/i.test(n.color||'')?n.color:'#77885e'};});
  const ids=new Set(boxes.map(n=>n.id));return{nodes:boxes,edges:(map.edges||[]).filter(e=>ids.has(e.from?.node)&&ids.has(e.to?.node)).slice(0,400).map(e=>({from:e.from.node,to:e.to.node})),partial:nodes(map).length>240};
 }
 function svg(value){
  const boxes=(value?.nodes||[]).filter(b=>[b.x,b.y,b.w,b.h].every(Number.isFinite)).slice(0,240);if(!boxes.length)return '<svg viewBox="0 0 300 142" aria-hidden="true"></svg>';
  const x0=Math.min(...boxes.map(b=>b.x)),y0=Math.min(...boxes.map(b=>b.y)),w=Math.max(...boxes.map(b=>b.x+b.w))-x0,h=Math.max(...boxes.map(b=>b.y+b.h))-y0,k=Math.min(274/(w+40),120/(h+30));
  const X=x=>((300-w*k)/2+(x-x0)*k).toFixed(2),Y=y=>((142-h*k)/2+(y-y0)*k).toFixed(2),byId=new Map(boxes.map(b=>[b.id,b]));
  const edges=(value.edges||[]).slice(0,400).map(e=>{const a=byId.get(e.from),b=byId.get(e.to);return a&&b?`<path d="M${X(a.x+a.w/2)} ${Y(a.y+a.h/2)} L${X(b.x+b.w/2)} ${Y(b.y+b.h/2)}"/>`:'';}).join('');
  return `<svg viewBox="0 0 300 142" aria-label="布局预览"><g fill="none" stroke="#89977c" stroke-width="1">${edges}</g>${boxes.map(b=>`<rect x="${X(b.x)}" y="${Y(b.y)}" width="${Math.max(1,b.w*k).toFixed(2)}" height="${Math.max(1,b.h*k).toFixed(2)}" rx="3" fill="${/^#[0-9a-f]{6}$/i.test(b.color)?b.color:'#77885e'}" fill-opacity=".32" stroke="#89977c"/>`).join('')}</svg>`;
 }
 function sourceUnits(snapshots){
  let characters=0;const refs=new Map(),sources=[],units=[];
  snapshots.forEach((snapshot,index)=>{let skipped=0,count=0;const all=nodes(snapshot.map);for(const node of all){if(node.image||node.pdf||node.mapLink||!String(node.text||'').trim()){skipped++;continue;}const text=String(node.text);characters+=text.length;if(characters>300000)throw Error('所选导图文字超过30万字符，请减少选择或分批总结');const ref='s'+(index+1)+'_'+(++count);const value={ref,mapId:snapshot.map.id,nodeId:node.id,title:snapshot.map.title,revision:snapshot.revision,text};refs.set(ref,value);units.push(value);}sources.push({mapId:snapshot.map.id,title:snapshot.map.title,revision:snapshot.revision,updated:snapshot.updated,nodeCount:count,skipped,preview:preview(snapshot.map)});if(!count)throw Error('所选导图“'+snapshot.map.title+'”没有可总结的文字节点；图片和PDF需先整理为文字节点');});for(const snapshot of snapshots){const local=new Map(units.filter(u=>u.mapId===snapshot.map.id).map(u=>[u.nodeId,u]));for(const n of nodes(snapshot.map)){const u=local.get(n.id);if(!u)continue;if(local.has(n.layoutParent))u.parentRef=local.get(n.layoutParent).ref;u.relations=(snapshot.map.edges||[]).filter(e=>e.from?.node===n.id&&local.has(e.to?.node)).slice(0,8).map(e=>({to:local.get(e.to.node).ref,label:String(e.label||'').slice(0,40),kind:String(e.kind||'relation').slice(0,40)}));}}return{refs,sources,units,characters};
 }
 function chunks(units,limit=16000){const out=[];let current=[],size=0;
  for(const unit of units){const parts=[];let rest=unit.text;const budget=limit-1024-JSON.stringify({mapTitle:unit.title,parentRef:unit.parentRef,relations:unit.relations}).length;
   while(JSON.stringify(rest).length>budget){let lo=1,hi=rest.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(JSON.stringify(rest.slice(0,mid)).length>budget)hi=mid-1;else lo=mid;}let at=rest.lastIndexOf('\n\n',lo);if(at<500)at=lo;if(/[\uD800-\uDBFF]/.test(rest[at-1]))at--;if(at<1)throw Error('节点关联信息过大，请减少来源关系');parts.push(rest.slice(0,at));rest=rest.slice(at);}parts.push(rest);
   parts.forEach((text,i)=>{const row={ref:unit.ref,mapTitle:unit.title,parentRef:unit.parentRef,relations:unit.relations,text,part:i+1,parts:parts.length};const length=JSON.stringify(row).length;if(size+length>limit&&current.length){out.push(current);current=[];size=0;}current.push(row);size+=length;});
  }if(current.length)out.push(current);if(out.length>32)throw Error('本次内容需要过多批次，请减少导图数量后再试');return out;
 }
 return{validId,nodes,preview,svg,sourceUnits,chunks};
});
