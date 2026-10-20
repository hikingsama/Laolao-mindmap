(() => {
  'use strict';
  const esc=v=>window.MMContent.escape(String(v ?? ''));
  function render(message,map){
    const w=message.workflow || {},phase=w.phase || (message.generating?'preparing':message.incomplete?'stopped':'completed'),planning=(!message.generating && ['pending','running'].includes(w.planningStatus))?(phase==='failed'?'failed':'stopped'):w.planningStatus || (phase==='relating'?'running':phase==='preparing'?'pending':'legacy');
    const sources=Array.isArray(w.sources)?w.sources:[],running=message.generating,answer=phase==='completed'?'completed':phase==='answering'?'running':['stopped','failed'].includes(phase)?phase:'pending';
    const relation={continue:'沿当前推导',branch:'展开新分支',correct:'核对与修正',new:'开启新问题'}[w.relation] || '自动判断';
    const dot=status=>['completed','legacy'].includes(status)?'✓':status==='running'?'◉':status==='fallback'?'!':'○';
    const planLabel=planning==='running'?'查找资料与确定范围':planning==='completed'?'资料与方向已确定':planning==='fallback'?'已使用路径资料':planning==='legacy'?'旧版记录':planning==='stopped'?'关联已停止':planning==='failed'?'关联未完成':'等待开始';
    const answerLabel=answer==='completed'?`完成 ${message.nodeCount || 0} 个知识点`:answer==='running'?`已生成 ${message.nodeCount || 0} 个知识点`:answer==='stopped'?'已停止，保留完整节点':answer==='failed'?'生成未完成':'等待方向确定';
    const color=/^#[0-9a-f]{6}$/i.test(message.color || '')?message.color:'#667e51';
    const sourceHTML=sources.map(s=>{
      const n=window.Mindmap.findNode(s.nodeId || s.id)?.n,changed=n && s.revision && window.MMAIMemory.fingerprint(n.text)!==s.revision;
      return `<section class="mm-wf-source"><button type="button" data-wf-source="${esc(s.nodeId || s.id)}"><span>${esc(s.title || '参考节点')}</span><small>${esc(s.treeTitle || '')} ↗</small></button><p>${esc(s.reason || '')}${!n?' · 来源节点已移除':changed?' · 来源已编辑，以下为当时快照':''}</p><blockquote>${esc(String(s.text || '').slice(0,500))}</blockquote></section>`;
    }).join('') || '<p>尚未选定引用资料。</p>';
    const stages=`<div class="mm-wf-stages" aria-label="本次提问工作流"><button type="button" data-wf-inspect="${esc(message.turnId)}" class="mm-wf-stage ${planning}"><span class="mm-wf-dot">${dot(planning)}</span><span><b>关联与定向</b><small>${planLabel}</small></span></button><span class="mm-wf-arrow" aria-hidden="true">→</span><button type="button" data-wf-inspect="${esc(message.turnId)}" class="mm-wf-stage ${answer}"><span class="mm-wf-dot">${dot(answer)}</span><span><b>生成回答</b><small>${answerLabel}</small></span></button></div>`;
    const direction=`<p class="mm-wf-direction"><span>${esc(relation)}</span>${esc(w.direction || (running?'正在准备本次问题的回答方向…':'本次回答记录'))}</p>`;
    const body=`<div class="mm-wf-detail-body"><p class="mm-wf-role-note"><b>关联与定向员</b> 选择相关资料并确定本次范围；<b>回答员</b> 据此生成节点。${planning==='legacy'?'此记录来自旧版，未执行新的角色流程。':''}</p>${message.error?`<p class="mm-wf-error">${esc(message.error)}</p>`:''}${w.note?`<p>${esc(w.note)}</p>`:''}${sourceHTML}</div>`;
    const content=running?`${stages}${direction}<details class="mm-wf-details" data-wf-details="${esc(message.turnId)}"><summary>${sources.length?`参考 ${sources.length} 处资料`:'方向与依据'}<span>查看详情</span></summary>${body}</details>`:`<details class="mm-wf-completed" data-wf-details="${esc(message.turnId)}"><summary><span class="mm-wf-summary-dot">${phase==='completed'?'✓':'○'}</span> ${phase==='completed'?`参考 ${sources.length} 处 · 生成 ${message.nodeCount || 0} 个知识点`:phase==='stopped'?'已停止 · 完整节点已保留':'未完成 · 查看原因'}<span>查看过程</span></summary><div class="mm-wf-expanded">${stages}${direction}${body}</div></details>`;
    return `<section class="mm-ai-workflow ${running?'is-running':'is-finished'}" style="--wf-color:${color}" data-workflow-turn="${esc(message.turnId)}">${content}</section>`;

  }
  document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-ai-turn]')){e.stopPropagation();e.preventDefault();}},true);
  document.addEventListener('click',e=>{const badge=e.target.closest('[data-ai-turn]');if(!badge)return;e.preventDefault();e.stopPropagation();window.MMAI?.openTurn(badge.dataset.aiTurn);},true);
  window.MMAIWorkflow={render};
})();
