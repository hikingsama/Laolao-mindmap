(() => {
  'use strict';
  const blocked='input,textarea,[contenteditable=true],dialog,.mm-tools,.mm-zoom,.mm-edit-preview,.mm-edit-help,.mm-formatbar,.mm-pdf-toolbar,.mm-hint';
  function surface(target){
    if(!(target instanceof Element) || target.closest(blocked))return null;
    return target.closest('#mmView');
  }
  document.addEventListener('wheel',e=>{
    if((e.ctrlKey || e.metaKey) && !surface(e.target)){e.preventDefault();e.stopImmediatePropagation();}
  },{capture:true,passive:false});
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey || e.metaKey) || !['+','=','-','0'].includes(e.key))return;
    e.preventDefault();e.stopImmediatePropagation();
    const canvas=surface(e.target);if(!canvas)return;
      if(window.MMTopicUI?.mode==='overview'){if(e.key==='0')window.MMTopicUI.fitView();else window.MMTopicUI.zoomBy(e.key==='-'?1/1.2:1.2);}
      else if(e.key==='0')document.querySelector('[data-mm=fit]')?.click();
      else window.Mindmap.zoom(window.Mindmap.view().k*(e.key==='-'?1/1.2:1.2));
  },true);
  for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,e=>{if(!surface(e.target))e.preventDefault();},{capture:true,passive:false});
})();
