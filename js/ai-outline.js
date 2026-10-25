(() => {
  'use strict';
  const M=window.Mindmap,$=id=>document.getElementById(id),esc=window.MMContent.escape;
  const dialog=$('mmDlg');
  let version=0,draft={text:'',title:'',mode:'ai',allowSupplement:false,placement:'node',inputSource:'text'};
  const panel=document.createElement('section');panel.className='mm-outline-progress';panel.hidden=true;panel.setAttribute('aria-label','大纲 / 正文生成导图');
  panel.innerHTML='<b>AI 理解并生成</b><p role="status" aria-live="polite"></p><div data-usage-host></div><div class="mm-outline-actions"><button type="button" class="mm-b" data-outline-source>查看原文</button><button type="button" class="mm-b" data-outline-stop>停止</button><button type="button" class="mm-b" data-outline-hide hidden>收起</button></div>';
  document.body.appendChild(panel);
  let shownRecord=null;
  function status(text,running=false){
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
    if(!record)return;if(record.mode==='map-summary'){dialog.close();window.MMLibrary.showRecord(record);return;}if(record.workflow==='text-task-v1' || record.mode==='lecture' || record.mode==='math-review' || record.mode==='structure-review'){window.MMAIInspector.openRecord(record.id);return;}capture();
    $('mmDlgBody').innerHTML=`<section class="mm-outline-source"><h3>${esc(record.title || '生成原文')}</h3><p class="meta">${record.mode==='local'?'按原大纲生成':'AI 理解并生成'} · 原文保留用于核对，补充节点以【补充】标明。</p><textarea readonly aria-label="生成时的原文"></textarea><div class="nd-actions"><button type="button" class="mm-b" data-outline-inspect="${esc(record.id)}">提示词与生成过程</button><button type="button" class="mm-b" data-outline-records>全部生成记录</button><span class="spacer"></span><button type="button" class="mm-b" data-mm="dclose">关闭</button></div></section>`;
    $('mmDlgBody').querySelector('textarea').value=record.text;if(!dialog.open)dialog.showModal();
  }
  function records(){
    const rows=M.state().cur?.outlineSources || [];capture();
    const labels={running:'生成中',completed:'已完成',stopped:'已停止',failed:'未完成',partial:'部分完成'};
    $('mmDlgBody').innerHTML='<section class="mm-outline-source"><h3>大纲 / 正文生成记录</h3><p class="meta">原文随导图保存、导出；撤销节点仍保留原文，方便重新整理。</p><div class="mm-outline-records">'+(rows.length?[...rows].reverse().map(r=>`<button type="button" data-outline-record="${esc(r.id)}">${esc(r.title || '未命名内容')}<small>${r.mode==='local'?'按原大纲':'AI 整理'} · ${r.status==='running' && !r.backgroundTaskId && !(r.mode==='lecture' && window.MMAILecture?.running)?'上次生成未完成':labels[r.status] || '已保存'} · ${(r.generatedIds || []).filter(id=>M.findNode(id)).length} 个现存节点</small></button>`).join(''):'<p>还没有大纲或正文的生成记录。</p>')+'</div><div class="nd-actions"><span class="spacer"></span><button class="mm-b" type="button" data-mm="dclose">关闭</button></div></section>';
    if(!dialog.open)dialog.showModal();
  }
  function stop(){if(window.MMLocalLecture?.submitting)return window.MMLocalLecture.stop();}
  async function start(input,context){return window.MMTextTasks.start(input,context);}
  function open(intoMap=false,inputSource=null){
    if(window.MMLocalLecture?.submitting){status('正在提交资料，请先等待上传完成。');return;}
    if(['text','images','topic','files'].includes(inputSource))draft.inputSource=inputSource;
    const state=M.state(),context={mapId:intoMap?state.cur?.id:null,sourceId:intoMap?state.sel:null},token=++version;
    const canAttach=!!(context.sourceId && M.findNode(context.sourceId));
    $('mmDlgBody').innerHTML=`<form id="mmOutlineForm" class="mm-outline-form"><div class="mm-outline-heading"><h3 id="mmOutlineHeading">大纲 / 正文生成导图</h3><button class="mm-b" id="mmOutlineSwitchText" type="button" hidden>改用文字输入 ↗</button></div><label>内容来源<select id="mmOutlineInputSource"><option value="text">粘贴文本</option><option value="images">AI识别图片，整理正文与大纲</option><option value="topic">按主题编写学习稿</option><option value="files">上传课件 / 讲义 PDF</option></select></label><p class="meta" id="mmOutlineInputHelp">粘贴完整文字、识别图片，或输入主题让 AI 编写学习稿；先做全文规划，再按完整语义单元生成。提交后台后可以关闭网页，本地服务需保持运行。</p><input id="mmOutlineMode" type="hidden" value="ai"><label class="mm-outline-title-field">标题（可选）<input id="mmOutlineTitle" type="text" maxlength="80" placeholder="留空时根据内容确定主题"></label>${intoMap?`<label>生成位置<select id="mmOutlinePlacement"><option value="blank">当前导图空白区域</option>${canAttach?'<option value="node">接到当前节点</option>':''}</select></label>`:''}<textarea id="mmOutlineText" rows="10" maxlength="${window.MMCapacity.inputChars}" aria-label="大纲或正文" placeholder="在这里粘贴大纲、课程正文或零散笔记…&#10;&#10;# 函数的极限&#10;定义、性质、计算方法…也可以直接粘贴尚未整理的正文。"></textarea><div id="mmTextSourceExtras"></div><div id="mmLectureBox" class="mm-lecture-controls" hidden></div><details id="mmOutlineMore" class="mm-outline-more" open><summary>补充选项<span id="mmOutlineMoreState">仅依据原讲义</span></summary><label class="mm-outline-check" id="mmOutlineSupplementRow"><input type="checkbox" id="mmOutlineSupplement">允许补充必要解释（补充节点单独标明）</label><p id="mmOutlineFileNote" class="mm-lecture-help" hidden>先通览全部材料，再按完整主题与步骤整理；页码出处和生成过程随导图保存。</p></details><div id="mmOutlineModel" class="mm-outline-model"><span>正在读取已有模型配置…</span><button class="mm-b" id="mmOutlinePrompts" type="button">查看提示词</button><button class="mm-b" id="mmOutlineSettings" type="button">大模型 API 接入</button></div><p class="meta" id="mmOutlineHint">只整理本次输入；不会混入其他提问历史。生成后可查看原文。</p><p class="mm-outline-error" id="mmOutlineError" role="alert"></p><div class="nd-actions"><span class="spacer"></span><button type="button" class="mm-b" id="mmOutlineCancel">取消</button><button class="btn ink sm" id="mmOutlineGenerate" type="submit">开始生成</button></div></form>`;
    $('mmOutlineText').value=draft.text;$('mmOutlineTitle').value=draft.title;$('mmOutlineMode').value='ai';$('mmOutlineSupplement').checked=draft.allowSupplement;
    if(intoMap)$('mmOutlinePlacement').value=canAttach && draft.placement!=='blank'?'node':'blank';
    $('mmOutlineInputSource').value=draft.inputSource || 'text';window.MMAILecture.mount($('mmLectureBox'));
    const form=$('mmOutlineForm');
    function update(){
      const files=$('mmOutlineInputSource').value==='files',more=$('mmOutlineMore');
      if(form.classList.contains('is-lecture')!==files)more.open=!files;
      form.classList.toggle('is-lecture',files);$('mmOutlineSwitchText').hidden=!files;$('mmOutlineInputSource').closest('label').hidden=files;
      $('mmOutlineHeading').textContent=files?'课件 / 讲义生成导图':'大纲 / 正文生成导图';if(files)$('mmOutlineMode').value='ai';
      $('mmOutlineMode').disabled=files;$('mmOutlineInputHelp').hidden=files;$('mmOutlineText').hidden=files;$('mmLectureBox').hidden=!files;
      const title=$('mmOutlineTitle').closest('label'),placement=$('mmOutlinePlacement')?.closest('label');
      if(files)$('mmLectureBox').after(title);else $('mmOutlineInputHelp').after(title);if(placement)title.after(placement);
      window.MMTextTasks.sourceChanged($('mmOutlineInputSource').value);const ai=true;more.hidden=!ai;$('mmOutlineSupplementRow').hidden=!ai;$('mmOutlineModel').hidden=!ai;$('mmOutlineHint').hidden=files;$('mmOutlineFileNote').hidden=!files;
      $('mmOutlineMoreState').textContent=$('mmOutlineSupplement').checked?'已允许补充':'仅依据原讲义';
      $('mmOutlineHint').textContent='完整正文与原图保留；可选先查看识别稿和全文规划，后续生成回读完整依据。';
    }
    $('mmOutlineSwitchText').onclick=()=>{$('mmOutlineInputSource').value='text';$('mmOutlineInputSource').dispatchEvent(new Event('change',{bubbles:true}));};
    $('mmOutlineSupplement').onchange=()=>{$('mmOutlineMoreState').textContent=$('mmOutlineSupplement').checked?'已允许补充':'仅依据原讲义';capture();};
    $('mmOutlineInputSource').onchange=()=>{update();capture();};$('mmOutlinePrompts').onclick=()=>{capture();window.MMAIInspector.open();};
    window.MMTextTasks.mount(form);$('mmOutlineMode').value='ai';update();
    $('mmOutlineCancel').onclick=()=>{capture();dialog.close();};
    $('mmOutlineSettings').onclick=()=>{
      capture();form.dataset.preserveLectureDraft='true';dialog.close();const settings=$('mmAPISettingsDialog');settings.addEventListener('close',()=>{if(!window.MMLocalLecture?.submitting)open(intoMap);},{once:true});$('mmAPISettingsButton').click();
    };
    form.onsubmit=async event=>{
      event.preventDefault();capture();$('mmOutlineError').textContent='';const button=$('mmOutlineGenerate');button.disabled=true;
      try{const input={...draft,placement:intoMap?$('mmOutlinePlacement').value:'new'};if(draft.inputSource==='files')await window.MMAILecture.start(input,{...context,form});else await start(input,{...context,form});}catch(error){if(error.name==='AbortError' && !dialog.open)return;if($('mmOutlineForm')===form && dialog.open)$('mmOutlineError').textContent=error.message;else status(error.message);}
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
  new MutationObserver(()=>{if(shownRecord && !M.state().cur?.outlineSources?.some(r=>r.id===shownRecord.id))panel.hidden=true;}).observe($('mmBox'),{childList:true,subtree:true});
  window.MMAIOutline={open,records,stop,capture,lectureStarted,hideProgress:()=>{panel.hidden=true;},get running(){return !!window.MMLocalLecture?.submitting;}};
})();
