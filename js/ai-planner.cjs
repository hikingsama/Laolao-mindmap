const capacity=require('./capacity.js');
'use strict';
const {readCompletion}=require('./ai-stream.cjs');
const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
exports.input=value=>{
  if(!value || typeof value!=='object' || !Array.isArray(value.candidates) || value.candidates.length>18)throw Object.assign(new Error('关联资料格式不正确'),{status:400});
  const seen=new Set(),candidates=value.candidates.map(s=>{
    if(!s || typeof s.id!=='string' || !/^[A-Za-z0-9_-]{1,120}$/.test(s.id) || seen.has(s.id))throw Object.assign(new Error('关联资料编号不正确'),{status:400});seen.add(s.id);
    return {id:s.id,nodeId:text(s.nodeId,120),treeId:text(s.treeId,160),treeTitle:text(s.treeTitle,100),title:text(s.title,100),text:text(s.text,8000),kind:['current','ancestor','tree','related'].includes(s.kind)?s.kind:'tree',reason:text(s.reason,200),revision:text(s.revision,60)};
  });
  if(candidates.reduce((n,s)=>n+s.text.length,0)>60000)throw Object.assign(new Error('关联资料过长'),{status:400});
  const history=Array.isArray(value.history)?value.history.slice(-6).filter(m=>['user','assistant'].includes(m?.role) && typeof m.content==='string').map(m=>({role:m.role,content:text(m.content,1800)})):[];
  return {candidates,history,direction:text(value.direction,2000),scope:['node','tree','project'].includes(value.scope)?value.scope:'project'};
};
exports.run=async({input,question,config,fetchImpl,signal,onStage=()=>{},onStats=()=>{},onInspect=()=>{},timeoutMs=60000})=>{
  const fallback=()=>({direction:input.direction || '围绕当前节点回答最后一个问题，保留本条推导的假设与符号。',relation:'continue',note:'关联分析暂不可用，已按当前节点和推导路径选取资料。',sources:input.candidates.filter(s=>['current','ancestor'].includes(s.kind)).slice(0,6),planningStatus:'fallback'});
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    onStage('关联与定向员正在查找资料');
    const messages=[{role:'system',content:require('./ai-prompts.cjs').render('planner')},{role:'user',content:JSON.stringify({question,direction:input.direction,scope:input.scope,history:input.history,sources:input.candidates})}];
    const inspection=require('./ai-prompts.cjs').snapshot('planner',messages,config.model,config.apiKey);inspection.limits={maxOutputTokens:capacity.outputTokens(config,'planner')};onInspect(inspection);
    const response=await fetchImpl(config.baseURL+'/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify({model:config.model,stream:true,...require('./ai-stream.cjs').usageOptions(config),max_tokens:capacity.outputTokens(config,'planner'),messages})});
    if(!response.ok){await response.body?.cancel();if([401,403].includes(response.status))throw Object.assign(new Error('关联模型接口验证失败，请检查API配置'),{status:502,code:'PLANNER_AUTH'});return fallback();}
    const raw=(await readCompletion(response,{signal:controller.signal,limit:256*1024,maxWireBytes:8*1024*1024,maxFrameBytes:2*1024*1024,maxOutputTokens:capacity.outputTokens(config,'planner'),onStats:stats=>{inspection.transfer=stats;onStats(stats);},onThinking:()=>onStage('关联与定向员正在确定回答范围')})).replaceAll(config.apiKey,'[密钥已隐藏]');
    const result=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    if(typeof result.direction!=='string' || !result.direction.trim() || !Array.isArray(result.sourceIds))return fallback();
    const selected=new Set(result.sourceIds.filter(id=>typeof id==='string').slice(0,8));const current=input.candidates.find(s=>s.kind==='current');if(current)selected.add(current.id);
    const sources=input.candidates.filter(s=>selected.has(s.id)).slice(0,8);
    return {direction:input.direction || text(result.direction,1200),relation:['continue','branch','correct','new'].includes(result.relation)?result.relation:'continue',note:text(result.note,600),sources,planningStatus:'completed'};
  }catch(e){if(signal.aborted || e.code==='PLANNER_AUTH')throw e;return fallback();}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
};
