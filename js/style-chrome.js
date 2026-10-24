/* Keep the existing controls and listeners together in the top toolbar. */
(() => {
  'use strict';
  const box=document.getElementById('mmBox'),head=document.querySelector('.mm-head');
  let pending=false,art=null,toolbar=null;
  const artObserver=new ResizeObserver(schedule);
  const toolbarObserver=new ResizeObserver(schedule);
  function connectArt(){
    const next=box.querySelector('.mm-home-art');
    if(next!==art){artObserver.disconnect();art=next;if(art){artObserver.observe(art);art.querySelectorAll('.mm-art-note').forEach(note=>artObserver.observe(note));}}
    if(!art)return;const bounds=art.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
    const target=art.querySelector('.mm-art-note.three')?.getBoundingClientRect();if(!target)return;
    const tx=target.left+target.width/2-bounds.left,ty=target.top+target.height/2-bounds.top;
    for(const name of ['one','two']){const note=art.querySelector('.mm-art-note.'+name)?.getBoundingClientRect(),line=art.querySelector('.mm-art-line.'+name);if(!note||!line)continue;
      const x=note.left+note.width/2-bounds.left,y=note.top+note.height/2-bounds.top,dx=tx-x,dy=ty-y;
      // Connect centers beneath the opaque cards, so rotations and resizing
      // cannot leave a visible gap between a card and its connector.
      line.style.cssText=`left:${x}px;top:${y}px;width:${Math.hypot(dx,dy)}px;transform:rotate(${Math.atan2(dy,dx)}rad)`;
    }
  }
  function sync(){
    pending=false;connectArt();
    const tools=box.querySelector('.mm-tools:not(.mm-draw-dock)'),marks=document.getElementById('mmMarkTools');
    if(tools && marks){
      marks.classList.remove('mm-tools','mm-draw-dock');marks.setAttribute('role','group');marks.setAttribute('aria-label','线标工具');
      if(marks.parentElement!==tools)tools.appendChild(marks);
    }
    if(toolbar!==tools){toolbarObserver.disconnect();toolbar=tools;if(toolbar)toolbarObserver.observe(toolbar);}
    if(tools){
      const media=document.getElementById('mmMediaToggle')?.parentElement;
      if(media)media.classList.add('mm-media-tools');
      box.style.setProperty('--mm-toolbar-bottom',Math.ceil(tools.getBoundingClientRect().bottom-box.getBoundingClientRect().top)+'px');
    }
    document.documentElement.style.setProperty('--mm-header-bottom',Math.ceil(head.getBoundingClientRect().bottom)+'px');
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(sync);}}
  new MutationObserver(schedule).observe(box,{childList:true,subtree:true});
  new ResizeObserver(schedule).observe(head);
  window.addEventListener('resize',schedule);sync();
})();
