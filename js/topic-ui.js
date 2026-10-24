(() => {
 'use strict';
 const M=window.Mindmap,$=id=>document.getElementById(id);let mode='detail',mapId=null,overlay=null,signature='',focusPending=false,preferredKey=null;
 const cameras=new Map();let graphState=null;
 const hex=c=>/^#[0-9a-f]{6}$/i.test(c || '')?c:'#637747';
 // Geometry/virtualization can replace node content without a full topic render.
 function refreshNumbers(stage){
   for(const el of stage.querySelectorAll('.mm-node')){const order=el.dataset.moduleOrder,heading=el.querySelector('h1,h2,h3');
     el.querySelectorAll('[data-module-heading]').forEach(h=>{delete h.dataset.moduleHeading;delete h.dataset.moduleOrder;});
     el.classList.toggle('mm-module-number-fallback',!!order && !heading);if(order && heading){heading.dataset.moduleHeading='';heading.dataset.moduleOrder=order;}
   }
 }

 // Overview navigation is independent of the detailed canvas. Both use the same
 // 15–300% limits and cursor-anchored exponential wheel scaling.
 function camera(){return cameras.get(mapId);}
 function paint(){const v=camera(),scene=overlay?.querySelector('.mm-overview-scene');if(!v||!scene)return;scene.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.k})`;const label=overlay.querySelector('[data-overview-zoom]');if(label)label.textContent=Math.round(v.k*100)+'%';}
 function fitView(){if(!overlay||!graphState)return;const v=camera(),b=graphState.bounds,w=overlay.clientWidth,h=overlay.clientHeight;if(!v||w<=0||h<=0)return;v.k=Math.max(.15,Math.min(1,Math.max(80,w-48)/Math.max(1,b.w),Math.max(80,h-108)/Math.max(1,b.h)));v.x=w/2-(b.x+b.w/2)*v.k;v.y=44+Math.max(1,h-108)/2-(b.y+b.h/2)*v.k;v.w=w;v.h=h;paint();}
 function zoomTo(k,cx,cy){const v=camera();if(!v||!overlay)return;const next=Math.max(.15,Math.min(3,k));cx=cx??overlay.clientWidth/2;cy=cy??overlay.clientHeight/2;if(![next,cx,cy].every(Number.isFinite))return;v.x=cx-(cx-v.x)*(next/v.k);v.y=cy-(cy-v.y)*(next/v.k);v.k=next;paint();}
 function zoomBy(factor,cx,cy){const v=camera();if(v)zoomTo(v.k*factor,cx,cy);}
 function panBy(dx,dy){const v=camera();if(!v||![dx,dy].every(Number.isFinite))return;v.x+=dx;v.y+=dy;paint();}
 function revealCard(el){if(!el||!overlay)return;const a=el.getBoundingClientRect(),b=overlay.getBoundingClientRect(),top=b.top+46,bottom=b.bottom-60;let dx=0,dy=0;
  if(a.width>b.width-32)dx=b.left+16-a.left;else if(a.left<b.left+16)dx=b.left+16-a.left;else if(a.right>b.right-16)dx=b.right-16-a.right;
  if(a.height>bottom-top)dy=top-a.top;else if(a.top<top)dy=top-a.top;else if(a.bottom>bottom)dy=bottom-a.bottom;panBy(dx,dy);
 }
 function bindViewport(viewport){
  const points=new Map();let drag=null,pinch=null,suppressUntil=0,nativeGesture=null;
  const control=target=>target.closest('.mm-overview-zoom,.mm-module-learning,input,select,textarea,a');
  viewport.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const r=viewport.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoomBy(Math.exp(-e.deltaY*.0022),e.clientX-r.left,e.clientY-r.top);else{const unit=e.deltaMode===1?24:e.deltaMode===2?viewport.clientHeight:1;let dx=e.deltaX*unit,dy=e.deltaY*unit;if(e.shiftKey&&!dx){dx=dy;dy=0;}panBy(-dx,-dy);}}, {passive:false});
  viewport.addEventListener('dragstart',e=>e.preventDefault());
  viewport.addEventListener('pointerdown',e=>{e.stopPropagation();if(e.button!==0||control(e.target))return;e.preventDefault();const v=camera();if(!v)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});const capture=e.target.closest('.mm-overview-open')||viewport;try{capture.setPointerCapture(e.pointerId);}catch{}
   if(points.size>=2){const [a,b]=[...points.values()],r=viewport.getBoundingClientRect(),cx=(a.x+b.x)/2-r.left,cy=(a.y+b.y)/2-r.top;pinch={d:Math.hypot(a.x-b.x,a.y-b.y),k:v.k,worldX:(cx-v.x)/v.k,worldY:(cy-v.y)/v.k};drag=null;suppressUntil=Date.now()+500;}
   else{drag={x:e.clientX,y:e.clientY,vx:v.x,vy:v.y,moved:false};viewport.focus({preventScroll:true});}
  });
  viewport.addEventListener('pointermove',e=>{e.stopPropagation();if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});const v=camera();if(!v)return;
   if(pinch&&points.size>=2){const [a,b]=[...points.values()],r=viewport.getBoundingClientRect(),d=Math.hypot(a.x-b.x,a.y-b.y),k=Math.max(.15,Math.min(3,pinch.k*d/Math.max(1,pinch.d)));if(!Number.isFinite(k))return;v.k=k;v.x=(a.x+b.x)/2-r.left-pinch.worldX*k;v.y=(a.y+b.y)/2-r.top-pinch.worldY*k;suppressUntil=Date.now()+500;paint();e.preventDefault();return;}
   if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){v.x=drag.vx+dx;v.y=drag.vy+dy;viewport.classList.add('is-panning');suppressUntil=Date.now()+500;paint();e.preventDefault();}
  });
  function up(e){e.stopPropagation();if(!points.has(e.pointerId))return;points.delete(e.pointerId);if(drag?.moved||pinch)suppressUntil=Date.now()+350;drag=null;pinch=null;viewport.classList.remove('is-panning');if(points.size===1){const a=[...points.values()][0],v=camera();drag={x:a.x,y:a.y,vx:v.x,vy:v.y,moved:true};}}
  for(const type of ['pointerup','pointercancel'])viewport.addEventListener(type,up);
  // A capture transfer between a card and the viewport need not end the drag.
  viewport.addEventListener('lostpointercapture',e=>{if(!e.buttons)up(e);});
  viewport.addEventListener('click',e=>{if(Date.now()<suppressUntil&&!control(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
  viewport.addEventListener('click',e=>{const action=e.target.closest('[data-overview-action]')?.dataset.overviewAction;if(!action)return;e.stopPropagation();if(action==='fit')fitView();else zoomBy(action==='in'?1.2:1/1.2);});
  for(const type of ['gesturestart','gesturechange','gestureend'])viewport.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();if(type==='gesturestart')nativeGesture=camera()?.k;else if(type==='gesturechange'&&nativeGesture){const r=viewport.getBoundingClientRect();zoomTo(nativeGesture*e.scale,Number.isFinite(e.clientX)?e.clientX-r.left:undefined,Number.isFinite(e.clientY)?e.clientY-r.top:undefined);}else nativeGesture=null;},{passive:false});
 }
 function overview(){
   const state=M.state(),host=$('mmView');if(!state.cur || !host)return;
   const graph=window.MMStructureOverview.build(state.cur),key=JSON.stringify(graph);
   if(!overlay || !overlay.isConnected){overlay=document.createElement('section');overlay.className='mm-structure-overview';overlay.setAttribute('aria-label','导图结构概览，可拖动平移、双指捏合缩放');overlay.tabIndex=0;host.appendChild(overlay);bindViewport(overlay);for(const type of ['dblclick','contextmenu','drop','dragover'])overlay.addEventListener(type,e=>{e.stopPropagation();if(type==='drop'||type==='dragover'||type==='contextmenu')e.preventDefault();});signature='';}
   if(signature!==key){signature=key;overlay.replaceChildren();const hint=document.createElement('p');hint.className='mm-overview-hint';hint.textContent='左侧从上到下，再读右侧 · 双指平移／捏合缩放 · 拖动平移 · 点击主题查看详细内容';overlay.append(hint);const surface=document.createElement('div');surface.className='mm-overview-surface';overlay.append(surface);const scene=document.createElement('div');scene.className='mm-overview-scene';surface.append(scene);const controls=document.createElement('div');controls.className='mm-zoom mm-overview-zoom';controls.setAttribute('role','group');controls.setAttribute('aria-label','概览图缩放');controls.innerHTML='<button type="button" data-overview-action="out" title="缩小（Ctrl -）" aria-label="缩小概览图">−</button><span data-overview-zoom>100%</span><button type="button" data-overview-action="in" title="放大（Ctrl +）" aria-label="放大概览图">＋</button><button type="button" data-overview-action="fit" title="适应屏幕（Ctrl 0）" aria-label="概览图适应屏幕">⤢</button>';overlay.append(controls);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('mm-overview-links');svg.setAttribute('viewBox',`${graph.bounds.x} ${graph.bounds.y} ${graph.bounds.w} ${graph.bounds.h}`);svg.style.cssText=`left:${graph.bounds.x}px;top:${graph.bounds.y}px;width:${graph.bounds.w}px;height:${graph.bounds.h}px`;scene.append(svg);const boxes=new Map(graph.nodes.map(n=>[n.id,n]));
     for(const e of graph.edges){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',window.MMEdgeRouter.route(boxes.get(e.from.node),boxes.get(e.to.node),e).path);p.setAttribute('stroke',hex(e.color));p.setAttribute('fill','none');p.setAttribute('stroke-width','2');svg.append(p);}
     for(const n of graph.nodes){
       const card=document.createElement('article'),button=document.createElement('button');card.className='mm-overview-card'+(n.root?' root':'');card.dataset.overviewLevel=n.root?'1':String(n.level || 2);card.dataset.overviewCard=n.id;if(n.order)card.dataset.moduleOrder=n.order;card.style.cssText=`left:${n.x}px;top:${n.y}px;width:${n.w}px;min-height:${n.h}px;--overview-color:${hex(n.color)}`;
       button.type='button';button.className='mm-overview-open';button.dataset.overviewNode=n.id;const h=document.createElement('strong'),body=document.createElement('span'),count=document.createElement('small');h.textContent=n.title;body.textContent=n.text;count.textContent=n.root?'查看完整导图':`${n.nodeIds.length} 个详细节点 ↗`;button.append(h,body,count);button.onclick=()=>{setMode('detail');const live=n.nodeIds.map(id=>M.state().L.nodes.get(id)).filter(Boolean);if(!live.length)return;M.selectNodes([n.centerId]);if(n.root){M.fitView();return;}const cards=(M.state().L.moduleCards || []).filter(c=>live.some(b=>b.n.id===c.anchorId));const b=window.MMTopicLayout.extent([...live,...cards.map(c=>c.box)]),r=host.getBoundingClientRect();M.zoom(Math.max(.2,Math.min(1,(r.width-100)/Math.max(1,b.w),(r.height-160)/Math.max(1,b.h))));M.revealBox(b);};card.append(button);
       if(n.learningSummary)card.append(window.MMModuleLearningUI.summary(n.learningSummary));
       if(n.learning)card.append(window.MMModuleLearningUI.create(n.learning,n.title));
       scene.append(card);
     }
   }
   const toolbar=document.querySelector('.mm-tools'),hostRect=host.getBoundingClientRect();overlay.style.top=Math.max(0,(toolbar?.getBoundingClientRect().bottom || hostRect.top)-hostRect.top+16)+'px';
   graphState=graph;const w=overlay.clientWidth,h=overlay.clientHeight;let v=camera();if(!v){v={x:0,y:0,k:1,w,h};cameras.set(mapId,v);fitView();}else{v.x+=(w-v.w)/2;v.y+=(h-v.h)/2;v.w=w;v.h=h;paint();}
   const selected=state.sel,target=(preferredKey && graph.nodes.find(n=>n.learning?.key===preferredKey)) || graph.nodes.filter(n=>n.nodeIds.includes(selected)).sort((a,b)=>(b.level || 1)-(a.level || 1))[0];for(const el of overlay.querySelectorAll('[data-overview-card]')){const current=el.dataset.overviewCard===target?.id;el.classList.toggle('is-current',current);const nav=el.querySelector('.mm-overview-open');if(current)nav.setAttribute('aria-current','true');else nav.removeAttribute('aria-current');}
   if(focusPending){focusPending=false;const el=target && [...overlay.querySelectorAll('[data-overview-card]')].find(e=>e.dataset.overviewCard===target.id);revealCard(el);}
 }
 function setMode(value,key=null){if(value==='overview'){M.finishEditing();focusPending=mode!=='overview' || !!key;preferredKey=key;}mode=value;render();if(value==='overview')overlay?.focus({preventScroll:true});else $('mmView')?.focus({preventScroll:true});}
 function openModule(key){const group=window.MMTopicLayout.describe(M.state().cur).groups.find(g=>g.key===key);if(!group)return;M.selectNodes([group.center.id]);focusPending=true;setMode('overview',key);}
 function render(){
   const state=M.state(),map=state.cur,stage=$('mmStage');if(!map || !stage){overlay?.remove();overlay=null;mapId=null;mode='detail';focusPending=false;preferredKey=null;return;}
   if(mapId!==map.id){mapId=map.id;mode='detail';signature='';focusPending=false;preferredKey=null;}
   stage.querySelectorAll('.mm-topic-frame,.mm-topic-title').forEach(el=>el.remove());
   const active=mode==='overview';$('mmView').classList.toggle('mm-show-overview',active);$('mmBox').classList.toggle('mm-overview-active',active);
   for(const [id,on] of [['mmDetailView',!active],['mmOverviewView',active]]){$(id)?.setAttribute('aria-pressed',String(on));}
   for(const id of ['mmOrganizeButton','mmOrganizeScope','mmConnectionStyle','mmStructureReviewButton'])if($(id))$(id).disabled=active;
   stage.querySelectorAll('.mm-module-canvas,.mm-module-canvas-summary').forEach(e=>e.remove());if(active)overview();else{overlay?.remove();overlay=null;signature='';window.MMModuleLearningUI.renderDetail(map,state.L,stage);}
   const byId=new Map(map.nodes.map(n=>[n.id,n])),edges=new Map((map.edges || []).map(e=>[e.id,e]));
   for(const el of stage.querySelectorAll('.mm-edge,.mm-arrow,[data-edge-label]')){const e=edges.get(el.dataset.edgeLabel || el.dataset.edge || el.dataset.id),a=byId.get(e?.from.node),b=byId.get(e?.to.node),cross=!!(a?.topic && b?.topic && (a.topic!==b.topic || a.topicScope!==b.topicScope));el.classList.toggle('mm-cross-topic',cross);}
   const reviewed=window.MMTopicLayout.describe(map).groups;const orders=new Map(reviewed.filter(g=>Number.isInteger(g.order)).map(g=>[g.center.id,g.order]));
   const centers=new Set((Array.isArray(map.topicGroups)?map.topicGroups:[]).map(g=>g.centerId || g.nodeIds?.[0]));
   for(const el of stage.querySelectorAll('.mm-node')){el.classList.toggle('mm-topic-center',centers.has(el.dataset.id));const order=orders.get(el.dataset.id);if(order)el.dataset.moduleOrder=String(order).padStart(2,'0');else delete el.dataset.moduleOrder;}
   refreshNumbers(stage);
   const scope=$('mmOrganizeScope');if(scope){scope.querySelector('option[value=branch]').disabled=!state.selected.length;if(!state.selected.length)scope.value='all';}
   const select=$('mmConnectionStyle');if(select && document.activeElement!==select){const edge=map.edges?.find(e=>e.id===state.selectedEdge),has=!!select.querySelector('option[value=inherit]');if(edge && !has){const o=document.createElement('option');o.value='inherit';o.textContent='跟随导图';select.prepend(o);}else if(!edge && has)select.querySelector('option[value=inherit]').remove();select.value=edge?(edge.style || 'inherit'):(map.line || 'curve');select.title=edge?'仅修改选中连线的样式':'设置当前导图默认连线样式';}
 }
 document.addEventListener('click',e=>{if(e.target.closest('#mmOverviewView'))setMode('overview');if(e.target.closest('#mmDetailView'))setMode('detail');if(e.target.closest('#mmOrganizeButton'))try{const p=M.organize($('mmOrganizeScope').value);if(p)window.showBanner(`已整理 ${p.ids.length} 个节点，可一步撤销`);}catch(error){window.showBanner(error.message);}});
 document.addEventListener('change',e=>{if(e.target.id==='mmConnectionStyle')M.setConnectionStyle(e.target.value);});
 window.addEventListener('resize',()=>{if(mode==='overview')overview();});
 // Overview is a read-only projection, so canvas keyboard shortcuts must not edit hidden nodes.
 document.addEventListener('keydown',e=>{if(mode!=='overview' || !overlay?.isConnected || e.target.closest('textarea,input,dialog,#mmAI,.mm-module-learning'))return;if((e.ctrlKey||e.metaKey)&&['+','=','-','0'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.key==='0')fitView();else zoomBy(e.key==='-'?1/1.2:1.2);return;}if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setMode('detail');return;}if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s')return;e.stopImmediatePropagation();if(['Delete','Backspace'].includes(e.key) || (e.ctrlKey || e.metaKey) && ['z','y','v','x','d','b'].includes(e.key.toLowerCase()))e.preventDefault();},true);
 window.MMTopicUI={render,setMode,openModule,refreshNumbers,zoomBy,fitView,get viewport(){return camera()?{...camera()}:null;},get mode(){return mode;}};
})();
