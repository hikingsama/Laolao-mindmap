const capacity=require('./capacity.js');
'use strict';
const {randomUUID}=require('node:crypto'),files=require('./map-files.cjs'),model=require('./map-library-model.js'),summary=require('./ai-summary.cjs'),prompts=require('./ai-prompts.cjs'),{readCompletion}=require('./ai-stream.cjs');
const error=(message,status=400)=>Object.assign(Error(message),{status});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
function prepare(input){
 if(!input||!Array.isArray(input.sources)||input.sources.length<2||input.sources.length>8)throw error('请选择2–8张已保存的导图');
 const seen=new Set(),snapshots=input.sources.map(s=>{if(!model.validId(s?.mapId)||seen.has(s.mapId)||!/^[a-f0-9]{64}$/.test(s.revision||''))throw error('来源导图或版本无效');seen.add(s.mapId);const snapshot=files.snapshot(s.mapId);if(snapshot.revision!==s.revision)throw error('来源导图已更新，请重新选择后开始总结',409);return snapshot;});
 if(!['review','fusion','compare'].includes(input.goal)||!['brief','standard'].includes(input.detail))throw error('总结方式无效');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>80||typeof input.instructions!=='string'||input.instructions.length>1200)throw error('请输入1–80字的名称，补充要求最多1200字');
 const data=model.sourceUnits(snapshots),batches=data.sources.flatMap(source=>model.chunks(data.units.filter(u=>u.mapId===source.mapId)).map((rows,i)=>({title:source.title,rows,part:i+1})));
 if(batches.length>32)throw error('内容分批过多，请减少选择的导图数量');
 return{...data,batches,options:{goal:input.goal,detail:input.detail,title:input.title.trim(),instructions:input.instructions}};
}
function parse(reply,lookup,allowed){
 let raw;try{raw=JSON.parse(reply.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));}catch{throw error('模型返回的总结不是有效JSON');}
 let graph;try{graph=summary.normalizeSummary(raw,{outline:true,allowSupplement:false});}catch(e){throw error(e.message,502);}if(graph.nodes.length>24||graph.nodes.reduce((n,s)=>n+s.text.length,0)>20000)throw error('模型返回内容过长，请改用简明模式');
 const byId=new Map(raw.nodes.map(n=>[n.id,n]));
 for(const node of graph.nodes){const refs=byId.get(node.id)?.references;if(!Array.isArray(refs)||!refs.length||refs.length>40||refs.some(id=>!lookup.has(id)||!allowed.has(id)))throw error('模型总结缺少有效来源，或引用了本阶段未提供的节点');node.references=[...new Set(refs)];node.mapReferences=node.references.map(id=>{const s=lookup.get(id);return{mapId:s.mapId,nodeId:s.nodeId,revision:s.revision,title:s.title,excerpt:s.text.slice(0,320)};});}
 return graph;
}
exports.prepare=prepare;exports.parse=parse;
exports.createService=({getConfig,getStudentProfile=()=>({}),fetchImpl=globalThis.fetch,timeoutMs=15*60*1000,ttlMs=30*60*1000}={})=>{
 const jobs=new Map();
 const remove=id=>{const j=jobs.get(id);if(j){clearTimeout(j.timer);j.controller.abort();jobs.delete(id);}};
 const publicJob=j=>({id:j.id,status:j.status,stage:j.stage,sources:j.sources,options:j.options,fragments:j.fragments,audit:j.audit,...(j.result?{summary:j.result}:{}),...(j.message?{error:j.message}:{})});
 async function execute(job,prepared,config){
  const timeout=setTimeout(()=>job.controller.abort(),timeoutMs),signal=job.controller.signal;
  async function call(stage,data,allowed){
   signal.throwIfAborted();const messages=[{role:'system',content:prompts.render('map-summary',{studentProfile:prepared.studentProfile})},{role:'user',content:JSON.stringify({stage,...prepared.options,...data})}];
   const inspection=prompts.snapshot('map-summary',messages,config.model,config.apiKey);inspection.limits={maxOutputTokens:capacity.outputTokens(config)};job.audit.calls.push(inspection);
   const response=await fetchImpl(config.baseURL+'/chat/completions',{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify({model:config.model,messages,stream:true,...require('./ai-stream.cjs').usageOptions(config),max_tokens:capacity.outputTokens(config,'answer')})});
   if(!response.ok){await response.body?.cancel();throw error(response.status===401?'模型密钥验证失败':response.status===429?'模型平台限流，请稍后重新总结':'模型平台请求失败（HTTP '+response.status+'）');}
   const reply=await readCompletion(response,{signal,maxOutputTokens:capacity.outputTokens(config),onStats:stats=>{inspection.transfer=stats;}});signal.throwIfAborted();const graph=parse(reply.replaceAll(config.apiKey,'[密钥已隐藏]'),prepared.refs,allowed);inspection.completedAt=Date.now();inspection.output=graph;return graph;
  }
  const fragment=graph=>({nodes:graph.nodes.map(n=>({id:n.id,title:n.title,text:n.text,brief:n.brief,topic:n.topic,parentId:n.parentId,references:n.references,mapReferences:n.mapReferences})),edges:graph.edges});
  const group=fragments=>{const groups=[];let part=[],size=0;for(const f of fragments){const n=JSON.stringify(f).length;if(part.length&&size+n>24000){groups.push(part);part=[];size=0;}part.push(f);size+=n;}if(part.length)groups.push(part);return groups;};
  try{
   for(let i=0;i<prepared.batches.length;i++){
    const batch=prepared.batches[i];job.stage=`逐图梳理 ${i+1}/${prepared.batches.length}：${batch.title}`;
    const graph=await call('extract',{source:batch.title,part:batch.part,nodes:batch.rows},new Set(batch.rows.map(n=>n.ref)));job.fragments.push({title:batch.title,...fragment(graph)});
   }
   let fragments=job.fragments.map(f=>({...f}));
   for(let round=0;round<5;round++){
    const groups=group(fragments),merged=[];
    for(let i=0;i<groups.length;i++){job.stage=`跨图归并 · 第${round+1}轮 ${i+1}/${groups.length}`;const items=groups[i],allowed=new Set(items.flatMap(f=>f.nodes.flatMap(n=>n.references)));const graph=await call('merge',{fragments:items},allowed);merged.push({graph,...fragment(graph)});}
    if(merged.length===1){job.result=merged[0].graph;break;}fragments=merged.map(({graph,...rest})=>rest);
   }
   if(!job.result)throw error('资料仍然过长，未继续自动调用；请减少所选导图');
   const represented=new Set(job.result.nodes.flatMap(n=>n.mapReferences.map(r=>r.mapId)));if(prepared.sources.some(s=>!represented.has(s.mapId)))throw error('模型总结没有覆盖全部所选导图，已保留逐图梳理结果，请重试或减少选择');
   job.stage='检查来源与数学排版';const refs=new Map(job.result.nodes.map(n=>[n.id,{references:n.references,mapReferences:n.mapReferences}]));
   const reviewed=await require('./ai-math-review.cjs').run({plan:job.result,config,fetchImpl,signal,onStage:s=>{job.stage=s;},onUpdate:audit=>{job.audit.mathReview=audit;}});signal.throwIfAborted();
   job.result=reviewed.plan;for(const n of job.result.nodes)Object.assign(n,refs.get(n.id));
   job.audit.finishedAt=Date.now();job.status='completed';job.stage='总结完成，正在生成导图';
  }catch(e){job.result=null;job.status=signal.aborted?'stopped':'failed';job.message=signal.aborted?'总结已停止，逐图结果已保留':e.status?e.message:'多图总结失败，请检查模型配置或网络后重试';}
  finally{clearTimeout(timeout);}
 }
 return{async handle(req,res){
  if(req.url==='/api/ai/map-summary'&&req.method==='POST'){
   try{if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw error('请使用JSON提交总结选项',415);let bytes=0,parts=[];for await(const part of req){bytes+=part.length;if(bytes>16000)throw error('总结选项过大',413);parts.push(part);}let input;try{input=JSON.parse(Buffer.concat(parts).toString());}catch{throw error('总结选项不是有效JSON');}
    if([...jobs.values()].some(j=>j.status==='running'))throw error('已有多图总结正在进行，请先停止或等待完成',429);
    const prepared={...prepare(input),studentProfile:getStudentProfile()},config=getConfig();if(jobs.size>=8)for(const [id,j]of jobs)if(j.status!=='running'){remove(id);break;}
    const job={id:randomUUID(),status:'running',stage:'已锁定来源版本',sources:prepared.sources,options:prepared.options,fragments:[],audit:{createdAt:Date.now(),model:config.model,calls:[]},controller:new AbortController()};job.timer=setTimeout(()=>remove(job.id),ttlMs);job.timer.unref?.();jobs.set(job.id,job);json(res,202,publicJob(job));void execute(job,prepared,config);
   }catch(e){req.resume();json(res,e.status||400,{error:e.message});}return true;
  }
  const match=/^\/api\/ai\/map-summary\/([A-Za-z0-9_-]{1,80})$/.exec(req.url);if(!match)return false;const job=jobs.get(match[1]);if(!job){json(res,404,{error:'总结任务不存在或已过期'});return true;}
  if(req.method==='GET')json(res,200,publicJob(job));else if(req.method==='DELETE'){job.controller.abort();json(res,200,{stopped:true});}else json(res,405,{error:'请求方法不支持'});return true;
 },dispose(){for(const id of jobs.keys())remove(id);}};
};
