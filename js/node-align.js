(() => {
  const M=()=>window.Mindmap,labels=[['left','左对齐'],['center','水平居中'],['right','右对齐'],['top','顶部对齐'],['middle','垂直居中'],['bottom','底部对齐'],['space-x','横向等间距'],['space-y','纵向等间距']];
  function bounds(boxes){const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
  function clear(){document.getElementById('mmAlignGuides')?.remove();}
  function snap(original,dx,dy,disabled){
    clear();if(disabled || !original.length)return {dx,dy};
    const state=M().state(),v=M().view(),ids=new Set(original.map(n=>n.id)),box=bounds(original),moving={...box,x:box.x+dx,y:box.y+dy},view=document.getElementById('mmView').getBoundingClientRect(),limit=6/v.k;
    const others=[...state.L.nodes.values()].filter(b=>!ids.has(b.n.id) && b.x*v.k+v.x<view.width+240 && (b.x+b.w)*v.k+v.x>-240 && b.y*v.k+v.y<view.height+240 && (b.y+b.h)*v.k+v.y>-240);
    let vertical=null,horizontal=null;
    for(const target of others)for(const ratio of [0,.5,1]){
      const x=target.x+ratio*target.w,delta=x-(moving.x+ratio*moving.w);
      if(Math.abs(delta)<=limit && (!vertical || Math.abs(delta)<Math.abs(vertical.delta)))vertical={delta,at:x,target};
      const y=target.y+ratio*target.h,change=y-(moving.y+ratio*moving.h);
      if(Math.abs(change)<=limit && (!horizontal || Math.abs(change)<Math.abs(horizontal.delta)))horizontal={delta:change,at:y,target};
    }
    dx+=vertical?.delta || 0;dy+=horizontal?.delta || 0;
    if(vertical || horizontal){const root=document.createElement('div');root.id='mmAlignGuides';root.className='mm-align-guides';const final={...box,x:box.x+dx,y:box.y+dy};
      for(const [axis,match] of [['x',vertical],['y',horizontal]])if(match){const line=document.createElement('i');line.className='mm-align-guide '+axis;const target=match.target;
        line.style.cssText=axis==='x'?`left:${v.x+match.at*v.k}px;top:${v.y+Math.min(final.y,target.y)*v.k-8}px;height:${(Math.max(final.y+final.h,target.y+target.h)-Math.min(final.y,target.y))*v.k+16}px`:`top:${v.y+match.at*v.k}px;left:${v.x+Math.min(final.x,target.x)*v.k-8}px;width:${(Math.max(final.x+final.w,target.x+target.w)-Math.min(final.x,target.x))*v.k+16}px`;
        root.appendChild(line);
      }document.getElementById('mmView').appendChild(root);
    }return {dx,dy};
  }
  function align(action){
    const state=M().state(),boxes=state.selected.map(id=>state.L.nodes.get(id)).filter(Boolean);if(boxes.length<2 || action.startsWith('space-')&&boxes.length<3)return;
    const box=bounds(boxes),changes=new Map();
    if(action.startsWith('space-')){const axis=action==='space-x'?'x':'y',size=axis==='x'?'w':'h',sorted=[...boxes].sort((a,b)=>a[axis]-b[axis] || a.n.id.localeCompare(b.n.id));const first=sorted[0],last=sorted.at(-1),gap=(last[axis]+last[size]-first[axis]-sorted.reduce((n,b)=>n+b[size],0))/(sorted.length-1);let at=first[axis];
      for(const node of sorted){changes.set(node.n.id,{x:node.x,y:node.y,[axis]:at});at+=node[size]+gap;}
    }else for(const node of boxes){const p={x:node.x,y:node.y};if(action==='left')p.x=box.x;if(action==='center')p.x=box.x+(box.w-node.w)/2;if(action==='right')p.x=box.x+box.w-node.w;if(action==='top')p.y=box.y;if(action==='middle')p.y=box.y+(box.h-node.h)/2;if(action==='bottom')p.y=box.y+box.h-node.h;changes.set(node.n.id,p);}
    if(boxes.every(b=>Math.abs(changes.get(b.n.id).x-b.x)<.001 && Math.abs(changes.get(b.n.id).y-b.y)<.001))return;
    M().editMap(()=>{for(const [id,p] of changes)state.cur.pos[id]=p;});window.MMContextMenus.hideAll();
  }
  function menu(){const count=M().state().selected.length;return window.MMContextMenus.branch('排齐节点',labels.map(([key,label])=>`<button data-node-align="${key}"${count<(key.startsWith('space-')?3:2)?' disabled':''}>${label}</button>`).join(''),'node-align');}
  document.addEventListener('click',e=>{const button=e.target.closest('[data-node-align]');if(button && !button.disabled)align(button.dataset.nodeAlign);});
  window.MMAlign={snap,clear,align,menu};
})();
