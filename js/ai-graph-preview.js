(() => {
  "use strict";
  const esc=window.MMContent.escape;
  const colors={mainline:"#526ed3",progression:"#278469",parallel:"#75829a",supplement:"#b07a25"};
  function draw(host,message,index,textOf,isPushed){
    host.dataset.theme=window.Mindmap.state().cur?.theme || "fresh";
    const graph=window.MMAISummary.presentationGraph(message.summary,message.entryText,message.images,n=>window.Mindmap.measureAINode(window.MMAISummary.nodeText(n)));
    const byId=new Map(graph.nodes.map(n=>[n.id,n]));
    const marker="ai-arrow-"+index;
    const lines=graph.edges.map(e=>{
      const a=byId.get(e.from),b=byId.get(e.to),route=window.MMEdgeRouter.route(a,b,{from:{side:"e"},to:{side:"w"}});
      const segments=route.points.slice(1).map((q,i)=>({p:route.points[i],q,length:Math.abs(q.x-route.points[i].x)+Math.abs(q.y-route.points[i].y)}));
      const segment=segments.sort((a,b)=>b.length-a.length)[0],p={x:(segment.p.x+segment.q.x)/2,y:(segment.p.y+segment.q.y)/2};
      return {line:`<g data-relation="${e.kind}"><path d="${route.path}" fill="none" stroke="${(colors[e.kind] || '#77885e')}" stroke-width="2" ${e.kind==='supplement'?'stroke-dasharray="7 5"':''} ${e.kind!=='parallel'?`marker-end="url(#${marker})"`:''}/></g>`,label:`<rect x="${p.x-32}" y="${p.y-11}" width="64" height="22" rx="4" fill="white" stroke="${(colors[e.kind] || '#77885e')}"/><text x="${p.x}" y="${p.y+4}" text-anchor="middle" fill="${(colors[e.kind] || '#77885e')}" font-size="12">${window.MMAISummary.relationLabels[e.kind]}</text>`};
    });
    const body=host.querySelector('.mm-ai-graph-world');
    body.style.width=graph.width+'px';body.style.height=graph.height+'px';
    body.innerHTML=`<svg width="${graph.width}" height="${graph.height}" aria-label="节点逻辑连线"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#687a9b"/></marker></defs>${lines.map(e=>e.line).join('')}${lines.map(e=>e.label).join('')}</svg>`+graph.nodes.map((n,k)=>{
      const image=n.type==='image',entry=n.type==='entry',content=image?`<img class="mm-ai-generated-image" src="/api/maps/${encodeURIComponent(message.mapId)}/media/${encodeURIComponent(n.media.id)}?draft=1" alt="${esc(n.title)}">`:window.MMContent.render(window.MMAISummary.nodeText(n));
      const control=entry?'<small>提问入口</small>':`<label><input type="checkbox" ${image?`data-image-selected="${esc(n.imageFor)}"`:'data-summary-field="selected"'} ${n.selected?'checked':''} aria-label="选择${esc(n.title)}"> ${k}</label><small data-ai-card-state>${isPushed(n)?'已推送':'待推送'}</small>${image?'':`<button type="button" class="mm-b" data-ai="edit" data-index="${index}" aria-label="编辑节点${k}">编辑</button>`}`;
      return `<section class="mm-ai-graph-node ${n.selected?'':'excluded'} ${entry?'mm-ai-entry-node':''}" data-summary-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;${image?'padding:8px':`font:${esc(n.font)};padding:${n.padY}px ${n.padX}px`}"><div class="mm-ai-graph-tools">${control}</div><div class="mm-rich" data-ai-preview>${content}</div></section>`;
    }).join('');
    const port=host.querySelector('.mm-ai-graph-viewport');port.tabIndex=0;
    if(!host._drawn){host._drawn=true;body.querySelectorAll('.mm-ai-graph-node').forEach((n,i)=>{n.classList.add('mm-ai-node-enter');n.style.animationDelay=Math.min(i*75,450)+'ms';});}
    host._graphSize={w:graph.width,h:graph.height};
    if(!host._view)fit(host);
    else apply(host);
  }
  function apply(host){const v=host._view;host.querySelector('.mm-ai-graph-world').style.transform=`translate(${v.x}px,${v.y}px) scale(${v.k})`;host.querySelector('[data-graph-scale]').textContent=Math.round(v.k*100)+'%';}
  function fit(host){const port=host.querySelector('.mm-ai-graph-viewport'),s=host._graphSize;if(!s)return;const k=Math.min(1,(port.clientWidth-16)/s.w,(port.clientHeight-16)/s.h);host._view={k:Math.max(.03,k),x:(port.clientWidth-s.w*k)/2,y:12};apply(host);}
  function zoom(host,factor,x,y){const v=host._view,k=Math.min(2,Math.max(.03,v.k*factor));v.x=x-(x-v.x)*k/v.k;v.y=y-(y-v.y)*k/v.k;v.k=k;apply(host);}
  function mount(host){
    if(host._mounted)return;host._mounted=true;
    const port=host.querySelector('.mm-ai-graph-viewport');
    host.addEventListener('click',e=>{const b=e.target.closest('[data-graph-action]');if(!b)return;e.stopPropagation();const a=b.dataset.graphAction;if(a==='fit')fit(host);else if(a==='expand'){host.classList.toggle('expanded');b.textContent=host.classList.contains('expanded')?'收起':'放大窗口';b.setAttribute('aria-expanded',String(host.classList.contains('expanded')));fit(host);}else zoom(host,a==='in'?1.3:1/1.3,port.clientWidth/2,port.clientHeight/2);});
    port.addEventListener('wheel',e=>{e.preventDefault();const r=port.getBoundingClientRect();zoom(host,e.deltaY<0?1.15:1/1.15,e.clientX-r.left,e.clientY-r.top);},{passive:false});
    let drag=null;
    port.addEventListener('pointerdown',e=>{if(e.button!==0 || e.target.closest('input,button'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};port.setPointerCapture(e.pointerId);});
    port.addEventListener('pointermove',e=>{if(!drag || drag.id!==e.pointerId)return;host._view.x+=e.clientX-drag.x;host._view.y+=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;apply(host);});
    const end=()=>{drag=null;};port.addEventListener('pointerup',end);port.addEventListener('pointercancel',end);
  }
  function shell(){return `<div class="mm-ai-graph"><div class="mm-ai-graph-bar"><button class="mm-b" type="button" data-graph-action="out" aria-label="缩小预览">−</button><span data-graph-scale></span><button class="mm-b" type="button" data-graph-action="in" aria-label="放大预览">＋</button><button class="mm-b" type="button" data-graph-action="fit">适应</button><button class="mm-b" type="button" data-graph-action="expand" aria-expanded="false">放大窗口</button></div><div class="mm-ai-graph-viewport" aria-label="小导图预览，可拖动和滚轮缩放"><div class="mm-ai-graph-world"></div></div></div>`;}
  window.MMAIGraphPreview={draw,mount,shell};
})();
