(() => {
 'use strict';
 const M=window.Mindmap,P=window.MMMapLibraryModel,$=id=>document.getElementById(id),E=s=>window.MMContent.escape(String(s??'')),copy=v=>JSON.parse(JSON.stringify(v));
 let catalog=new Map(),loaded=false,refreshing=null,selecting=false,chosen=new Set(),cacheVersion=0,history=[],navigating=false,active=null,preparing=false,progressMap=null;
 const current=()=>M.state().cur;
 const dialog=document.createElement('dialog');dialog.id='mmLibraryDialog';document.body.append(dialog);
 const progress=document.createElement('aside');progress.id='mmMultiProgress';progress.hidden=true;progress.setAttribute('aria-live','polite');document.body.append(progress);
 async function request(url,options){let r;try{r=await fetch(url,options);}catch{throw Error('本地服务未连接，请检查启动窗口');}const data=await r.json();if(!r.ok)throw Error(data.error||'导图库操作失败');return data;}
 const post=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 function message(text){window.showBanner(text);}
 async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{const data=await request('/api/library');catalog=new Map(data.maps.map(m=>[m.id,m]));loaded=true;cacheVersion++;chosen=new Set([...chosen].filter(id=>catalog.has(id)&&!catalog.get(id).unavailable));decorate();if(current())M.refresh();return catalog;})();
  try{return await refreshing;}finally{refreshing=null;}
 }
 const meta=id=>catalog.get(id);
 const missing=id=>loaded&&(!meta(id)||meta(id).unavailable);
 const changed=ref=>!!meta(ref.mapId)&&!meta(ref.mapId).unavailable&&meta(ref.mapId).revision!==ref.revision;
 function renderCard(node){const ref=node.mapLink||{},m=meta(ref.mapId),gone=missing(ref.mapId),title=m?.title||ref.title||'未命名导图';
  return `<div class="mm-map-card"><span class="mm-map-card-kind">导图引用${gone?' · 目标不可用':''}</span><div class="mm-map-card-heading"><b>${E(title)}</b><span class="mm-map-card-link" aria-hidden="true" title="双击打开目标导图">↗</span></div><div class="mm-map-card-preview">${P.svg(m?.preview||ref.preview)}</div><div class="mm-map-card-actions"><button type="button" class="mm-b" data-map-${gone?'relink':'open'}="${E(gone?node.id:ref.mapId)}">${gone?'重新关联':'打开导图 ↗'}</button>${gone?'':`<button type="button" class="mm-b" data-map-split="${E(ref.mapId)}">分屏打开</button>`}</div></div>`;
 }
 function renderReferences(node){if(!Array.isArray(node.mapReferences)||!node.mapReferences.length)return '';const refs=node.mapReferences,updated=refs.some(changed),gone=refs.some(r=>missing(r.mapId));
  return `<button type="button" class="mm-map-refs" data-map-refs="${E(node.id)}" title="打开来源节点">来源 ${refs.length}${gone?' · 目标不可用':updated?' · 已更新':''} ↗</button>`;
 }
 function decorate(){const head=document.querySelector('.mm-library-head');if(!head)return;
  if(!$('mmChooseMaps')){const b=document.createElement('button');b.id='mmChooseMaps';b.className='mm-b';b.type='button';b.dataset.library='select';head.insertBefore(b,head.querySelector('input'));}
  $('mmChooseMaps').textContent=selecting?'退出多选':'多选导图';
  document.querySelectorAll('.mm-card[data-id]').forEach(card=>{const id=card.dataset.id;card.classList.toggle('mm-map-picking',selecting);card.classList.toggle('mm-map-picked',chosen.has(id));let check=card.querySelector('.mm-map-check');
   if(selecting&&!check){check=document.createElement('span');check.className='mm-map-check';card.append(check);}if(check){check.textContent=chosen.has(id)?'✓':'';check.hidden=!selecting;check.setAttribute('aria-hidden','true');}
   if(selecting){card.setAttribute('role','checkbox');card.setAttribute('aria-checked',String(chosen.has(id)));card.setAttribute('aria-label','选择 '+(meta(id)?.title||'导图'));}else{card.setAttribute('role','button');card.removeAttribute('aria-checked');card.setAttribute('aria-label','打开 '+(meta(id)?.title||'导图'));}
  });
  let bar=$('mmSelectionBar');if(!bar){bar=document.createElement('div');bar.id='mmSelectionBar';bar.className='mm-selection-bar';document.querySelector('.mm-home-library').append(bar);}bar.hidden=!selecting;
  if(selecting)bar.innerHTML=`<span>已选 ${chosen.size} 张</span><button class="mm-b" data-library="all">选择可见导图</button><button class="mm-b" data-library="clear">清空</button><button class="mm-b pri" data-library="summarize" ${chosen.size<2?'disabled':''}>多图总结</button><small>选择 2–8 张已保存的导图</small>`;
 }
 function toggle(id){if(!meta(id)||meta(id).unavailable){message('这张导图还没有正式保存，请先打开并保存');return;}if(chosen.has(id))chosen.delete(id);else if(chosen.size<8)chosen.add(id);else message('一次最多选择8张导图');decorate();}
 function selectionEvent(e){if(!selecting||current())return;const card=e.target.closest('.mm-card[data-id]');if(!card)return;if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();toggle(card.dataset.id);}
 document.addEventListener('click',selectionEvent,true);document.addEventListener('keydown',selectionEvent,true);
 async function chooseReference(nodeId=null,at=null){
  const mapId=current()?.id;if(!mapId)return;M.finishEditing();await refresh();if(current()?.id!==mapId)return;
  dialog.innerHTML='<h3>引用其他导图</h3><p>卡片显示名称和布局预览；点击“打开导图”跳转，原导图更新后预览会跟随。</p><input id="mmMapSearch" type="search" placeholder="搜索导图名称" aria-label="搜索导图名称"><div id="mmMapChoices"></div><button class="mm-b" data-library="close">取消</button>';
  function render(){const q=$('mmMapSearch').value.trim().toLowerCase(),maps=[...catalog.values()].filter(m=>m.id!==mapId&&!m.unavailable&&String(m.title).toLowerCase().includes(q));$('mmMapChoices').innerHTML=maps.length?maps.map(m=>`<button type="button" class="mm-map-choice" data-map-pick="${E(m.id)}"><span>${P.svg(m.preview)}</span><b>${E(m.title)}</b><small>${m.nodeCount} 个节点${m.hasDraft?' · 有未保存草稿':''}</small></button>`).join(''):'<p>没有可引用的已保存导图。</p>';}
  $('mmMapSearch').oninput=render;render();dialog.showModal();
  dialog.querySelector('#mmMapChoices').onclick=e=>{const b=e.target.closest('[data-map-pick]');if(!b)return;if(current()?.id!==mapId){dialog.close();return;}const m=meta(b.dataset.mapPick);if(!m)return;
   dialog.close();if(nodeId||at) addReference(m.id,at,nodeId).catch(e=>message(e.message));else beginPlacement(m.id);
  };
 }
 async function navigate(mapId,nodeId=null,back=false,split=false){
  if(window.MMWorkspaceHost){try{return await (back?window.MMWorkspaceHost.back():window.MMWorkspaceHost.navigate(mapId,nodeId,split));}catch(e){message(e.message);return;}}
  if(navigating||!P.validId(mapId))return;if(current()?.id===mapId){if(nodeId&&M.findNode(nodeId))M.selectNode(nodeId);return;}
  navigating=true;try{
   M.finishEditing();await window.MMFiles.flush();const before=current()?{map:M.editingSnapshot(),view:M.view(),selected:M.state().selected}:null;
   const formal=back?null:await request('/api/maps/'+encodeURIComponent(mapId));
   const target=back?history.at(-1)?.map:(window.MMFiles.sessionSnapshot(mapId)||formal);if(!target)return;
   const old=back?history.at(-1):null;await M.openDocument(target);if(current()?.id!==target.id)return;
   if(back){history.pop();M.selectNodes(old.selected);M.restoreView(old.view);}else{if(before){history.push(before);if(history.length>8)history.shift();}if(nodeId){if(M.findNode(nodeId))M.selectNode(nodeId);else message('原节点已移除，已打开所属导图');}}
   onDraw(current());
  }catch(e){message(e.message);refresh().catch(()=>{});}finally{navigating=false;}
 }
 function references(id){const n=M.findNode(id)?.n;if(!n)return;const refs=(n.mapReferences||[]).filter(r=>P.validId(r.mapId)&&P.validId(r.nodeId));
  dialog.innerHTML=`<h3>内容来源</h3><p>定位到生成时引用的原节点。来源有修改时，当前总结保留原版本；可重新总结生成新图。</p><div class="mm-map-source-list">${refs.map((r,i)=>`<button class="mm-map-source" data-map-source-index="${i}"><b>${E(meta(r.mapId)?.title||r.title)}</b><small>${missing(r.mapId)?'目标不可用':changed(r)?'来源已更新':'生成时的来源'} · 定位原节点 ↗</small><span>${E(r.excerpt||'')}</span></button>`).join('')}</div><button class="mm-b" data-library="close">关闭</button>`;dialog.showModal();
  dialog.querySelector('.mm-map-source-list').onclick=e=>{const b=e.target.closest('[data-map-source-index]');if(b){const ref=refs[Number(b.dataset.mapSourceIndex)];dialog.close();navigate(ref.mapId,ref.nodeId);}};
 }
 function onDraw(map){if(!map)return;if(placement && placement.currentId!==map.id)cancelPlacement();if(!active&&progressMap!==map.id)progress.hidden=true;const tools=document.querySelector('.mm-tools');if(!tools)return;
  let host=$('mmLibraryTools');if(!host){host=document.createElement('div');host.id='mmLibraryTools';host.className='mm-tg';tools.append(host);}
  const info=map.mapSummary,updated=info?.sources?.filter(changed).length||0,gone=info?.sources?.filter(s=>missing(s.mapId)).length||0;
  const html=`${history.length?'<button class="mm-b" data-library="back">← 返回上一张导图</button>':''}<button class="mm-b" data-library="reference">引用导图</button>${info?`<button class="mm-b" data-library="sources">总结来源${gone?' · 目标不可用':updated?' · '+updated+'张已更新':''}</button><button class="mm-b" data-library="regenerate">重新总结为新图</button>`:''}`;
  if(host.innerHTML!==html)host.innerHTML=html;
 }
 function sourcesDialog(record=current()?.mapSummary){if(!record)return;
  dialog.innerHTML=`<h3>总结来源与生成记录</h3><p>${E(record.status==='completed'?'已完成':record.status==='running'?'生成中':'未完成，已保留可用内容')} · 使用正式保存的版本 · 重新总结会创建新图</p><div class="mm-map-source-list">${record.sources.map((s,i)=>`<button class="mm-map-source" data-summary-source="${i}"><b>${E(meta(s.mapId)?.title||s.title)}</b><small>${missing(s.mapId)?'目标不可用':changed(s)?'来源已更新':'来源版本未变'} ↗</small></button>`).join('')}</div>${record.error?`<p role="alert">${E(record.error)}</p>`:''}<details><summary>生成过程与提示词</summary><p>逐图分批梳理 → 跨图归并 → 来源校验 → 数学排版检查 → 结构复核 → 生成新图。</p><pre class="mm-map-audit">${E(JSON.stringify(record.audit||{},null,2))}</pre><button class="mm-b" data-library="prompts">查看提示词</button></details><button class="mm-b" data-library="close">关闭</button>`;
  dialog.showModal();dialog.querySelector('.mm-map-source-list').onclick=e=>{const b=e.target.closest('[data-summary-source]');if(b){dialog.close();navigate(record.sources[Number(b.dataset.summarySource)].mapId);}};
 }
 async function summaryDialog(ids=[...chosen],previous=null){
  if(active||preparing||window.MMAILecture?.running||window.MMAIOutline?.running||window.MMAIStructureReview?.running){message('请先完成或停止当前生成');return;}
  await refresh();const sources=ids.map(meta);if(sources.length<2||sources.length>8||sources.some(m=>!m||m.unavailable)){message('请选择2–8张仍存在的已保存导图');return;}
  const defaults=previous||{title:sources.map(s=>s.title).join('、').slice(0,60)+' · 总结',goal:'fusion',detail:'standard',instructions:''};
  dialog.innerHTML=`<form id="mmMultiForm"><h3>多图总结</h3><p>读取以下导图的正式保存版本，生成一张新导图。原图保持原样。</p><ul>${sources.map(s=>`<li>${E(s.title)}${s.hasDraft?' <strong>（有未保存草稿，本次读取正式版本）</strong>':''}</li>`).join('')}</ul><p>总结文字节点；图片、PDF和引用卡片需先整理为文字内容。较长资料会分批处理并多次调用当前模型。</p><label>新导图名称<input id="mmMultiTitle" maxlength="80" required value="${E(defaults.title)}"></label><label>总结方式<select id="mmMultiGoal"><option value="review">逐图回顾</option><option value="fusion">按主题融合</option><option value="compare">比较异同</option></select></label><label>内容体量<select id="mmMultiDetail"><option value="brief">简明概览</option><option value="standard">标准总结</option></select></label><label>补充要求<textarea id="mmMultiInstructions" maxlength="1200" rows="3" placeholder="例如：梳理共同概念，标明各章节之间的前后联系"></textarea></label><p>复用已有“大模型 API 接入”。<button type="button" class="mm-b" data-library="prompts">查看提示词</button></p><p id="mmMultiError" role="alert"></p><div class="mm-label-buttons"><button type="button" class="mm-b" data-library="close">取消</button><button type="submit" class="mm-b pri" id="mmMultiStart">开始总结</button></div></form>`;
  $('mmMultiGoal').value=defaults.goal;$('mmMultiDetail').value=defaults.detail;$('mmMultiInstructions').value=defaults.instructions;
  $('mmMultiForm').onsubmit=async e=>{e.preventDefault();$('mmMultiStart').disabled=true;const input={sources:sources.map(s=>({mapId:s.id,revision:s.revision})),title:$('mmMultiTitle').value.trim(),goal:$('mmMultiGoal').value,detail:$('mmMultiDetail').value,instructions:$('mmMultiInstructions').value};try{await start(input);}catch(error){if(dialog.open&&$('mmMultiError'))$('mmMultiError').textContent=error.message;else message(error.message);}finally{if($('mmMultiStart'))$('mmMultiStart').disabled=false;}};dialog.showModal();
 }
 function showProgress(text,running=false){progressMap=current()?.id;progress.hidden=false;
  if(!progress.querySelector('[data-multi-status]'))progress.innerHTML='<b>多图总结</b><p data-multi-status></p><div data-usage-host></div><div data-multi-actions></div>';
  progress.querySelector('[data-multi-status]').textContent=text;progress.querySelector('[data-multi-actions]').innerHTML=running?'<button class="mm-b" data-library="stop">停止</button>':'<button class="mm-b" data-library="sources">查看来源与过程</button><button class="mm-b" data-library="hide">收起</button>';
  active?.usage?.update(null,{stage:text,nodeCount:active.record.generatedIds?.length||0});
 }
 function check(run){if(current()?.id!==run.mapId)throw Error('导图已切换，结果保留在新导图草稿中');if(run.stopped)throw new DOMException('已停止','AbortError');}
 function save(run){if(current()?.id!==run.mapId)return;current().mapSummary=copy(run.record);M.saveOutlineSource({...run.record,mode:'map-summary',generatedIds:Object.values(run.batch.mapping||{})});window.MMFiles.queue(current());}
 function attachSources(run){const map=current(),bounds=[...M.state().L.nodes.values()],x=bounds.length?Math.min(...bounds.map(b=>b.x))-380:-380,y=bounds.length?Math.min(...bounds.map(b=>b.y)):0;
  for(const [i,s]of run.record.sources.entries()){const id=crypto.randomUUID();map.nodes.push({id,text:'# '+s.title,children:[],mapLink:{mapId:s.mapId,title:s.title,revision:s.revision,preview:copy(s.preview)}});(map.pos||={})[id]={x,y:y+i*300};(map.size||={})[id]={w:300,h:260};}
 }
 function applyResult(run,graph){check(run);const result=M.appendAIResult(run.mapId,null,graph,run.record.title,run.batch,true);run.record.generatedIds=result.ids;}
 function finishLayout(run){M.finalizeAIOrganization(run.batch);if(!run.linksAdded){M.editMap(()=>attachSources(run));run.linksAdded=true;}M.fitView();}
 function partialGraph(fragments){const nodes=[],edges=[];let first=null;for(const [i,f]of fragments.entries()){const part=f.nodes.slice(0,Math.max(0,36-nodes.length));if(!part.length)break;const ids=new Map(part.map((n,j)=>[n.id,'p'+i+'_'+j]));for(const n of part)nodes.push({...n,id:ids.get(n.id),parentId:ids.get(n.parentId)});for(const e of f.edges||[])if(ids.has(e.from)&&ids.has(e.to))edges.push({...e,from:ids.get(e.from),to:ids.get(e.to)});if(first)edges.push({from:first,to:ids.get(part[0].id),kind:'relation',label:'逐图结果'});else first=ids.get(part[0].id);}return{nodes,edges};}
 async function start(input){
  if(active||preparing)throw Error('已有多图总结正在进行');preparing=true;let run,job;
  try{
   const status=await request('/api/ai/status');if(!status.available)throw Error('请先在已有“大模型 API 接入”中配置模型');
   M.finishEditing();await window.MMFiles.flush();job=await request('/api/ai/map-summary',post(input));dialog.close();
   const mapId=await M.createOutlineDocument(input.title);if(!mapId)throw Error('新导图未打开，任务已停止');
   run={jobId:job.id,mapId,stopped:false,record:{id:crypto.randomUUID(),title:input.title,status:'running',sources:job.sources,options:job.options,createdAt:Date.now(),audit:{}},batch:{kind:'outline'}};run.batch.recordId=run.record.id;active=run;preparing=false;showProgress('正在总结',true);progress.querySelector('[data-usage-host]').replaceChildren();run.usage=window.MMAIUsage.attach(progress.querySelector('[data-usage-host]'),{mapId});save(run);
   let failures=0,lastKey='';const started=Date.now();
   while(true){run.usage.update(job,{stage:job.stage});check(run);const key=job.status+':'+job.fragments.length+':'+job.stage;showProgress(job.stage||'正在总结',true);if(key!==lastKey){run.record.audit=job.audit;run.record.fragments=job.fragments;save(run);lastKey=key;}
    if(job.status!=='running')break;if(Date.now()-started>16*60*1000)throw Error('总结等待超时');
    await new Promise(resolve=>setTimeout(resolve,850));check(run);
    try{job=await request('/api/ai/map-summary/'+run.jobId);failures=0;}catch(e){if(++failures>=3)throw e;}
   }
   check(run);run.record.audit=job.audit;run.record.fragments=job.fragments;if(job.status!=='completed')throw Error(job.error||'总结未完成');
   applyResult(run,job.summary);
   const reviewed=await window.MMAIStructureReview.run({mapId,ids:Object.values(run.batch.mapping),signal:(run.controller=new AbortController()).signal,onStage:s=>showProgress(s,true),onUsage:data=>run.usage.update(data),onAudit:a=>{run.record.audit.structureReview=a;run.usage.update(a);save(run);}});check(run);if(reviewed.plan)run.batch.structurePlan=reviewed.plan;finishLayout(run);
   run.record.status='completed';run.record.finishedAt=Date.now();delete run.record.fragments;save(run);M.refresh();const saved=await window.MMFiles.save();showProgress(saved?'总结已生成并保存，点击节点的“来源”可跳转。':'总结已生成，正式保存失败，草稿已保留。');selecting=false;chosen.clear();await refresh().catch(()=>{});
  }catch(error){
   if(run&&current()?.id===run.mapId){run.record.status=run.stopped?'stopped':'failed';run.record.error=run.stopped?'已停止，完成的逐图结果已保留':error.message;
    if(!run.interrupted&&!Object.keys(run.batch.mapping||{}).length&&job?.fragments?.length){const graph=partialGraph(job.fragments);
     // A partial document is deliberately bounded; all other finished chunks stay in its process record.
     try{applyResult({...run,stopped:false},graph);}catch{}
    }
    if(!run.interrupted&&Object.keys(run.batch.mapping||{}).length)finishLayout(run);save(run);M.refresh();await window.MMFiles.flush();showProgress(run.record.error+'；可用内容保留在草稿和生成过程里。');
   }else if(!run)throw error;
  }finally{run?.usage?.finish(run.record.status);preparing=false;if(job?.id)fetch('/api/ai/map-summary/'+job.id,{method:'DELETE'}).catch(()=>{});if(run)M.endAIBatch(run.batch);if(active===run)active=null;}
 }
 function stop(interrupted=false){if(!active)return;active.interrupted ||= interrupted;active.stopped=true;active.controller?.abort();if(active.record.status==='running'){active.record.status='stopped';active.record.error='总结已停止，完成的逐图结果保存在生成过程里';save(active);}fetch('/api/ai/map-summary/'+active.jobId,{method:'DELETE',keepalive:true}).catch(()=>{});}
 document.addEventListener('click',e=>{
  const open=e.target.closest('[data-map-open]'),split=e.target.closest('[data-map-split]'),relink=e.target.closest('[data-map-relink]'),refs=e.target.closest('[data-map-refs]');
  if(open||split||relink||refs){e.preventDefault();e.stopPropagation();if(open)navigate(open.dataset.mapOpen);if(split)navigate(split.dataset.mapSplit,null,false,true);if(relink)chooseReference(relink.dataset.mapRelink).catch(e=>message(e.message));if(refs)references(refs.dataset.mapRefs);return;}
  const b=e.target.closest('[data-library]');if(!b)return;const action=b.dataset.library;
  if(action==='close')dialog.close();if(action==='select'){selecting=!selecting;chosen.clear();refresh().catch(e=>message(e.message));decorate();}
  if(action==='clear'){chosen.clear();decorate();}if(action==='all'){for(const card of document.querySelectorAll('.mm-card[data-id]'))if(chosen.size<8&&meta(card.dataset.id)&&!meta(card.dataset.id).unavailable)chosen.add(card.dataset.id);decorate();}
  if(action==='summarize')summaryDialog().catch(e=>message(e.message));if(action==='reference')chooseReference().catch(e=>message(e.message));if(action==='back')navigate(history.at(-1)?.map.id,null,true);
  if(action==='sources')sourcesDialog();if(action==='regenerate'){const info=current()?.mapSummary;if(info)summaryDialog(info.sources.map(s=>s.mapId),info.options).catch(e=>message(e.message));}
  if(action==='stop')stop();if(action==='hide')progress.hidden=true;if(action==='prompts'){dialog.close();window.MMAIInspector.open();}
 });
 document.addEventListener('pointerdown',e=>{if(e.target.closest('[data-map-open],[data-map-split],[data-map-relink],[data-map-refs]'))e.stopPropagation();},true);
 window.addEventListener('mm:ai-interrupt',()=>stop(true));
 window.addEventListener('beforeunload',()=>stop(true));window.addEventListener('focus',()=>refresh().catch(()=>{}));window.addEventListener('mm:files-saved',()=>refresh().catch(()=>{}));
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;if(!current()){if(history.length)history=[];if(!$('mmChooseMaps'))decorate();progress.hidden=true;}else if(active&&current().id!==active.mapId)stop();});}).observe($('mmBox'),{childList:true,subtree:true});
 function contextMenu(cx,cy,at){let menu=$('mmLibraryMenu');if(!menu){menu=document.createElement('div');menu.id='mmLibraryMenu';menu.className='mm-ctx';$('mmBox').append(menu);}menu.innerHTML='<button type="button">引用其他导图</button>';menu.querySelector('button').onclick=()=>{menu.classList.add('hidden');chooseReference(null,at).catch(e=>message(e.message));};window.MMContextMenus.place(menu,cx,cy);}
 let placement=null,lastPlaced=0;
 async function addReference(mapId,at,nodeId=null){const source=current()?.id;if(!source)throw Error('请先打开一张导图');if(mapId===source)throw Error('不能在导图中引用自身');if(!meta(mapId)||missing(mapId))await refresh();const target=meta(mapId);if(!target||target.unavailable)throw Error('目标导图不可用');if(current()?.id!==source)throw Error('导图已切换，请重新放置引用');
  let id=nodeId;const ref={mapId:target.id,title:target.title,revision:target.revision,preview:copy(target.preview)};
  M.editMap(()=>{const map=current();if(id){const n=M.findNode(id)?.n;if(!n?.mapLink)throw Error('引用卡片已移除');n.mapLink=ref;n.text='# '+target.title;}else{if(!at||![at.x,at.y].every(Number.isFinite))throw Error('请点击画布确定卡片位置');id=crypto.randomUUID();map.nodes.push({id,text:'# '+target.title,children:[],mapLink:ref});(map.pos||={})[id]={x:at.x,y:at.y};(map.size||={})[id]={w:300,h:260};}});M.selectNode(id);return id;
 }
 function cancelPlacement(){placement=null;document.getElementById('mmView')?.classList.remove('mm-reference-placing');document.getElementById('mmPlacementGhost')?.remove();}
 function beginPlacement(mapId){if(!current())return message('请先打开一张导图');if(mapId===current().id)return message('不能在导图中引用自身');cancelPlacement();placement={mapId,currentId:current().id};const view=$('mmView');view.classList.add('mm-reference-placing');message('点击画布放置引用卡片；按 Esc 取消。');
  if(!view.dataset.referencePlacement){view.dataset.referencePlacement='true';view.addEventListener('pointermove',e=>{if(!placement)return;let ghost=$('mmPlacementGhost');if(!ghost){ghost=document.createElement('div');ghost.id='mmPlacementGhost';ghost.className='mm-reference-ghost';ghost.textContent=meta(placement.mapId)?.title||'引用导图';view.append(ghost);}const r=view.getBoundingClientRect(),k=M.view().k;ghost.style.cssText=`left:${e.clientX-r.left}px;top:${e.clientY-r.top}px;width:${300*k}px;height:${260*k}px`;});
   view.addEventListener('pointerdown',e=>{if(!placement||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const id=placement.mapId,at=M.clientPoint(e.clientX,e.clientY);cancelPlacement();lastPlaced=Date.now();addReference(id,at).then(()=>message('引用已放置，双击卡片打开；右键可分屏打开。')).catch(e=>message(e.message));},true);
   for(const type of ['click','dblclick'])view.addEventListener(type,e=>{if(Date.now()-lastPlaced<600){e.preventDefault();e.stopImmediatePropagation();}},true);
  }
 }
 document.addEventListener('keydown',e=>{if(placement&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelPlacement();message('已取消放置');}},true);
 window.MMLibrary={referenceTitle:n=>meta(n.mapLink?.mapId)?.title || n.mapLink?.title || n.text,beginPlacement,addReference,get placing(){return !!placement;},showRecord:sourcesDialog,contextMenu,renderCard,renderReferences,onDraw,decorate,refresh,chooseReference,navigate,summaryDialog,start,get cacheVersion(){return cacheVersion;},get running(){return !!active||preparing;}};
 decorate();refresh().catch(()=>{});
})();
