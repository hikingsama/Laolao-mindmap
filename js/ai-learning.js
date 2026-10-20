(function(root){
  'use strict';
  const labels=['阅览','提炼','亲笔推导','对比权威答案'];
  const normalize=value=>({checked:labels.map((_,i)=>value?.checked?.[i]===true),expanded:value?.expanded!==false});
  const progress=value=>normalize(value).checked.filter(Boolean).length;
  const markdown=value=>labels.map((label,i)=>`- [${normalize(value).checked[i]?'x':' '}] ${label}`).join('\n');
  function box(node,record,reserve=false){
    if(!node.n?.aiEntry || !record)return null;
    return {x:node.x,y:node.y+node.h+12,w:Math.max(220,node.w),h:reserve || normalize(record.learning).expanded?162:34};
  }
  function render(node,record){
    const b=box(node,record);if(!b)return '';
    const state=normalize(record.learning),done=progress(state),esc=root.MMContent?.escape || root.esc;
    const color=/^#[0-9a-f]{6}$/i.test(node.n.color || '')?node.n.color:'#667e51';
    return `<section class="mm-ai-learning${done===4?' is-complete':''}" data-ai-learning="${esc(record.id)}" aria-label="本次提问的学习清单" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--ai-chain-color:${color}"><button type="button" class="mm-learn-toggle" aria-expanded="${state.expanded}" aria-label="${state.expanded?'收起':'展开'}学习清单"><span aria-hidden="true">${state.expanded?'▾':'▸'}</span><span>${done===4?'✓ 本轮学习完成':'学习进度'}</span><b>${done}/4</b></button>${state.expanded?`<ul class="mm-learn-items">${labels.map((label,i)=>`<li><label><input type="checkbox" data-ai-learn-index="${i}"${state.checked[i]?' checked':''}> <span>${label}</span></label></li>`).join('')}</ul>`:''}</section>`;
  }
  const api={labels,normalize,progress,markdown,box,render};
  if(typeof module==='object' && module.exports){module.exports=api;return;}
  root.MMAILearning=api;
  function update(card,patch,index){
    const turn=card.dataset.aiLearning;
    root.Mindmap.setAILearning(turn,patch);
    if(patch.expanded===true){
      const map=root.Mindmap.state().cur,record=map.aiMemory.turns.find(t=>t.id===turn),entry=map.nodes.find(n=>n.aiEntry && n.aiTurnId===turn);
      const node=entry && root.Mindmap.state().L.nodes.get(entry.id);if(node)root.Mindmap.ensureVisible(box(node,record));
    }
    const next=[...document.querySelectorAll('[data-ai-learning]')].find(el=>el.dataset.aiLearning===turn);
    (index==null?next?.querySelector('button'):next?.querySelector(`[data-ai-learn-index="${index}"]`))?.focus({preventScroll:true});
  }
  // Preserve native checkbox/keyboard behavior while isolating canvas gestures.
  for(const type of ['pointerdown','mousedown','dblclick','contextmenu'])document.addEventListener(type,e=>{if(e.target.closest('.mm-ai-learning'))e.stopPropagation();},true);
  document.addEventListener('keydown',e=>{const card=e.target.closest('.mm-ai-learning');if(!card)return;e.stopPropagation();if(e.key==='Escape'){e.preventDefault();update(card,{expanded:false});}},true);
  document.addEventListener('click',e=>{
    const card=e.target.closest('.mm-ai-learning');if(!card)return;e.stopPropagation();
    const button=e.target.closest('.mm-learn-toggle');if(button){e.preventDefault();update(card,{expanded:button.getAttribute('aria-expanded')!=='true'});}
  },true);
  document.addEventListener('change',e=>{
    const input=e.target.closest('[data-ai-learn-index]'),card=input?.closest('.mm-ai-learning');if(!card)return;e.stopPropagation();
    const record=root.Mindmap.state().cur?.aiMemory?.turns?.find(t=>t.id===card.dataset.aiLearning),state=normalize(record?.learning),index=Number(input.dataset.aiLearnIndex);
    if(!Number.isInteger(index) || index<0 || index>=labels.length)return;
    state.checked[index]=input.checked;update(card,state,index);
  },true);
  if(root.Mindmap.state().cur)root.Mindmap.preview();
})(typeof window==='object'?window:globalThis);
