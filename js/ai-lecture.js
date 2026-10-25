(() => {
 'use strict';
 const M=window.Mindmap,$=id=>document.getElementById(id),esc=window.MMContent.escape;
 let picked=[],ui=null;const preferences={strategy:'branches',reading:'auto'};
 function rememberPreferences(){if(!ui?.container.isConnected)return;preferences.strategy=$('mmLectureStrategy').value;preferences.reading=$('mmLectureReading').value;}
 function reset(){rememberPreferences();picked=[];if(ui?.container.isConnected){$('mmLecturePicker').value='';render();}}
 function hints(){
   if(!ui?.container.isConnected)return;
   const reading=ui.container.querySelector('#mmLectureReading').value,strategy=ui.container.querySelector('#mmLectureStrategy').value;
   ui.container.querySelector('#mmLectureStrategyHelp').textContent=strategy==='fusion'?'上传后由本地后台通览全部材料，再结合跨文件的同一题目与解析。':'上传后由本地后台通览材料，再按各讲义的完整主题与步骤整理。';
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
       <p class="mm-lecture-upload-note">支持多份 PDF，每份最多 50 MB；上传完成后交由本地后台处理，可关闭网页。PPT/PPTX 请先导出为 PDF。</p>
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
 function expand(record,section){
   if(window.MMLocalLecture?.submitting)throw new Error('请先等待或停止当前课件生成');
   const map=M.state().cur,phase=record.runs.find(r=>r.id===section.runId),graph=phase?.inspection?.output;if(!map || !graph?.nodes?.length)throw new Error('该章节没有完整的可展开结果');
   const existing=section.generatedIds?.find(id=>M.findNode(id));if(existing){M.selectNodes([existing]);M.revealBox(M.state().L.nodes.get(existing));return;}
   const batch={kind:'outline',lecture:true,recordId:record.id,allowSupplement:record.allowSupplement,documents:record.documents.filter(d=>d.pageCount>0)},anchor=record.generatedIds.find(id=>M.findNode(id) && !M.findNode(id).n.pdf);
   const result=M.appendAIResult(map.id,anchor || null,graph,section.title,batch,true);M.finalizeAIOrganization(batch);M.endAIBatch(batch);section.generatedIds=Object.values(result.mapping);record.extraIds=[...new Set([...(record.extraIds || []),...section.generatedIds])];record.generatedIds=[...new Set([...record.generatedIds,...section.generatedIds])];M.saveOutlineSource(record);
 }
 async function start(input,context){
   if(!picked.length)throw new Error('请先添加课件PDF');
   const selection=[...picked];await Promise.all(selection.map(e=>e.ready));
   if(selection.some(e=>e.error))throw new Error('有PDF无法读取，请移除或替换后重新提交');
   return window.MMLocalLecture.start(input,context,{selection,strategy:$('mmLectureStrategy').value,reading:$('mmLectureReading').value});
 }
 window.MMAILecture={mount,start,reset,expand,stop:()=>window.MMLocalLecture.stop(),hideProgress:()=>window.MMLocalLecture.hide(),get running(){return !!window.MMLocalLecture?.submitting;}};
})();
