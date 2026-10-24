(() => {
 'use strict';
 const M=window.Mindmap,L=window.MMModuleLearning;
 function summary(value){const p=document.createElement('p');p.className='mm-module-summary';p.dataset.moduleSummary='';p.textContent=`已完成 ${value.completed}/${value.modules} 个模块 · ${value.checked}/${value.total} 项`;return p;}
 function create(learn,title,view='overview'){
  const section=document.createElement('section');section.className='mm-module-learning'+(view==='detail'?' mm-module-canvas':'');section.dataset.moduleLearning=learn.key;section.dataset.learningView=view;section.setAttribute('aria-label',title+'的学习清单');
  const header=document.createElement('div');header.className='mm-module-header';const toggle=document.createElement('button');toggle.type='button';toggle.className='mm-module-toggle';toggle.setAttribute('aria-expanded',String(learn.expanded));toggle.textContent=(learn.expanded?'▾ ':'▸ ')+'学习进度 '+learn.checked.filter(Boolean).length+'/5';
  function update(patch,index){
   M.setModuleLearning(learn.key,patch);
   const next=[...document.querySelectorAll('[data-module-learning]')].find(e=>e.dataset.moduleLearning===learn.key && e.dataset.learningView===view);
   if(patch.expanded && view==='detail'){const box=M.state().L.moduleCards?.find(c=>c.key===learn.key)?.box;if(box)M.ensureVisible(box);}
   (index==null?next?.querySelector('.mm-module-toggle'):next?.querySelector(`[data-module-step="${index}"]`))?.focus({preventScroll:true});
  }
  toggle.onclick=()=>update({expanded:!learn.expanded});header.append(toggle);
  if(view==='detail'){const link=document.createElement('button');link.type='button';link.className='mm-module-view';link.textContent='概览 ↗';link.setAttribute('aria-label','在概览中定位'+title);link.onclick=()=>window.MMTopicUI.openModule(learn.key);header.append(link);}
  section.append(header);
  if(learn.expanded){const ul=document.createElement('ul');for(const [i,[label,hint]]of L.steps.entries()){const li=document.createElement('li'),l=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.dataset.moduleStep=i;input.checked=learn.checked[i];input.setAttribute('aria-label',label);l.title=hint;span.textContent=label;input.onchange=()=>{const checked=[...learn.checked];checked[i]=input.checked;update({checked},i);};l.append(input,span);li.append(l);ul.append(li);}section.append(ul);}
  section.addEventListener('click',e=>e.stopPropagation());section.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();update({expanded:false});}});return section;
 }
 function renderDetail(map,layout,stage){
  stage.querySelectorAll('.mm-module-canvas,.mm-module-canvas-summary').forEach(e=>e.remove());
  for(const card of layout.moduleCards || []){let el;if(card.kind==='summary'){el=summary(card.summary);el.classList.add('mm-module-canvas-summary');}else{el=create(card.learning,card.group.title,'detail');el.dataset.moduleAnchor=card.anchorId;}
   const b=card.box,c=map.nodes.find(n=>n.id===card.anchorId)?.color,color=/^#[0-9a-f]{6}$/i.test(c || '')?c:'#637747';el.style.cssText=`left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--overview-color:${color}`;stage.append(el);
  }
 }
 // Isolate learning controls before the canvas/group drag handlers see a press.
 for(const type of ['pointerdown','mousedown','dblclick','contextmenu'])document.addEventListener(type,e=>{if(e.target.closest('.mm-module-learning'))e.stopPropagation();},true);
 window.MMModuleLearningUI={create,summary,renderDetail};
})();
