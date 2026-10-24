(() => {
  'use strict';
  const M=window.Mindmap,S=window.MMAISummary,$=id=>document.getElementById(id),esc=window.MMContent.escape;
  const dialog=$('mmDlg');
  let active=null,preparing=false,version=0,draft={text:'',title:'',mode:'ai',allowSupplement:false,placement:'node',inputSource:'text'};
  const panel=document.createElement('section');panel.className='mm-outline-progress';panel.hidden=true;panel.setAttribute('aria-label','大纲 / 正文生成导图');
  panel.innerHTML='<b>AI 理解并生成</b><p role="status" aria-live="polite"></p><div data-usage-host></div><div class="mm-outline-actions"><button type="button" class="mm-b" data-outline-source>查看原文</button><button type="button" class="mm-b" data-outline-stop>停止</button><button type="button" class="mm-b" data-outline-hide hidden>收起</button></div>';
  document.body.appendChild(panel);
  let shownRecord=null;
  function status(text,running=false){active?.usage?.update(null,{stage:text,nodeCount:active.record.generatedIds?.length||0});
    panel.hidden=false;panel.querySelector('p').textContent=text;
    panel.querySelector('[data-outline-stop]').hidden=!running;panel.querySelector('[data-outline-hide]').hidden=running;
  }
  async function request(url,options={}){
    let response;try{response=await fetch(url,options);}catch(error){if(error.name==='AbortError')throw error;throw new Error('连接本地 AI 服务失败，请确认服务正在运行。');}
    let data;try{data=await response.json();}catch{throw new Error('AI 接口返回异常，请重启服务并刷新。');}
    if(!response.ok)throw new Error(data.error || 'AI 请求失败');return data;
  }
  function capture(){
    if(!$('mmOutlineForm'))return;
    draft={text:$('mmOutlineText').value,title:$('mmOutlineTitle').value,mode:$('mmOutlineMode').value,allowSupplement:$('mmOutlineSupplement').checked,placement:$('mmOutlinePlacement')?.value || 'new',inputSource:$('mmOutlineInputSource')?.value || 'text'};
  }
  function clearLectureDraft(){window.MMAILecture?.reset();draft.title='';const title=$('mmOutlineForm')?.querySelector('#mmOutlineTitle');if(title)title.value='';}
  function lectureStarted(){capture();clearLectureDraft();dialog.close();}
  function showSource(record){
    if(!record)return;if(record.mode==='map-summary'){dialog.close();window.MMLibrary.showRecord(record);return;}if(record.mode==='lecture' || record.mode==='math-review' || record.mode==='structure-review'){window.MMAIInspector.openRecord(record.id);return;}capture();
    $('mmDlgBody').innerHTML=`<section class="mm-outline-source"><h3>${esc(record.title || '生成原文')}</h3><p class="meta">${record.mode==='local'?'按原大纲生成':'AI 理解并生成'} · 原文保留用于核对，补充节点以【补充】标明。</p><textarea readonly aria-label="生成时的原文"></textarea><div class="nd-actions"><button type="button" class="mm-b" data-outline-inspect="${esc(record.id)}">提示词与生成过程</button><button type="button" class="mm-b" data-outline-records>全部生成记录</button><span class="spacer"></span><button type="button" class="mm-b" data-mm="dclose">关闭</button></div></section>`;
    $('mmDlgBody').querySelector('textarea').value=record.text;if(!dialog.open)dialog.showModal();
  }
  function records(){
    const rows=M.state().cur?.outlineSources || [];capture();
    const labels={running:'生成中',completed:'已完成',stopped:'已停止',failed:'未完成',partial:'部分完成'};
    $('mmDlgBody').innerHTML='<section class="mm-outline-source"><h3>大纲 / 正文生成记录</h3><p class="meta">原文随导图保存、导出；撤销节点仍保留原文，方便重新整理。</p><div class="mm-outline-records">'+(rows.length?[...rows].reverse().map(r=>`<button type="button" data-outline-record="${esc(r.id)}">${esc(r.title || '未命名内容')}<small>${r.mode==='local'?'按原大纲':'AI 整理'} · ${r.status==='running' && active?.record.id!==r.id && !(r.mode==='lecture' && window.MMAILecture?.running)?'上次生成未完成':labels[r.status] || '已保存'} · ${(r.generatedIds || []).filter(id=>M.findNode(id)).length} 个现存节点</small></button>`).join(''):'<p>还没有大纲或正文的生成记录。</p>')+'</div><div class="nd-actions"><span class="spacer"></span><button class="mm-b" type="button" data-mm="dclose">关闭</button></div></section>';
    if(!dialog.open)dialog.showModal();
  }
  function save(run){
    if(M.state().cur?.id!==run.mapId)return;
    run.record.generatedIds=Object.values(run.batch.mapping || {});run.record.updatedAt=Date.now();M.saveOutlineSource(run.record);shownRecord=run.record;
  }
  function stop(reason='已停止，已生成节点和原文已保留。'){
    const run=active;if(!run)return;active=null;run.controller.abort();M.endAIBatch(run.batch);run.usage?.finish('stopped');run.record.status='stopped';save(run);status(reason);
  }
  function checkTarget(run){
    if(active!==run || run.controller.signal.aborted)throw new DOMException('已停止','AbortError');
    if(M.state().cur?.id!==run.mapId || run.sourceId && !M.findNode(run.sourceId))throw new Error('导图已切换或来源节点已删除，生成已停止。');
  }
  function apply(run,graph,final=false){
    checkTarget(run);if(!graph?.nodes?.length)return;
    const plan=S.normalizeSummary(graph,{outline:true,allowSupplement:run.record.allowSupplement,partial:!final}),signature=JSON.stringify(plan);
    if(signature===run.signature && !final)return;run.signature=signature;
    const result=M.appendAIResult(run.mapId,run.sourceId,plan,run.record.title,run.batch,final);
    if(!run.record.explicitTitle && !run.record.generatedIds?.length){if(run.newDocument)M.nameOutlineDocument(run.mapId,run.record.title,plan.nodes[0].title);run.record.title=plan.nodes[0].title;}
    save(run);
    requestAnimationFrame(()=>{for(const id of result.ids){const node=document.querySelector('.mm-node[data-id="'+id+'"]');if(node){node.classList.add('mm-ai-node-enter');setTimeout(()=>node.classList.remove('mm-ai-node-enter'),400);}}});
  }
  const wait=signal=>new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},180);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
  async function runJob(run,payload){
    const job=crypto.randomUUID(),signal=run.controller.signal;
    try{
      let data=await request('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:job}),signal});
      const usageData=data=>{run.usage.update(data,{stage:data.stage||'正在理解结构'});if(data.calls)run.record.calls=data.calls;};usageData(data);
      let retries=0;const started=Date.now();
      while(data.status==='running'){
        usageData(data);if(data.inspection)run.record.inspection=data.inspection;if(data.graph)apply(run,data.graph);checkTarget(run);
        status(`${data.stage || '正在理解结构'} · 已生成 ${run.record.generatedIds?.length || 0} 个节点 · ${Math.floor((Date.now()-started)/1000)} 秒`,true);
        if(Date.now()-started>window.MMCapacity.pollTimeoutMs)throw new Error('生成等待超时，已完成的节点已保留。');
        await wait(signal);
        try{data=await request('/api/ai/jobs/'+encodeURIComponent(job),{signal});retries=0;}catch(error){if(error.name==='AbortError' || ++retries>=3 || !error.message.startsWith('连接本地'))throw error;}
      }
      usageData(data);if(data.inspection){run.record.inspection=data.inspection;save(run);}
      checkTarget(run);if(data.status!=='completed'){if(data.graph)apply(run,data.graph);throw new Error(data.error || '生成未完成。');}
      apply(run,data.summary,true);return data;
    }finally{fetch('/api/ai/jobs/'+encodeURIComponent(job),{method:'DELETE'}).catch(()=>{});}
  }
  async function start(input,context){
    if(active || preparing)throw new Error('已有文字生成任务，请先停止或等待完成。');
    if(!input.text.trim() || input.text.length>window.MMCapacity.inputChars)throw new Error('请输入1–200000字符的大纲或正文。');
    preparing=true;
    try{
      if(context.mapId && M.state().cur?.id!==context.mapId)throw new Error('导图已切换，请重新打开文字生成。');
      if(input.placement==='node' && !M.findNode(context.sourceId))throw new Error('请先选择一个来源节点，或改为生成到空白区域。');
      const model=input.mode==='ai'?await request('/api/ai/status'):null;
      if(model && !model.available)throw new Error('请先在现有“大模型 API 接入”中保存配置。');
      if(context.mapId && M.state().cur?.id!==context.mapId)throw new Error('导图已切换，请重新打开文字生成。');
      M.finishEditing();window.MMAILecture?.hideProgress();
      const record={id:crypto.randomUUID(),title:input.title.trim() || input.text.trim().split('\n')[0].replace(/^#+\s*/,'').slice(0,80) || '文字整理',explicitTitle:!!input.title.trim(),text:input.text,mode:input.mode,allowSupplement:!!input.allowSupplement,status:'running',createdAt:Date.now(),generatedIds:[],...(model?{model:model.model}:{})};
      capture();dialog.close();shownRecord=record;
      if(input.mode==='local'){
        const result=await M.generateTextOutline(input.text,{title:input.title.trim(),placement:input.placement,sourceId:input.placement==='node'?context.sourceId:null,recordId:record.id});
        if(!result.mapId)throw new Error('未能打开新导图，请重试。');if(input.placement==='new')record.title=M.state().cur.title;record.generatedIds=result.ids;record.status='completed';M.saveOutlineSource(record);status(`已按原大纲生成 ${result.ids.length} 个节点，可直接编辑。`);return;
      }
      let mapId=context.mapId;
      if(input.placement==='new'){mapId=await M.createOutlineDocument(record.title);if(!mapId)throw new Error('未能打开新导图，请重试。');}
      const sourceId=input.placement==='node'?context.sourceId:null;
      const run={mapId,sourceId,record,newDocument:input.placement==='new',controller:new AbortController(),batch:{kind:'outline',recordId:record.id,allowSupplement:record.allowSupplement}};active=run;panel.querySelector('[data-usage-host]').replaceChildren();run.usage=window.MMAIUsage.attach(panel.querySelector('[data-usage-host]'),{mapId});save(run);status('正在理解主题、分组和逻辑关系…',true);
      const node=sourceId?M.findNode(sourceId)?.n:null;
      try{
        const data=await runJob(run,{mode:'outline',outline:{title:input.title.trim(),allowSupplement:record.allowSupplement},messages:[{role:'user',content:input.text}],context:node?{map:M.state().cur.title,node:{id:sourceId,text:node.text}}:{}});
        checkTarget(run);const structure=await window.MMAIStructureReview.run({mapId:run.mapId,ids:Object.values(run.batch.mapping || {}),signal:run.controller.signal,onStage:text=>status(text,true),onUsage:data=>run.usage.update(data),onAudit:audit=>{record.structureReview=audit;run.usage.update(audit);save(run);}});checkTarget(run);if(structure.plan)run.batch.structurePlan=structure.plan;M.finalizeAIOrganization(run.batch);record.status='completed';record.transfer=data.transfer;save(run);if(run.newDocument)M.fitView();status(`已生成 ${record.generatedIds.length} 个节点，原文已保留；本次生成可整体撤销。${data.summary.nodes.some(n=>n.mathWarnings?.length)?' 有公式待检查。':''}${record.structureReview?.status==='failed'?' 结构复核未完成，保留原结构；详情见生成过程。':''}`);
      }catch(error){
        if(active===run){record.status=error.name==='AbortError'?'stopped':'failed';record.error=error.name==='AbortError'?'':error.message;save(run);status(`${error.message} 已完成 ${record.generatedIds.length} 个节点，原文已保留。`);}
      }finally{run.usage.finish(record.status);M.endAIBatch(run.batch);if(active===run)active=null;}
    }finally{preparing=false;}
  }
  function open(intoMap=false,inputSource=null){
    if(active || preparing || window.MMAILecture?.running){if(window.MMAILecture?.running)return;status('已有文字生成任务，完成或停止后可再次生成。',!!active);return;}
    if(inputSource==='text' || inputSource==='files')draft.inputSource=inputSource;
    const state=M.state(),context={mapId:intoMap?state.cur?.id:null,sourceId:intoMap?state.sel:null},token=++version;
    const canAttach=!!(context.sourceId && M.findNode(context.sourceId));
    $('mmDlgBody').innerHTML=`<form id="mmOutlineForm" class="mm-outline-form"><div class="mm-outline-heading"><h3 id="mmOutlineHeading">大纲 / 正文生成导图</h3><button class="mm-b" id="mmOutlineSwitchText" type="button" hidden>改用文字输入 ↗</button></div><label>内容来源<select id="mmOutlineInputSource"><option value="text">粘贴文本</option><option value="files">上传课件 / 讲义</option></select></label><p class="meta" id="mmOutlineInputHelp">粘贴大纲、零散笔记或正文，最多200000字符；实际可处理范围仍取决于所选模型的上下文窗口。AI 会理解主题和关系；按原大纲则使用本地规则，不调用模型。</p><label>生成方式<select id="mmOutlineMode"><option value="ai">AI 理解并生成</option><option value="local">按原大纲生成</option></select></label><label class="mm-outline-title-field">标题（可选）<input id="mmOutlineTitle" type="text" maxlength="80" placeholder="留空时根据内容确定主题"></label>${intoMap?`<label>生成位置<select id="mmOutlinePlacement"><option value="blank">当前导图空白区域</option>${canAttach?'<option value="node">接到当前节点</option>':''}</select></label>`:''}<textarea id="mmOutlineText" rows="10" maxlength="${window.MMCapacity.inputChars}" aria-label="大纲或正文" placeholder="在这里粘贴大纲、课程正文或零散笔记…&#10;&#10;# 函数的极限&#10;定义、性质、计算方法…也可以直接粘贴尚未整理的正文。"></textarea><div id="mmLectureBox" class="mm-lecture-controls" hidden></div><details id="mmOutlineMore" class="mm-outline-more" open><summary>补充选项<span id="mmOutlineMoreState">仅依据原讲义</span></summary><label class="mm-outline-check" id="mmOutlineSupplementRow"><input type="checkbox" id="mmOutlineSupplement">允许补充必要解释（补充节点单独标明）</label><p id="mmOutlineFileNote" class="mm-lecture-help" hidden>资料分批整理，页码出处和生成过程随导图保存。</p></details><div id="mmOutlineModel" class="mm-outline-model"><span>正在读取已有模型配置…</span><button class="mm-b" id="mmOutlinePrompts" type="button">查看提示词</button><button class="mm-b" id="mmOutlineSettings" type="button">大模型 API 接入</button></div><p class="meta" id="mmOutlineHint">只整理本次输入；不会混入其他提问历史。生成后可查看原文。</p><p class="mm-outline-error" id="mmOutlineError" role="alert"></p><div class="nd-actions"><span class="spacer"></span><button type="button" class="mm-b" id="mmOutlineCancel">取消</button><button class="btn ink sm" id="mmOutlineGenerate" type="submit">开始生成</button></div></form>`;
    $('mmOutlineText').value=draft.text;$('mmOutlineTitle').value=draft.title;$('mmOutlineMode').value=draft.mode;$('mmOutlineSupplement').checked=draft.allowSupplement;
    if(intoMap)$('mmOutlinePlacement').value=canAttach && draft.placement!=='blank'?'node':'blank';
    $('mmOutlineInputSource').value=draft.inputSource || 'text';window.MMAILecture.mount($('mmLectureBox'));
    const form=$('mmOutlineForm');
    function update(){
      const files=$('mmOutlineInputSource').value==='files',more=$('mmOutlineMore');
      if(form.classList.contains('is-lecture')!==files)more.open=!files;
      form.classList.toggle('is-lecture',files);$('mmOutlineSwitchText').hidden=!files;$('mmOutlineInputSource').closest('label').hidden=files;
      $('mmOutlineHeading').textContent=files?'课件 / 讲义生成导图':'大纲 / 正文生成导图';if(files)$('mmOutlineMode').value='ai';
      $('mmOutlineMode').disabled=files;$('mmOutlineMode').closest('label').hidden=files;$('mmOutlineInputHelp').hidden=files;$('mmOutlineText').hidden=files;$('mmLectureBox').hidden=!files;
      const title=$('mmOutlineTitle').closest('label'),placement=$('mmOutlinePlacement')?.closest('label');
      if(files)$('mmLectureBox').after(title);else $('mmOutlineMode').closest('label').after(title);if(placement)title.after(placement);
      const ai=$('mmOutlineMode').value==='ai';more.hidden=!ai;$('mmOutlineSupplementRow').hidden=!ai;$('mmOutlineModel').hidden=!ai;$('mmOutlineHint').hidden=files;$('mmOutlineFileNote').hidden=!files;
      $('mmOutlineMoreState').textContent=$('mmOutlineSupplement').checked?'已允许补充':'仅依据原讲义';
      $('mmOutlineHint').textContent=ai?'只整理本次输入；不会混入其他提问历史。生成后可查看原文。':'按标题、编号和缩进生成层级及连线，保留原文；不调用 AI。';
    }
    $('mmOutlineSwitchText').onclick=()=>{$('mmOutlineInputSource').value='text';$('mmOutlineInputSource').dispatchEvent(new Event('change',{bubbles:true}));};
    $('mmOutlineSupplement').onchange=()=>{$('mmOutlineMoreState').textContent=$('mmOutlineSupplement').checked?'已允许补充':'仅依据原讲义';capture();};
    $('mmOutlineInputSource').onchange=()=>{update();capture();};$('mmOutlinePrompts').onclick=()=>{capture();window.MMAIInspector.open();};
    $('mmOutlineMode').onchange=()=>{capture();update();};update();
    $('mmOutlineCancel').onclick=()=>{capture();dialog.close();};
    $('mmOutlineSettings').onclick=()=>{
      capture();form.dataset.preserveLectureDraft='true';dialog.close();const settings=$('mmAPISettingsDialog');settings.addEventListener('close',()=>{if(!active && !preparing)open(intoMap);},{once:true});$('mmAPISettingsButton').click();
    };
    form.onsubmit=async event=>{
      event.preventDefault();capture();$('mmOutlineError').textContent='';const button=$('mmOutlineGenerate');button.disabled=true;
      try{const input={...draft,placement:intoMap?$('mmOutlinePlacement').value:'new'};if(draft.inputSource==='files')await window.MMAILecture.start(input,{...context,form});else await start(input,context);}catch(error){if(error.name==='AbortError' && !dialog.open)return;if($('mmOutlineForm')===form && dialog.open)$('mmOutlineError').textContent=error.message;else status(error.message);}
      finally{button.disabled=false;}
    };
    request('/api/ai/status').then(model=>{if(version===token && $('mmOutlineForm')===form)$('mmOutlineModel').querySelector('span').textContent=model.available?'使用当前模型：'+model.model:'尚未配置模型，请使用已有 API 接入。';}).catch(error=>{if(version===token && $('mmOutlineForm')===form)$('mmOutlineModel').querySelector('span').textContent=error.message;});
    if(!dialog.open)dialog.showModal();(draft.inputSource==='files'?$('mmLectureAddFiles'):$('mmOutlineText')).focus();
  }
  dialog.addEventListener('cancel',()=>{capture();if(draft.inputSource==='files')clearLectureDraft();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;capture();const form=$('mmOutlineForm');if(form?.dataset.preserveLectureDraft==='true'){delete form.dataset.preserveLectureDraft;return;}if(draft.inputSource==='files')clearLectureDraft();});
  dialog.addEventListener('click',event=>{
    if(event.target===dialog || event.target.closest('#mmOutlineCancel,[data-mm="dclose"]')){capture();if(draft.inputSource==='files')clearLectureDraft();}
    const record=event.target.closest('[data-outline-record]');if(record)showSource(M.state().cur?.outlineSources?.find(r=>r.id===record.dataset.outlineRecord));
    if(event.target.closest('[data-outline-records]'))records();
  },true);
  panel.querySelector('[data-outline-stop]').onclick=()=>stop();panel.querySelector('[data-outline-hide]').onclick=()=>{panel.hidden=true;};panel.querySelector('[data-outline-source]').onclick=()=>showSource(shownRecord);
  window.addEventListener('mm:ai-interrupt',()=>stop());
  new MutationObserver(()=>{if(active && (M.state().cur?.id!==active.mapId || active.sourceId && !M.findNode(active.sourceId)))stop('导图已切换或来源已删除，生成已停止。');if(!active && shownRecord && !M.state().cur?.outlineSources?.some(r=>r.id===shownRecord.id))panel.hidden=true;}).observe($('mmBox'),{childList:true,subtree:true});
  window.MMAIOutline={open,records,stop,capture,lectureStarted,hideProgress:()=>{panel.hidden=true;},get running(){return !!active || preparing;}};
})();
