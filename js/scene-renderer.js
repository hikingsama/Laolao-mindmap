// Node DOM survives geometry/style changes. Expensive content is mounted only
// for visible nodes; overview mode and offscreen nodes keep their real geometry.
(() => {
  const scenes=new WeakMap();
  function refresh(stage){
    const scene=scenes.get(stage);if(!scene)return;
    const current=Mindmap.state(),selected=new Set(current.selected),v=Mindmap.view(),r=document.getElementById('mmView').getBoundingClientRect(),pad=180;
    for(const record of scene.values()){
      const {spec,element}=record,b=spec.box,keep=selected.has(spec.id) || current.editing===spec.id || window.MMPDF?.isActive(spec.id);
      const visible=v.x+(b.x+b.w)*v.k>=-pad && v.y+(b.y+b.h)*v.k>=-pad && v.x+b.x*v.k<=r.width+pad && v.y+b.y*v.k<=r.height+pad;
      const mode=keep?'full':!visible?'offscreen':v.k<=.2?'brief':'full';
      if(record.mode===mode && record.key===spec.key)continue;
      record.mode=mode;record.key=spec.key;element.dataset.detail=mode;
      if(mode==='full'){
        const content=spec.full();if(typeof content==='string')element.innerHTML=content;else if(!element.contains(content) && !content.closest('.mm-pdf-dialog'))element.replaceChildren(content);
      }else if(mode==='brief'){const summary=document.createElement('div');summary.className='mm-node-summary';summary.textContent=spec.summary;
        if(spec.isMapLink){element.innerHTML=`<button type="button" class="mm-reference-brief" data-reference-card="${window.MMContent.escape(spec.id)}" title="双击打开目标导图"><span>${window.MMContent.escape(spec.summary)}</span>↗</button>`;}
        else if(spec.isPDF){const bar=document.createElement('div');bar.className='mm-pdf-titlebar';bar.dataset.imageLabel=spec.id;bar.tabIndex=0;bar.setAttribute('role','button');bar.title=spec.mediaName;const name=document.createElement('span');name.className='mm-pdf-title';name.textContent=spec.mediaName;bar.appendChild(name);element.replaceChildren(bar,summary);}
        else element.replaceChildren(summary);}
      else element.replaceChildren();
    }
    window.MMTopicUI?.refreshNumbers(stage);
    window.MMPDF?.sync();
  }
  function render(stage,chrome,specs){
    let scene=scenes.get(stage);if(!scene){scene=new Map();scenes.set(stage,scene);}
    const live=new Set(specs.map(s=>s.id));for(const [id,r] of scene)if(!live.has(id)){r.element.remove();scene.delete(id);}
    stage.querySelectorAll(':scope > .mm-links,:scope > .mm-linkprev,:scope > .mm-magwrap,:scope > .mm-image-label,:scope > .mm-ai-task-badge,:scope > .mm-ai-learning,:scope > .mm-node-citations,:scope > .mm-math-warning').forEach(el=>el.remove());
    const template=document.createElement('template');template.innerHTML=chrome;
    const magnets=[...template.content.querySelectorAll('.mm-magwrap')];for(const el of magnets)el.remove();stage.prepend(template.content);
    for(const spec of specs){
      let record=scene.get(spec.id);if(!record){const element=document.createElement('div');element.dataset.id=spec.id;stage.appendChild(element);record={element};scene.set(spec.id,record);}
      record.spec=spec;record.element.className=spec.className;record.element.style.cssText=spec.style;
    }
    stage.append(...magnets);
    refresh(stage);
  }
  function exportContent(stage){
    const source=document.getElementById('mmStage'),scene=scenes.get(source);if(!scene)return;
    for(const record of scene.values()){
      const target=[...stage.querySelectorAll('.mm-node')].find(el=>el.dataset.id===record.spec.id);if(!target)continue;
      target.dataset.detail='full';
      const content=record.spec.full();if(typeof content==='string')target.innerHTML=content;else window.MMPDF?.exportNode(record.spec.id,target);
    }
    window.MMTopicUI?.refreshNumbers(stage);
  }
  window.MMScene={render,refresh,exportContent};
})();
