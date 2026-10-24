(() => {
 'use strict';
 const M=window.Mindmap,$=id=>document.getElementById(id);let active=null;
 function save(run){if(M.state().cur?.id===run.mapId)M.saveOutlineSource(run.record);}
 async function request(url,options={}){const response=await fetch(url,options),data=await response.json();if(!response.ok)throw new Error(data.error || '数学检查失败');return data;}
 async function open(id){
   if(active)return;
   window.MMAIOutline?.capture();window.dispatchEvent(new Event('mm:ai-interrupt'));M.finishEditing();
   const node=M.findNode(id)?.n;if(!node || node.pdf || node.image)return;
   const before=node.text,run={mapId:M.state().cur.id,id,before,controller:new AbortController(),job:crypto.randomUUID(),record:{id:crypto.randomUUID(),title:'数学检查：'+before.replace(/^#+\s*/,'').slice(0,60),text:before,mode:'math-review',status:'running',createdAt:Date.now(),generatedIds:[id]}};
   active=run;save(run);
   $('mmDlgBody').innerHTML='<section class="mm-inspector"><h3>检查数学排版</h3><p id="mmMathStatus">正在检查上下标、LaTeX及数学定界符；有疑点时会额外调用当前模型复核。</p><label>修改前<textarea id="mmMathBefore" readonly></textarea></label><label>修改后预览<textarea id="mmMathAfter" readonly></textarea></label><div class="nd-actions"><button class="mm-b" type="button" id="mmMathInspect" disabled>查看复核过程</button><span class="spacer"></span><button class="mm-b" type="button" data-mm="dclose">关闭</button><button class="btn ink sm" type="button" id="mmMathApply" disabled>应用修改</button></div></section>';
   run.usage=window.MMAIUsage.attach($('mmDlgBody').querySelector('section'),{mapId:run.mapId});
   $('mmMathBefore').value=before;if(!$('mmDlg').open)$('mmDlg').showModal();
   try{
     let data=await request('/api/ai/chat',{method:'POST',signal:run.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:run.job,mode:'math-review',messages:[{role:'user',content:before}]})});
     while(data.status==='running'){
       run.usage.update(data,{stage:data.stage||'数学排版检查'});if(data.calls)run.record.calls=data.calls;if(data.inspection){run.record.inspection=data.inspection;save(run);}
       if(active!==run || M.state().cur?.id!==run.mapId)throw new DOMException('已停止','AbortError');
       $('mmMathStatus').textContent=data.stage || '正在本地检查…';await new Promise(r=>setTimeout(r,160));run.controller.signal.throwIfAborted();data=await request('/api/ai/jobs/'+run.job,{signal:run.controller.signal});
     }
     if(active!==run || M.state().cur?.id!==run.mapId)return;
     run.usage.update(data,{stage:data.stage||'数学排版检查'});if(data.calls)run.record.calls=data.calls;if(data.inspection)run.record.inspection=data.inspection;
     if(data.status!=='completed')throw new Error(data.error || '数学检查未完成');
     const after=data.summary.nodes[0];run.record.status='completed';save(run);run.complete=true;$('mmMathAfter').value=after.text;
     const review=data.inspection.mathReview;$('mmMathStatus').textContent=`已提出 ${review.changes.length} 处定界符修正。${review.unresolved.length?'仍有存疑内容，保留原文供人工确认。':'检查结束。'}应用前可以对照原文；不会自动改写当前节点。`;
     $('mmMathInspect').disabled=false;$('mmMathInspect').onclick=()=>window.MMAIInspector.openRecord(run.record.id);
     $('mmMathApply').disabled=after.text===before;
     $('mmMathApply').onclick=()=>{try{M.applyMathReview(run.mapId,run.id,before,after.text,after.mathWarnings || []);run.record.applied=true;save(run);active=null;$('mmDlg').close();window.showBanner('数学排版修改已应用，可一步撤销');}catch(e){$('mmMathStatus').textContent=e.message;}};
   }catch(e){run.record.status=e.name==='AbortError'?'stopped':'failed';run.record.error=e.name==='AbortError'?'':e.message;save(run);if(active===run && $('mmMathStatus'))$('mmMathStatus').textContent=e.name==='AbortError'?'检查已停止，原节点未改动':e.message;}
   finally{run.usage.finish(run.record.status);fetch('/api/ai/jobs/'+run.job,{method:'DELETE'}).catch(()=>{});}
 }
 function stop(){const run=active;if(!run)return;active=null;run.usage?.finish(run.complete?'completed':'stopped');run.controller.abort();if(!run.complete){run.record.status='stopped';save(run);}}
 $('mmDlg').addEventListener('close',stop);
 window.addEventListener('mm:ai-interrupt',stop);
 window.MMAIMathReview={open};
})();
