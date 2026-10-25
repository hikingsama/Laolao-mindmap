'use strict';
const format=require('./ai-section-format.cjs'),prompts=require('./ai-prompts.cjs'),capacity=require('./capacity.js'),{readCompletion,redact}=require('./ai-stream.cjs');
exports.run=async({plan,config,fetchImpl,signal,onStage=()=>{},onStats=()=>{},onUpdate=()=>{},shortChain=false,timeoutMs=45000})=>{
 let result=plan;const checks=plan.nodes.map(n=>({nodeId:n.id,...format.check(n)})),candidates=plan.nodes.filter(n=>checks.find(c=>c.nodeId===n.id).needed),audit={status:'not-needed',scope:'node-sections-only',modelCalled:false,checks:checks.map(({blocks,...c})=>c),changes:[],rejected:[],batches:[],startedAt:Date.now()};
 const publish=()=>onUpdate(audit);if(!candidates.length){audit.completedAt=Date.now();publish();return{plan:result,audit};}
 const groups=[];let group=[],size=0;for(const n of candidates){if(group.length&&(group.length>=(shortChain?3:8)||size+n.text.length>(shortChain?60000:16000))){groups.push(group);group=[];size=0;}group.push(n);size+=n.text.length;}if(group.length)groups.push(group);
 audit.status='running';publish();
 for(const [index,nodes]of groups.entries()){
  signal?.throwIfAborted();const batch={status:'running',nodeIds:nodes.map(n=>n.id),startedAt:Date.now()};audit.batches.push(batch);onStage('节点内分节复核 · '+(index+1)+'/'+groups.length+' 批');publish();
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const payload={nodes:nodes.map(n=>({id:n.id,title:n.title,blocks:format.segments(n.text).map(({offset,...b})=>b)}))},messages=[{role:'system',content:prompts.render('section-review')},{role:'user',content:JSON.stringify(payload)}];
   batch.inspection=prompts.snapshot('section-review',messages,config.model,config.apiKey);batch.inspection.limits={maxOutputTokens:capacity.outputTokens(config,'section')};audit.modelCalled=true;publish();
   const response=await fetchImpl(config.baseURL+'/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify({model:config.model,messages,stream:true,...require('./ai-stream.cjs').usageOptions(config),max_tokens:capacity.outputTokens(config,'section')})});
   if(!response.ok){await response.body?.cancel();throw Error('分节复核未成功响应（HTTP '+response.status+'）');}
   const reply=redact(await readCompletion(response,{signal:controller.signal,maxOutputTokens:capacity.outputTokens(config,'section'),onStats:stats=>{batch.inspection.transfer=stats;onStats(stats);}}),config.apiKey),value=JSON.parse(reply.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
   if(!value||!Array.isArray(value.checked)||new Set(value.checked).size!==nodes.length||nodes.some(n=>!value.checked.includes(n.id))||!Array.isArray(value.patches)||value.patches.length>nodes.length)throw Error('复核结果未覆盖本批全部节点或格式无效');
   const applied=format.apply(result,value.patches,new Set(batch.nodeIds));result=applied.plan;audit.changes.push(...applied.changes);audit.rejected.push(...applied.rejected);batch.status=applied.rejected.length?'partial':'completed';batch.inspection.output=value;batch.inspection.status=batch.status;
  }catch(e){
   if(signal?.aborted){batch.status='stopped';audit.status='stopped';batch.note='分节复核已停止';publish();throw new DOMException('已停止','AbortError');}
   batch.status='failed';batch.note=controller.signal.aborted?'分节复核超时，保留原文待检查':redact(e.message,config.apiKey).slice(0,240);if(batch.inspection){batch.inspection.status='failed';batch.inspection.error=batch.note;}
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);batch.completedAt=Date.now();if(batch.inspection)batch.inspection.completedAt=batch.completedAt;publish();}
 }
 audit.status=audit.batches.some(b=>b.status!=='completed')?'partial':'completed';audit.completedAt=Date.now();audit.note=audit.status==='partial'?'部分节点分节复核未完成，原文已保留，可查看生成过程':'仅调整节点内分节，未检查知识正确性';publish();return{plan:result,audit};
};
