/* Reuse existing controls and listeners; only move the line tools into a floating dock. */
(() => {
  'use strict';
  const box=document.getElementById('mmBox'),head=document.querySelector('.mm-head');
  let pending=false;
  function sync(){
    pending=false;
    const tools=box.querySelector('.mm-tools:not(.mm-draw-dock)'),main=box.querySelector('.mm-main'),marks=document.getElementById('mmMarkTools');
    if(main && marks && marks.parentElement!==main){
      marks.classList.add('mm-tools','mm-draw-dock');marks.setAttribute('role','toolbar');marks.setAttribute('aria-label','线标工具');main.appendChild(marks);
    }
    if(tools){
      const media=document.getElementById('mmMediaToggle')?.parentElement;
      if(media)media.classList.add('mm-media-tools');
    }
    document.documentElement.style.setProperty('--mm-header-bottom',Math.ceil(head.getBoundingClientRect().bottom)+'px');
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(sync);}}
  new MutationObserver(schedule).observe(box,{childList:true,subtree:true});
  new ResizeObserver(schedule).observe(head);
  window.addEventListener('resize',schedule);sync();
})();
