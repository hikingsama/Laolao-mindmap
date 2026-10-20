(() => {
  "use strict";
  const sidebar=document.createElement('aside');sidebar.id='mmAI';sidebar.className='mm-ai hidden';sidebar.setAttribute('aria-label','节点 AI 对话');
  sidebar.innerHTML=`<div class="mm-ai-resizer" role="separator" tabindex="0" aria-label="调整提问侧栏宽度" aria-orientation="vertical" title="拖动调宽；方向键微调，双击恢复默认"></div><div class="mm-ai-heading"><b>✦ 节点提问</b><button class="mm-b" id="mmAIClose" aria-label="关闭 AI 对话">✕</button></div><div id="mmAIContext"></div><div id="mmAIMessages" role="log" aria-live="polite"></div><form id="mmAIForm"><details class="mm-ai-options"><summary>回答方向与参考范围</summary><label>本次方向<input id="mmAIDirection" type="text" maxlength="2000" placeholder="自动判断；也可指定解释依据、举例或另一种解法"></label><label>参考范围<select id="mmAIReferenceScope"><option value="project">当前树与相关树</option><option value="tree">仅当前树</option><option value="node">仅当前节点</option></select></label></details><textarea id="mmAIInput" rows="3" placeholder="针对这个节点提问，回答将直接生成导图…" aria-label="向 AI 提问" maxlength="10000"></textarea><div class="mm-ai-send"><span id="mmAIStatus" role="status">AI 模型尚未接入</span><button class="mm-b" id="mmAIStop" type="button" hidden>停止</button><button class="mm-b" id="mmAISend" type="submit">发送</button></div></form>`;
  document.body.appendChild(sidebar);
  const $=id=>document.getElementById(id),esc=window.MMContent.escape;
  let target=null,messages=[],pending=null,active=null,statusVersion=0;
  const key=()=>`mm_ai_v1_${target.map}_${target.node}`;
  function draft(text){try{localStorage.setItem(key()+'_draft',text);}catch{}}
  function save(run=active){
    if(!run?.record || window.Mindmap.state().cur?.id!==run.map)return;
    Object.assign(run.record,{answer:run.message.content,nodeCount:run.message.nodeCount || 0,generatedIds:run.message.generatedIds || [],workflow:run.message.workflow,transfer:run.message.transfer,color:run.message.color || run.batch.color || run.record.color,attachment:run.user.attachment,error:run.message.error || "",updatedAt:Date.now()});
    window.Mindmap.saveAIRecord(run.record,run.ownership);
  }
  function importLegacy(map){
    const info=window.MMAIMemory.index(map),known=new Set(info.turns.map(t=>t.id)),records=[];
    for(const node of map.nodes || [])try{
      const old=JSON.parse(localStorage.getItem(`mm_ai_v1_${map.id}_${node.id}`) || '[]');if(!Array.isArray(old))continue;let user=null;
      old.forEach((m,i)=>{if(m?.role==='user' && typeof m.content==='string')user=m;else if(user && m?.role==='assistant' && typeof m.content==='string'){
        const id='legacy-'+window.MMAIMemory.fingerprint(node.id+'-'+i+'-'+user.content);if(!known.has(id)){records.push({id,treeId:info.membership[node.id],sourceId:node.id,sourceTitle:window.MMAIMemory.title(node),question:user.content,answer:m.content,attachment:user.attachment,number:m.turn || i+1,status:m.incomplete || m.generating?'stopped':'completed',generatedIds:m.generatedIds || Object.values(m.pushedNodes || {}),nodeCount:m.nodeCount || m.summary?.nodes?.length || 0,createdAt:0,legacy:true});known.add(id);}user=null;
      }});
    }catch{}
    if(!map.aiMemory || records.length)window.Mindmap.saveAIRecord(records,info);
  }
  function busy(on){$('mmAISend').disabled=on;$('mmAIStop').hidden=!on;$('mmAIInput').disabled=on;for(const el of sidebar.querySelectorAll('#mmAIDirection,#mmAIReferenceScope'))el.disabled=on;sidebar.setAttribute('aria-busy',String(on));}
  function context(){
    const map=window.Mindmap.state().cur;
    if(!map || map.id!==target?.map)throw new Error('当前导图已切换，请在当前节点右键重新提问。');
    const node=window.Mindmap.findNode(target.node)?.n;if(!node)throw new Error('这个节点已删除，请重新选择节点。');
    const edges=(map.edges || []).filter(e=>e.from.node===node.id || e.to.node===node.id),ids=new Set(edges.flatMap(e=>[e.from.node,e.to.node]));ids.delete(node.id);
    const mediaId=node.pdf || node.image,file=(map.media || []).find(m=>m.id===mediaId);
    const media=mediaId?{kind:node.pdf?'pdf':'image',id:mediaId,mapId:map.id,name:file?.name || (node.pdf?'PDF':'图片')}:null;
    return {media,map:map.title,node:{id:node.id,text:(node.text || '').slice(0,12000)},neighbors:[...ids].slice(0,8).map(id=>({id,text:(window.Mindmap.findNode(id)?.n.text || '').slice(0,2000)})),edges};
  }
  function render(){
    const scroller=$('mmAIMessages'),follow=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90,expanded=new Set([...scroller.querySelectorAll('[data-wf-details][open]')].map(d=>d.dataset.wfDetails));
    scroller.innerHTML=messages.length?messages.map(m=>`<article class="mm-ai-message ${m.role}" data-turn-id="${esc(m.turnId || '')}"><small>${m.role==='user'?'你':'本次回答'}</small>${m.role==='user' && m.sourceTitle?`<small class="mm-ai-origin">提问于 <button type="button" data-wf-source="${esc(m.sourceId)}">${esc(m.sourceTitle)}</button></small>`:''}${m.attachment?`<small class="mm-ai-attachment">附带：${esc(m.attachment)}</small>`:''}${m.role==='assistant'?window.MMAIWorkflow.render(m,window.Mindmap.state().cur):''}<div class="mm-rich">${window.MMContent.render(m.content)}</div>${m.role==='assistant'?`<small class="mm-ai-result-state">${m.generating?`正在主导图生成 · 已完成 ${m.nodeCount || 0} 个知识点`:m.incomplete?'生成未完成，已完成的节点保留在导图中':m.nodeCount?`已在主导图生成 ${m.nodeCount} 个知识点，可直接编辑`:''}</small>`:''}</article>`).join(''):'<p class="mm-ai-empty">提问后，回答会直接在主导图逐步生成节点和连线。每次提问单独形成一组，可通过画布工具撤销。同一棵树的提问历史统一保存在导图中。</p>';
    for(const details of scroller.querySelectorAll('[data-wf-details]'))if(expanded.has(details.dataset.wfDetails))details.open=true;
    if(follow)scroller.scrollTop=scroller.scrollHeight;
  }
  function cancelActive(reason='已停止，已完成的节点已保留'){
    const controller=pending,run=active;if(!controller)return;
    pending=null;active=null;controller.abort();if(run)window.Mindmap.endAIBatch(run.batch);
    if(run){run.message.generating=false;run.message.incomplete=true;run.record.status='stopped';if(run.message.workflow)run.message.workflow.phase='stopped';if(target?.map===run.map && target?.node===run.node){draft(run.question);$('mmAIInput').value=run.question;save(run);render();}}
    busy(false);$('mmAIStatus').textContent=reason;
  }
  async function request(url,options){
    let response;try{response=await fetch(url,options);}catch(e){if(e.name==='AbortError')throw e;throw new Error(`连接本地 AI 服务失败，请确认服务正在运行，并从 ${location.origin}/ 打开页面。`);}
    let data;try{data=await response.json();}catch{throw new Error('AI 接口返回异常，请重启本地服务并刷新页面。');}
    if(!response.ok)throw new Error(data.error || 'AI 请求失败');return data;
  }
  function delay(signal){return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},180);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });}
  async function runAI(payload,controller,onProgress){
    let job=crypto.randomUUID();
    try{
      let data=await request('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId:job})});
      if(data.job){job=data.job;const started=Date.now();let retries=0;
        while(data.status==='running'){
          onProgress(data);if(Date.now()-started>270000)throw new Error('AI 回答等待超时，请稍后重试。');
          if(pending===controller)$('mmAIStatus').textContent=`${data.stage || '正在生成导图'} · ${active?.message.nodeCount || 0} 个知识点 · ${Math.floor((Date.now()-started)/1000)} 秒`;
          await delay(controller.signal);
          try{data=await request('/api/ai/jobs/'+encodeURIComponent(job),{signal:controller.signal});retries=0;}catch(e){if(e.name==='AbortError' || ++retries>=3 || !e.message.startsWith('连接本地'))throw e;}
        }
        onProgress(data);if(data.status!=='completed')throw new Error(data.error || '生成已停止，请重试。');
      }return data;
    }finally{fetch('/api/ai/jobs/'+encodeURIComponent(job),{method:'DELETE'}).catch(()=>{});}
  }
  async function refreshStatus(){
    const version=++statusVersion;$('mmAIStatus').textContent='正在读取模型配置…';
    try{const s=await request('/api/ai/status');if(version===statusVersion && !pending)$('mmAIStatus').textContent=s.available?'当前模型：'+s.model:s.message;}
    catch(e){if(version===statusVersion && !pending)$('mmAIStatus').textContent=e.message;}
  }
  function close(){sidebar.classList.add('hidden');document.body.classList.remove('mm-ai-open');window.dispatchEvent(new Event('resize'));}
  function open(id){
    const node=window.Mindmap.findNode(id)?.n,map=window.Mindmap.state().cur;if(!map || !node)return;
    if(target?.map===map.id && target?.node===id && pending){sidebar.classList.remove('hidden');document.body.classList.add('mm-ai-open');window.dispatchEvent(new Event('resize'));return;}
    cancelActive('已切换提问节点，已完成的内容已保留');target={map:map.id,node:id};
    try{$('mmAIInput').value=localStorage.getItem(key()+'_draft') || '';}catch{$('mmAIInput').value='';}
    importLegacy(map);const info=window.MMAIMemory.collect(map,id,'');messages=window.MMAIMemory.messages(info);
    for(const m of messages)if(m.generating){m.generating=false;m.incomplete=true;const record=map.aiMemory.turns.find(t=>t.id===m.turnId);if(record){record.status='stopped';record.workflow={...record.workflow,phase:'stopped'};window.Mindmap.saveAIRecord(record);}}
    $('mmAIDirection').value='';$('mmAIReferenceScope').value='project';
    window.dispatchEvent(new Event('mm:close-shortcuts'));sidebar.classList.remove('hidden');document.body.classList.add('mm-ai-open');
    refreshStatus();const ctx=context();$('mmAIContext').innerHTML='<span>当前节点：'+esc(ctx.media?.name || ctx.node.text.replace(/\s+/g,' ').slice(0,100) || '空白节点')+'</span><span class="mm-ai-tree-label">'+esc(info.treeTitle)+' · 同树 '+info.turns.filter(t=>t.treeId===info.treeId).length+' 次提问记录</span>';render();window.dispatchEvent(new Event('resize'));$('mmAIInput').focus();
  }
  $('mmAIClose').onclick=close;$('mmAIStop').onclick=()=>cancelActive();
  $('mmAIInput').addEventListener('input',()=>{if(target)draft($('mmAIInput').value);});
  sidebar.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}});
  $('mmAIInput').addEventListener('keydown',e=>{if(e.key==='Enter' && (e.ctrlKey || e.metaKey)){e.preventDefault();$('mmAIForm').requestSubmit();}});
  function applyGraph(run,graph,final=false){
    if(pending!==run.controller || run.controller.signal.aborted)return;context();
    if(!graph?.nodes?.length)return;
    const plan=window.MMAISummary.normalizeSummary(graph,{partial:!final}),signature=JSON.stringify(plan);
    if(!final && run.signature===signature)return;run.signature=signature;
    const result=window.Mindmap.appendAIResult(run.map,run.node,plan,run.entryText,run.batch,final);
    run.message.content=plan.nodes.map(n=>window.MMAISummary.nodeText(n)).join('\n\n');run.message.nodeCount=plan.nodes.length;
    run.message.generatedIds=Object.values(result.mapping);run.message.color=run.batch.color;save(run);render();
    requestAnimationFrame(()=>result.ids.forEach(id=>{const el=document.querySelector('.mm-node[data-id="'+id+'"]');if(el){el.classList.add('mm-ai-node-enter');setTimeout(()=>el.classList.remove('mm-ai-node-enter'),400);}}));
  }
  $('mmAIForm').addEventListener('submit',async e=>{
    e.preventDefault();const input=$('mmAIInput'),question=input.value.trim();if(!question || pending)return;
    let ctx;try{ctx=context();}catch(error){$('mmAIStatus').textContent=error.message;return;}
    ++statusVersion;draft(question);const controller=new AbortController();pending=controller;busy(true);
    const map=window.Mindmap.state().cur,scope=$('mmAIReferenceScope').value,info=window.MMAIMemory.collect(map,target.node,question,{scope});
    if(scope!=='project'){ctx.neighbors=ctx.neighbors.filter(n=>scope==='tree' && info.membership[n.id]===info.treeId);const allowed=new Set([target.node,...ctx.neighbors.map(n=>n.id)]);ctx.edges=ctx.edges.filter(e=>allowed.has(e.from.node) && allowed.has(e.to.node));}
    const turn=Math.max(0,...info.turns.filter(t=>t.treeId===info.treeId).map(t=>Number(t.number)||0))+1,turnId=crypto.randomUUID();
    const parent=info.turns.findLast(t=>t.generatedIds?.includes(target.node)) || info.turns.findLast(t=>t.treeId===info.treeId && t.sourceId===target.node);
    const color=window.MMAIBranch.color(window.Mindmap.state().L.nodes.get(target.node)?.color,info.turns.filter(t=>t.sourceId===target.node).map(t=>t.color),turn);
    const record={id:turnId,treeId:info.treeId,sourceId:target.node,sourceTitle:window.MMAIMemory.title(window.Mindmap.findNode(target.node).n),parentTurnId:parent?.id || null,number:turn,question,answer:'',status:'running',color,createdAt:Date.now(),workflow:{phase:'preparing',planningStatus:'pending',sources:[]}};
    const conversation=[...info.history,{role:'user',content:question}].slice(-20);messages=window.MMAIMemory.messages({...info,turns:[...info.turns,record]});
    const message=messages.at(-1),user=messages.at(-2);message.color=color;
    const run={controller,message,user,record,ownership:info,map:target.map,node:target.node,question,batch:{turnId,treeId:info.treeId,color},entryText:`第${turn}次提问：${question.replace(/\s+/g,' ').slice(0,160)}`};active=run;
    save(run);render();input.value='';$('mmAIStatus').textContent='正在准备提问…';
    try{
      const media=await window.MMAIMedia.prepare(ctx.media?{...ctx.media,question}:null,controller.signal,text=>{if(pending===controller)$('mmAIStatus').textContent=text;});
      if(pending!==controller)return;context();
      if(media){user.attachment=media.kind==='pdf'?media.name+(media.allPages?' · 全部 '+media.pageCount+' 页':' · 第'+media.images.map(i=>i.page).join(',')+'页'):media.name;save(run);render();}
      const data=await runAI({mode:'graph',context:ctx,messages:conversation,workflow:{candidates:info.candidates,history:info.history.slice(-6),direction:$('mmAIDirection').value,scope},...(media?{media}:{})},controller,progress=>{if(pending!==controller)return;if(progress.transfer)message.transfer=progress.transfer;if(progress.workflow && JSON.stringify(message.workflow)!==JSON.stringify(progress.workflow)){message.workflow=progress.workflow;save(run);render();}applyGraph(run,progress.graph);});
      if(pending!==controller)return;if(data.workflow)message.workflow=data.workflow;applyGraph(run,data.summary,true);
      if(!message.nodeCount)throw new Error('模型未返回有效节点，请重试。');
      message.generating=false;delete message.incomplete;record.status='completed';draft('');save(run);render();$('mmAIStatus').textContent=`已在主导图生成 ${message.nodeCount} 个知识点，可直接编辑或撤销。`;
    }catch(error){if(pending===controller){message.generating=false;message.incomplete=true;record.status=error.name==='AbortError'?'stopped':'failed';message.error=error.name==='AbortError'?'':error.message;if(message.workflow)message.workflow.phase=record.status==='failed'?'failed':'stopped';input.value=question;draft(question);save(run);render();$('mmAIStatus').textContent=error.name==='AbortError'?'已停止，已完成的节点已保留':error.message;}}
    finally{window.Mindmap.endAIBatch(run.batch);if(pending===controller){pending=null;active=null;busy(false);if(!sidebar.classList.contains('hidden'))input.focus();}}
  });
  sidebar.addEventListener('click',e=>{
    const inspect=e.target.closest('[data-wf-inspect]');if(inspect){const details=[...sidebar.querySelectorAll('[data-wf-details]')].find(d=>d.dataset.wfDetails===inspect.dataset.wfInspect);if(details)details.open=!details.open;return;}
    const source=e.target.closest('[data-wf-source]');if(source){const id=source.dataset.wfSource,n=window.Mindmap.findNode(id)?.n,box=window.Mindmap.state().L?.nodes.get(id);if(!n || !box){$('mmAIStatus').textContent='来源节点已移除，仍可查看记录中的原文快照';return;}window.Mindmap.selectNodes([id]);window.Mindmap.revealBox(box);}
  });
  function openTurn(id){
    const map=window.Mindmap.state().cur,record=map?.aiMemory?.turns?.find(t=>t.id===id);if(!record)return;
    const source=window.Mindmap.findNode(record.sourceId)?record.sourceId:record.generatedIds?.find(v=>window.Mindmap.findNode(v)) || map.nodes.find(n=>map.aiMemory.membership[n.id]===record.treeId)?.id;if(!source)return;
    open(source);requestAnimationFrame(()=>{const article=[...sidebar.querySelectorAll('.assistant[data-turn-id]')].find(el=>el.dataset.turnId===id);if(article){article.querySelector('details').open=true;article.querySelector('.mm-ai-workflow').scrollIntoView({block:'start'});}});
  }
  window.addEventListener('mm:ai-interrupt',()=>cancelActive('生成已停止，已完成的节点已保留'));
  window.addEventListener('mm:ai-config-saved',()=>{if(!sidebar.classList.contains('hidden') && !pending)refreshStatus();});
  new MutationObserver(()=>{
    if(!target)return;const cur=window.Mindmap.state().cur;
    if(cur?.id!==target.map){cancelActive('已切换导图，生成已停止');target=null;close();}
    else if(pending && !window.Mindmap.findNode(target.node))cancelActive('提问节点已删除，生成已停止');
  }).observe($('mmBox'),{childList:true,subtree:true});

  const handle=sidebar.querySelector('.mm-ai-resizer');let preferred=420,drag=null;
  try{const stored=Number(localStorage.getItem('mm_ai_sidebar_width'));if(Number.isFinite(stored) && stored>=320)preferred=stored;}catch{}
  function resize(persist=false){
    const max=Math.max(240,Math.min(720,innerWidth-360)),min=Math.min(320,max),width=Math.min(max,Math.max(min,preferred));
    document.documentElement.style.setProperty('--mm-ai-width',width+'px');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',Math.round(width));
    if(persist)try{localStorage.setItem('mm_ai_sidebar_width',String(preferred));}catch{}
  }
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();drag={id:e.pointerId,x:e.clientX,width:sidebar.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);document.body.classList.add('mm-ai-resizing');});
  function moveResize(e){if(!drag || drag.id!==e.pointerId)return;preferred=Math.max(320,Math.min(720,drag.width+drag.x-e.clientX));resize();window.dispatchEvent(new Event('resize'));}
  // Window listeners also cover capture loss or a fast drag across the canvas.
  window.addEventListener('pointermove',moveResize,true);
  function endResize(e){if(!drag || e.pointerId!==drag.id)return;if(e.type==='pointerup')moveResize(e);drag=null;document.body.classList.remove('mm-ai-resizing');resize(true);}
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,endResize,true);
  handle.addEventListener('dblclick',()=>{preferred=420;resize(true);window.dispatchEvent(new Event('resize'));});
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();preferred=e.key==='Home'?320:e.key==='End'?720:Math.max(320,Math.min(720,preferred+(e.key==='ArrowLeft'?20:-20)));resize(true);window.dispatchEvent(new Event('resize'));});
  window.addEventListener('resize',()=>resize());resize();
  window.MMAI={open,openTurn,close,cancel:cancelActive};
})();
