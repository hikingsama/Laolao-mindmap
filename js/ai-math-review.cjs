const capacity=require('./capacity.js');
'use strict';
const check=require('./ai-math-check.js'),prompts=require('./ai-prompts.cjs');
const {readCompletion,redact}=require('./ai-stream.cjs');
exports.run=async({plan,config,fetchImpl,signal,onStage=()=>{},onStats=()=>{},onUpdate=()=>{},timeoutMs=90000})=>{
 const suspects=check.analyze(plan),audit={status:'not-needed',suspects,changes:[],rejected:[],unresolved:[],modelCalled:false};
 let result=plan;
 const publish=()=>onUpdate(audit);
 function finish(){
   audit.unresolved=check.analyze(result);
   result={...result,nodes:result.nodes.map(n=>{const {mathWarnings,...clean}=n;const issues=audit.unresolved.filter(s=>s.nodeId===n.id).flatMap(s=>s.issues.map(i=>i.reason));return{...clean,...(issues.length?{mathWarnings:[...new Set(issues)].slice(0,8)}:{})};})};
   if(audit.status==='running')audit.status=audit.unresolved.length?'partial':'completed';
   audit.completedAt=Date.now();publish();return{plan:result,audit};
 }
 if(!suspects.length)return finish();
 const fields=[];let size=0;
 for(const s of suspects){const node=plan.nodes.find(n=>n.id===s.nodeId),source=node[s.field];if(size+source.length>48000)continue;size+=source.length;fields.push({...s,source});}
 if(!fields.length){audit.status='partial';audit.note='存疑正文超过单次复核范围，保留原文并标记待检查';return finish();}
 audit.status='running';audit.startedAt=Date.now();onStage('数学排版检查：正在按批复核存疑表达');publish();
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
   const messages=[{role:'system',content:prompts.render('math-review')},{role:'user',content:JSON.stringify({fields})}];
   audit.inspection=prompts.snapshot('math-review',messages,config.model,config.apiKey);audit.inspection.limits={maxOutputTokens:capacity.outputTokens(config,'math')};audit.modelCalled=true;publish();
   const response=await fetchImpl(config.baseURL+'/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify({model:config.model,messages,stream:true,...require('./ai-stream.cjs').usageOptions(config),max_tokens:capacity.outputTokens(config,'math')})});
   if(!response.ok){await response.body?.cancel();throw new Error('复核服务未成功响应（HTTP '+response.status+'）');}
   const reply=redact(await readCompletion(response,{signal:controller.signal,maxOutputTokens:capacity.outputTokens(config,'math'),onStats:stats=>{audit.inspection.transfer=stats;onStats(stats);}}),config.apiKey);
   let value;try{value=JSON.parse(reply.trim().replace(/^```(?:json)?\s*\n?/,'').replace(/\n?```$/,''));}catch{throw new Error('复核结果不是有效JSON');}
   if(!value || !Array.isArray(value.patches) || value.patches.length>128)throw new Error('复核结果格式不正确');
   const applied=check.apply(plan,value.patches);result=applied.plan;audit.changes=applied.changes;audit.rejected=applied.rejected;
   audit.inspection.output={patches:value.patches};audit.inspection.status='completed';audit.inspection.completedAt=Date.now();
 }catch(e){
   if(signal?.aborted){audit.status='stopped';audit.note='数学复核已停止';publish();throw new DOMException('已停止','AbortError');}
   audit.status='failed';audit.note=controller.signal.aborted?'数学复核等待超时，保留原文并标记待检查':redact(e.message,config.apiKey).slice(0,240);
   if(audit.inspection){audit.inspection.status='failed';audit.inspection.error=audit.note;}
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 return finish();
};
