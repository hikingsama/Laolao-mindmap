(() => {
 'use strict';
 const M=window.Mindmap,P=window.MMAILecturePlan,S=window.MMAISummary,$=id=>document.getElementById(id),esc=window.MMContent.escape;
 let picked=[],active=null,preparing=false,ui=null;
 const preferences={strategy:'branches',reading:'auto'};
 function rememberPreferences(){if(!ui?.container.isConnected)return;preferences.strategy=ui.container.querySelector('#mmLectureStrategy').value;preferences.reading=ui.container.querySelector('#mmLectureReading').value;}
 function reset(){rememberPreferences();picked=[];if(ui?.container.isConnected){ui.container.querySelector('#mmLecturePicker').value='';render();}}
 const panel=document.createElement('section');panel.className='mm-outline-progress mm-lecture-progress';panel.hidden=true;
 panel.innerHTML='<b>课件 / 讲义生成导图</b><p role="status" aria-live="polite"></p><div data-usage-host></div><div class="mm-outline-actions"><button type="button" class="mm-b" data-lecture-inspect>查看生成过程</button><button type="button" class="mm-b" data-lecture-stop>停止</button><button type="button" class="mm-b" data-lecture-hide hidden>收起</button></div>';
 document.body.appendChild(panel);let shown=null;
 function status(text,running=false){active?.usage?.update(null,{stage:text,nodeCount:active.record.generatedIds?.length||0,coverage:active.record.documents.reduce((s,d)=>s+(d.processedPages?.length||0),0)+' / '+active.record.documents.reduce((s,d)=>s+d.pageCount,0)+' 页已整理'});panel.hidden=false;panel.querySelector('p').textContent=text;panel.querySelector('[data-lecture-stop]').hidden=!running;panel.querySelector('[data-lecture-hide]').hidden=running;}
 function check(run){run.controller.signal.throwIfAborted();if(active!==run || M.state().cur?.id!==run.mapId || run.sourceId && !M.findNode(run.sourceId))throw new DOMException('已停止或切换导图','AbortError');}
 function save(run){if(M.state().cur?.id!==run.mapId)return;run.record.generatedIds=[...new Set([...Object.values(run.batch.mapping || {}).filter(id=>M.findNode(id)),...(run.record.extraIds || [])])];for(const d of run.record.documents)d.pdfNodeId=run.batch.mapping?.['pdf-'+d.id] || d.pdfNodeId;run.record.updatedAt=Date.now();M.saveOutlineSource(run.record);shown=run.record;}
 function stop(reason='已停止，已完成的节点、原文出处和处理范围已保留。'){
   const run=active;if(!run)return;active=null;run.controller.abort();M.endAIBatch(run.batch);run.usage?.finish('stopped');run.record.status='stopped';for(const d of run.record.documents)if(d.status==='running')d.status='stopped';for(const r of run.record.runs)if(r.status==='running')r.status='stopped';save(run);status(reason);
 }
 async function request(url,options={}){let r;try{r=await fetch(url,options);}catch(e){if(e.name==='AbortError')throw e;throw new Error('连接本地 AI 服务失败，请确认服务正在运行');}const data=await r.json();if(!r.ok)throw new Error(data.error || '课件整理失败');return data;}
 const delay=signal=>new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},180);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 async function job(run,payload,phase,onGraph){
   if(new TextEncoder().encode(JSON.stringify(M.state().cur)).length>window.MMCapacity.documentWarnBytes)throw new Error('当前导图JSON已超过480 MiB，接近512 MiB保存上限；未继续调用模型，请先拆分或精简生成记录');
   const id=crypto.randomUUID(),signal=run.controller.signal;phase.id=id;phase.status='running';run.record.runs.push(phase);save(run);
   try{
     let data=await request('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:id}),signal});const began=Date.now();let retries=0;
     const usageData=data=>{run.usage.update(data);if(data.calls)phase.calls=data.calls;};usageData(data);
     while(data.status==='running'){
       usageData(data);check(run);if(!phase.inspection && data.inspection){phase.inspection=data.inspection;save(run);}if(data.graph?.nodes?.length)onGraph?.(data.graph,false);
       status(`${phase.title} · ${data.stage || '正在整理'} · ${Math.floor((Date.now()-began)/1000)} 秒`,true);
       if(Date.now()-began>window.MMCapacity.pollTimeoutMs)throw new Error('本批等待超时，未自动重试付费请求');await delay(signal);
       try{data=await request('/api/ai/jobs/'+id,{signal});retries=0;}catch(e){if(e.name==='AbortError' || ++retries>=3 || !e.message.startsWith('连接本地'))throw e;}
     }
     usageData(data);check(run);if(data.inspection)phase.inspection=data.inspection;
     if(data.status!=='completed')throw new Error(data.error || '本批整理未完成');
     onGraph?.(data.summary,true);phase.status='completed';save(run);return data.summary;
   }catch(e){phase.status=signal.aborted?'stopped':'failed';phase.error=e.message;save(run);throw e;}
   finally{fetch('/api/ai/jobs/'+id,{method:'DELETE'}).catch(()=>{});}
 }
 function wrapper(run,graph,document,phase){
   phase.names ||= new Map();for(const n of graph.nodes)if(!phase.names.has(n.id))phase.names.set(n.id,'g'+phase.order+'_'+phase.names.size);
   const first={id:'lecture_root',layoutRole:'overview',title:run.record.title,text:run.record.strategy==='fusion'?'按共同主题整理多份讲义；详细章节可从生成记录展开。':'按讲义与章节组织；节点出处可返回原PDF页面。',origin:'source'},nodes=[first],edges=[];
   let parent=first.id;
   if(document){const docId='d_'+document.id;nodes.push({id:docId,layoutRole:'document',parentId:first.id,title:document.name.slice(0,160),text:'共 '+document.pageCount+' 页；本文件的处理范围见生成过程。',origin:'source'});edges.push({from:first.id,to:docId,kind:'contains'});parent=docId;}
   for(const n of graph.nodes)nodes.push({...n,id:phase.names.get(n.id),...(n.parentId?{parentId:phase.names.get(n.parentId)}:{}),...(!n.topic && n.id===graph.nodes[0].id?{layoutRole:'overview'}:{})});
   for(const e of graph.edges)edges.push({...e,from:phase.names.get(e.from),to:phase.names.get(e.to)});
   if(graph.nodes[0])edges.push({from:parent,to:phase.names.get(graph.nodes[0].id),kind:'contains'});
   return{nodes,edges};
 }
 function apply(run,graph,sourceDoc,phase,final){
   check(run);const plan=wrapper(run,graph,sourceDoc,phase),signature=JSON.stringify(plan);if(!final && phase.signature===signature)return;phase.signature=signature;
   const result=M.appendAIResult(run.mapId,run.sourceId,plan,run.record.title,run.batch,false);phase.generatedIds=[...phase.names.values()].map(key=>run.batch.mapping[key]).filter(Boolean);save(run);
   requestAnimationFrame(()=>{for(const id of result.ids){const el=document.querySelector('.mm-node[data-id="'+id+'"]');if(el){el.classList.add('mm-ai-node-enter');setTimeout(()=>el.classList.remove('mm-ai-node-enter'),400);}}});
 }
 function markCoverage(run,document,pages){
   const coverage=run.coverage[document.id] ||= new Map();for(const p of pages){let c=coverage.get(p.page);if(!c)coverage.set(p.page,c={parts:p.parts,done:new Set()});c.done.add(p.part);}
   document.processedPages=[...coverage].filter(([,c])=>c.done.size===c.parts).map(([n])=>n).sort((a,b)=>a-b);save(run);
 }
 function hints(){
   if(!ui?.container.isConnected)return;
   const reading=ui.container.querySelector('#mmLectureReading').value,strategy=ui.container.querySelector('#mmLectureStrategy').value;
   ui.container.querySelector('#mmLectureStrategyHelp').textContent=strategy==='fusion'?'归并共同主题，会增加汇总调用。':'保留各份讲义的章节与分支。';
   ui.container.querySelector('#mmLectureReadingHelp').textContent=reading==='text'?'不发送页图；扫描件请使用自动识别。':reading==='visual'?'逐页使用视觉读取，需要视觉模型。':'按需读取文字与页图，需要视觉模型。';
 }
 function render(){
   if(!ui?.container.isConnected)return;const list=ui.container.querySelector('[data-lecture-list]');
   const failed=picked.filter(e=>e.error).length;
   ui.container.querySelector('#mmLectureFileStatus').textContent=picked.length?`已添加 ${picked.length} 个 PDF 文件${failed?'，'+failed+' 个读取失败':''}`:'尚未添加文件';
   ui.container.querySelector('.mm-lecture-bulk').hidden=picked.length<2;
   ui.container.querySelector('#mmLectureEmbedHelp').hidden=!picked.length;list.hidden=!picked.length;
   list.innerHTML=picked.map((e,i)=>`<div class="mm-lecture-file${e.error?' is-error':''}"><div><b>${i+1}. ${esc(e.file.name)}</b><small>${e.error?esc(e.error):e.pageCount?e.pageCount+' 页 · '+Math.ceil(e.file.size/1024)+' KB':'正在读取页数…'}</small><label><input type="checkbox" data-lecture-embed="${e.id}" ${e.embed?'checked':''}>嵌入到导图</label></div><div class="mm-lecture-file-actions"><button class="mm-b" type="button" data-lecture-move="${e.id}" data-offset="-1" ${i===0?'disabled':''} aria-label="上移文件">↑</button><button class="mm-b" type="button" data-lecture-move="${e.id}" data-offset="1" ${i===picked.length-1?'disabled':''} aria-label="下移文件">↓</button><button class="mm-b" type="button" data-lecture-remove="${e.id}">移除</button></div></div>`).join('');
 }
 function mount(container){
   rememberPreferences();ui={container};container.innerHTML=`
     <div class="mm-lecture-upload">
       <div class="mm-lecture-upload-head"><span class="mm-lecture-filetype" aria-hidden="true">PDF</span><div class="mm-lecture-upload-copy"><b>课件与讲义</b><span id="mmLectureFileStatus" role="status" aria-live="polite">尚未添加文件</span></div><button id="mmLectureAddFiles" class="mm-b" type="button" aria-controls="mmLecturePicker">添加文件</button></div>
       <p class="mm-lecture-upload-note">支持多份 PDF，每份最多 50 MB；PPT/PPTX 请先导出为 PDF。</p>
       <input id="mmLecturePicker" type="file" multiple accept="application/pdf,.pdf" aria-label="添加 PDF 文件" hidden>
     </div>
     <div class="mm-lecture-bulk" hidden><span>保留原 PDF</span><button type="button" class="mm-b" data-lecture-all="1">全部嵌入到导图</button><button type="button" class="mm-b" data-lecture-all="0">全部不嵌入</button></div>
     <div data-lecture-list class="mm-lecture-files" hidden></div><p id="mmLectureEmbedHelp" class="mm-lecture-help" hidden>勾选“嵌入到导图”可保留可阅读的原 PDF。</p>
     <div class="mm-lecture-options"><div><label>组织方式<select id="mmLectureStrategy" aria-describedby="mmLectureStrategyHelp"><option value="branches">按讲义分支</option><option value="fusion">跨讲义主题融合</option></select></label><p id="mmLectureStrategyHelp" class="mm-lecture-help"></p></div><div><label>读取方式<select id="mmLectureReading" aria-describedby="mmLectureReadingHelp"><option value="auto">自动识别文字与图像</option><option value="visual">图文理解（每页使用视觉）</option><option value="text">仅提取文字</option></select></label><p id="mmLectureReadingHelp" class="mm-lecture-help"></p></div></div>`;
   container.querySelector('#mmLectureStrategy').value=preferences.strategy;container.querySelector('#mmLectureReading').value=preferences.reading;
   container.querySelector('#mmLectureAddFiles').onclick=()=>container.querySelector('#mmLecturePicker').click();
   container.querySelector('input[type=file]').onchange=e=>{const files=[...e.target.files];e.target.value='';for(const file of files){const entry={id:crypto.randomUUID(),file,embed:true,pageCount:null,error:''};picked.push(entry);entry.ready=window.MMPDFSource.metadata(file).then(count=>{entry.pageCount=count;}).catch(error=>{entry.error=error.message;}).finally(render);}render();};
   container.addEventListener('change',e=>{rememberPreferences();hints();const id=e.target.dataset.lectureEmbed;if(id){const entry=picked.find(f=>f.id===id);if(entry)entry.embed=e.target.checked;}});
   container.addEventListener('click',e=>{
     const remove=e.target.closest('[data-lecture-remove]');if(remove)picked=picked.filter(f=>f.id!==remove.dataset.lectureRemove);
     const move=e.target.closest('[data-lecture-move]');if(move){const i=picked.findIndex(f=>f.id===move.dataset.lectureMove),j=i+Number(move.dataset.offset);if(j>=0 && j<picked.length)[picked[i],picked[j]]=[picked[j],picked[i]];}
     const all=e.target.closest('[data-lecture-all]');if(all)for(const f of picked)f.embed=all.dataset.lectureAll==='1';if(remove || move || all)render();
   });hints();render();
 }
 async function start(input,context){
   if(active || preparing)throw new Error('已有课件生成任务，请先停止或等待完成');if(!picked.length)throw new Error('请先选择课件或讲义PDF');
   preparing=true;const selection=[...picked],strategy=$('mmLectureStrategy').value,reading=$('mmLectureReading').value;
   const checkForm=()=>{if(context.form && (!context.form.isConnected || !context.form.closest('dialog')?.open || $('mmOutlineForm')!==context.form))throw new DOMException('已取消生成','AbortError');};
   try{
     await Promise.all(selection.map(e=>e.ready));checkForm();const eligible=selection.filter(e=>!e.error && e.pageCount);
     if(!eligible.length)throw new Error('没有可读取的PDF，请移除错误文件后重新选择');
     const model=await request('/api/ai/status');checkForm();if(!model.available)throw new Error('请先在现有“大模型 API 接入”中保存配置');
     if(context.mapId && M.state().cur?.id!==context.mapId)throw new Error('导图已切换，请重新打开生成窗口');
     if(input.placement==='node' && !M.findNode(context.sourceId))throw new Error('来源节点已删除，请改为生成到空白区域');
     M.finishEditing();window.MMAIOutline.hideProgress();
     const title=input.title.trim() || (selection.length===1?selection[0].file.name.replace(/\.pdf$/i,''):'多讲义学习导图');
     let mapId=context.mapId;if(input.placement==='new'){mapId=await M.createOutlineDocument(title);checkForm();if(!mapId)throw new Error('未能打开新导图');}
     const documents=selection.map((e,index)=>({id:e.id,order:index+1,name:e.file.name,pageCount:e.pageCount || 0,embedded:!!e.embed,status:e.error?'failed':'queued',error:e.error || '',processedPages:[]}));
     const record={id:crypto.randomUUID(),title,text:documents.map(d=>d.name+' · '+d.pageCount+'页').join('\n'),mode:'lecture',strategy,reading,allowSupplement:!!input.allowSupplement,status:'running',createdAt:Date.now(),model:model.model,documents,runs:[],sections:[],generatedIds:[]};
     const run={mapId,sourceId:input.placement==='node'?context.sourceId:null,controller:new AbortController(),record,coverage:{},order:0,newDocument:input.placement==='new',batch:{kind:'outline',lecture:true,recordId:record.id,allowSupplement:record.allowSupplement,documents:documents.filter(d=>d.pageCount>0),pdfAssets:[]}};
     active=run;panel.querySelector('[data-usage-host]').replaceChildren();run.usage=window.MMAIUsage.attach(panel.querySelector('[data-usage-host]'),{mapId});save(run);status('正在读取课件并准备原PDF…',true);window.MMAIOutline.lectureStarted();
     try{
       // The center and selected PDFs belong to the same generation undo batch.
       M.appendAIResult(mapId,run.sourceId,{nodes:[{id:'lecture_root',layoutRole:'overview',title:record.title,text:'正在逐页整理；查看生成过程可确认处理范围。',origin:'source'}],edges:[]},record.title,run.batch,false);save(run);
       for(const entry of eligible){check(run);const document=documents.find(d=>d.id===entry.id);if(entry.embed){status('正在嵌入到导图：'+entry.file.name,true);const media=await window.MMFiles.stagePDF(entry.file,mapId,run.controller.signal);check(run);document.mediaId=media.id;run.batch.pdfAssets.push({documentId:entry.id,media});M.appendAIResult(mapId,run.sourceId,{nodes:[{id:'lecture_root',layoutRole:'overview',title:record.title,text:'正在逐页整理。',origin:'source'}],edges:[]},record.title,run.batch,false);save(run);}}
       const fragments=[];
       for(const entry of eligible){
         check(run);const document=documents.find(d=>d.id===entry.id);document.status='running';save(run);
         try{
           for await(const batch of window.MMPDFSource.batches(entry,{signal:run.controller.signal,reading,onPage:(page,total)=>{check(run);document.readPage=page;status(`读取 ${entry.file.name} · 第 ${page}/${total} 页`,true);}})){
             check(run);const pages=[...new Set(batch.pages.map(p=>p.page))],phase={order:++run.order,stage:'extract',documentId:entry.id,pages,title:entry.file.name+' · 第'+pages.join(',')+'页'};
             const payload={mode:'lecture',outline:{allowSupplement:record.allowSupplement},messages:[{role:'user',content:'整理本批讲义页面'}],fileTask:{stage:'extract',strategy,documents:[{id:entry.id,name:entry.file.name,pageCount:entry.pageCount}],topicHints:[...new Set(fragments.flatMap(f=>f.nodes.map(n=>n.topic).filter(Boolean)))].slice(0,40),pages:batch.pages},...(batch.images.length?{media:{kind:'pdf',name:entry.file.name,images:batch.images}}:{})};
             const summary=await job(run,payload,phase,strategy==='branches'?(g,final)=>apply(run,g,document,phase,final):null);
             fragments.push(P.compact(summary));record.sections.push({id:phase.id,runId:phase.id,documentId:entry.id,title:summary.title,pages,generatedIds:phase.generatedIds || []});markCoverage(run,document,batch.pages);
           }
           document.status='completed';save(run);
         }catch(error){check(run);document.status='failed';document.error=error.message;save(run);if(/密钥|验证失败|拒绝访问|平台拒绝|模型权限|额度|限流|保存上限/.test(error.message))throw error;}
       }
       check(run);
       if(strategy==='fusion' && fragments.length){
         let level=fragments,round=0;
         for(;;){
           const groups=P.groups(level);if(++round>16)throw new Error('主题汇总层级过多，章节结果已保留，可从生成记录展开');const next=[];
           for(let i=0;i<groups.length;i++){
             const phase={order:++run.order,stage:'merge',round,title:'主题融合 · 第'+round+'轮 '+(i+1)+'/'+groups.length};
             const payload={mode:'lecture',outline:{allowSupplement:record.allowSupplement},messages:[{role:'user',content:'基于章节结果生成主题概览'}],fileTask:{stage:'merge',strategy:'fusion',documents:documents.filter(d=>d.pageCount>0),fragments:groups[i]}};
             const summary=await job(run,payload,phase,groups.length===1?(g,final)=>apply(run,g,null,phase,final):null);next.push(P.compact(summary));
           }
           if(groups.length===1)break;level=next;
         }
       }
       const finished=documents.filter(d=>d.status==='completed').length,failed=documents.filter(d=>d.status==='failed').length;
       const structure=await window.MMAIStructureReview.run({mapId:run.mapId,ids:Object.values(run.batch.mapping || {}),signal:run.controller.signal,onStage:text=>status(text,true),onUsage:data=>run.usage.update(data),onAudit:audit=>{record.structureReview=audit;run.usage.update(audit);save(run);}});check(run);if(structure.plan)run.batch.structurePlan=structure.plan;
       M.finalizeAIOrganization(run.batch);
       record.status=failed || !finished?'partial':'completed';save(run);if(run.newDocument)M.fitView();status(`已完成 ${finished}/${documents.length} 份讲义${failed?'，'+failed+'份未完成':''}。出处和未处理范围可在生成过程中查看；本轮可整体撤销。${M.state().cur.nodes.some(n=>n.outlineSourceId===record.id && n.mathWarnings?.length)?' 有公式待检查。':''}${record.structureReview?.status==='failed'?' 结构复核未完成，保留原结构；详情见生成过程。':''}`);
     }catch(error){if(active===run){record.status=run.controller.signal.aborted?'stopped':'failed';record.error=error.message;for(const d of documents)if(d.status==='running')d.status=record.status;save(run);status(error.message+' 已完成的节点和章节结果已保留。');}}
     finally{run.usage.finish(record.status);M.endAIBatch(run.batch);if(active===run)active=null;}
   }finally{preparing=false;}
 }
 function expand(record,section){
   if(active || preparing)throw new Error('请先等待或停止当前课件生成');
   const map=M.state().cur,phase=record.runs.find(r=>r.id===section.runId),graph=phase?.inspection?.output;if(!map || !graph?.nodes?.length)throw new Error('该章节没有完整的可展开结果');
   const existing=section.generatedIds?.find(id=>M.findNode(id));if(existing){M.selectNodes([existing]);M.revealBox(M.state().L.nodes.get(existing));return;}
   const batch={kind:'outline',lecture:true,recordId:record.id,allowSupplement:record.allowSupplement,documents:record.documents.filter(d=>d.pageCount>0)},anchor=record.generatedIds.find(id=>M.findNode(id) && !M.findNode(id).n.pdf);
   const result=M.appendAIResult(map.id,anchor || null,graph,section.title,batch,true);M.finalizeAIOrganization(batch);M.endAIBatch(batch);section.generatedIds=Object.values(result.mapping);record.extraIds=[...new Set([...(record.extraIds || []),...section.generatedIds])];record.generatedIds=[...new Set([...record.generatedIds,...section.generatedIds])];M.saveOutlineSource(record);
 }
 panel.querySelector('[data-lecture-stop]').onclick=()=>stop();panel.querySelector('[data-lecture-hide]').onclick=()=>{panel.hidden=true;};panel.querySelector('[data-lecture-inspect]').onclick=()=>{if(shown)window.MMAIInspector.openRecord(shown.id);};
 window.addEventListener('mm:ai-interrupt',()=>stop());new MutationObserver(()=>{if(active && (M.state().cur?.id!==active.mapId || active.sourceId && !M.findNode(active.sourceId)))stop('导图已切换或来源节点已删除，生成已停止。');if(!active && shown && !M.state().cur?.outlineSources?.some(r=>r.id===shown.id))panel.hidden=true;}).observe($('mmBox'),{childList:true,subtree:true});
 window.MMAILecture={mount,start,stop,expand,reset,hideProgress:()=>{panel.hidden=true;},get running(){return !!active || preparing;}};
})();
