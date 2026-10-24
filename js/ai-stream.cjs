'use strict';
const noteFormat=require("./ai-note-format.js");
const {normalizeSummary}=require('./ai-summary.cjs');
const capacity=require('./capacity.js'),{randomUUID}=require('node:crypto');
// Only documented official endpoints receive the optional stream usage flag.
// Custom proxies keep their existing request contract; no paid retry is made.
exports.usageOptions=config=>{try{return ['api.deepseek.com','api.moonshot.cn','api.moonshot.ai'].includes(new URL(config.baseURL).hostname)?{stream_options:{include_usage:true}}:{};}catch{return {};}};
const fail=message=>Object.assign(new Error(message),{status:502});
// Bound answer text separately from transport, reasoning and SSE envelope bytes.
// Never retry a paid POST; malformed or unbounded transports are still stopped.
exports.readCompletion=async(response,{signal,onText=()=>{},onThinking=()=>{},onStats=()=>{},limit=capacity.answerBytes,maxWireBytes=capacity.wireBytes,maxFrameBytes=capacity.frameBytes,maxOutputTokens=null}={})=>{
  const reader=response.body.getReader(),decoder=new TextDecoder();let transportBytes=0,answerBytes=0,reasoningBytes=0,events=0,buffer='',reply='',finish=null,ended=false;
  const sse=/text\/event-stream/i.test(response.headers.get('content-type') || '');
  const callId=randomUUID(),startedAt=Date.now();let completedAt=null,completionState='running';
  let usage={};const stats=()=>({callId,startedAt,updatedAt:Date.now(),...(completedAt?{completedAt}:{}),completionState,transportBytes,answerBytes,reasoningBytes,events,answerLimitBytes:limit,transportLimitBytes:maxWireBytes,...(maxOutputTokens?{maxOutputTokens}:{}),...(finish?{finishReason:finish}:{}),...usage});
  const amount=bytes=>bytes>=1024*1024?(bytes/(1024*1024)).toFixed(2)+' MiB':(bytes/1024).toFixed(1)+' KiB';
  function readUsage(data){
    const u=data?.usage||data?.choices?.[0]?.usage;if(!u)return;
    for(const [key,value]of Object.entries({promptTokens:u.prompt_tokens,completionTokens:u.completion_tokens,totalTokens:u.total_tokens,reasoningTokens:u.completion_tokens_details?.reasoning_tokens,cacheHitTokens:u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??u.cached_tokens,cacheMissTokens:u.prompt_cache_miss_tokens}))if(Number.isSafeInteger(value)&&value>=0)usage[key]=value;
    if(usage.cacheHitTokens!==undefined&&usage.promptTokens!==undefined&&usage.cacheHitTokens<=usage.promptTokens&&!(Number.isSafeInteger(u.prompt_cache_miss_tokens)&&u.prompt_cache_miss_tokens>=0)){usage.cacheMissTokens=usage.promptTokens-usage.cacheHitTokens;usage.cacheMissDerived=true;}
  }
  const sizeError=(code,message)=>Object.assign(fail(message),{code,transfer:stats()});
  function append(content){
    const bytes=Buffer.byteLength(content,'utf8');
    if(answerBytes+bytes>limit)throw sizeError('AI_OUTPUT_LIMIT',`模型回答正文超过应用接收上限 ${amount(limit)}，已停止（此前已接收 ${amount(answerBytes)}）；已完成节点已保留`);
    answerBytes+=bytes;reply+=content;onText(reply);
  }
  function thinking(content){if(typeof content==='string' && content){reasoningBytes+=Buffer.byteLength(content,'utf8');onThinking();}}
  function event(frame){
    if(Buffer.byteLength(frame,'utf8')>maxFrameBytes)throw sizeError('AI_STREAM_FRAME_LIMIT','模型返回的单条流式消息异常过大，已停止传输');
    const raw=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n').trim();
    if(!raw)return;if(raw==='[DONE]'){ended=true;return;}
    let data;try{data=JSON.parse(raw);}catch{throw fail('模型流式数据格式无效');}
    events++;readUsage(data);if(data.error)throw fail('模型流式回答中断');
    const c=data.choices?.[0];if(!c)return;
    thinking(c.delta?.reasoning_content);
    if(typeof c.delta?.content==='string')append(c.delta.content);
    if(c.finish_reason)finish=c.finish_reason;
  }
  onStats(stats());
  try{
    while(true){
      if(signal?.aborted)throw new DOMException('已停止','AbortError');const {value,done}=await reader.read();if(done)break;
      transportBytes+=value.length;
      if(transportBytes>maxWireBytes)throw sizeError('AI_TRANSPORT_LIMIT',`模型流式传输超过应用上限 ${amount(maxWireBytes)}，已停止接收；已完成节点已保留`);
      buffer+=decoder.decode(value,{stream:true});
      if(sse){
        buffer=buffer.replace(/\r\n/g,'\n');let end;
        while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);if(ended)break;}
        if(ended){await reader.cancel();break;}
        if(Buffer.byteLength(buffer,'utf8')>maxFrameBytes)throw sizeError('AI_STREAM_FRAME_LIMIT','模型返回的单条流式消息异常过大，已停止传输');
      }
      onStats(stats());
    }
    buffer+=decoder.decode();
    if(!sse){
      let data;try{data=JSON.parse(buffer);}catch{throw fail('平台没有返回有效JSON，请检查接口兼容性');}
      readUsage(data);const c=data.choices?.[0];events++;thinking(c?.message?.reasoning_content);if(typeof c?.message?.content==='string')append(c.message.content);finish=c?.finish_reason;
    }else{if(buffer.trim() && !ended)event(buffer);if(!ended && !finish)throw fail('回答传输中断，已收到的内容尚未完成');}
    if(finish==='length')throw Object.assign(fail(`回答达到输出上限而被截断（平台返回 length；本次请求预算 ${maxOutputTokens?maxOutputTokens.toLocaleString('en-US')+' tokens':'旧记录未指定'}；已接收正文 ${amount(answerBytes)}；${usage.completionTokens!==undefined?'平台报告输出 '+usage.completionTokens.toLocaleString('en-US')+' tokens':'平台未提供实际token用量'}）。已完成节点已保留，可减少单批内容或调整输出预算后继续`),{code:'AI_OUTPUT_TRUNCATED'});
    if(typeof reply!=='string' || !reply.trim())throw fail('模型未返回最终回答，请重试或更换模型');
    completedAt=Date.now();completionState='completed';onStats(stats());return reply;
  }catch(e){completedAt=Date.now();completionState='failed';e.transfer=stats();onStats(stats());await reader.cancel().catch(()=>{});throw e;}
  finally{reader.releaseLock();}
};
// Read completed array items without treating an unfinished object as a node.
function completeItems(raw,key,max){
  const match=new RegExp('"'+key+'"\\s*:\\s*\\[').exec(raw);if(!match)return [];
  const items=[];let depth=0,start=-1,string=false,escape=false;
  for(let i=match.index+match[0].length;i<raw.length;i++){
    const c=raw[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
    if(c==='"'){string=true;continue;}if(c===']' && depth===0)break;
    if(c==='{'){if(depth===0)start=i;depth++;}
    if(c==='}' && depth>0 && --depth===0 && start>=0){try{items.push(JSON.parse(raw.slice(start,i+1)));}catch{}start=-1;if(items.length===max)break;}
  }return items;
}
exports.partialGraph=(raw,options={})=>{
  const nodes=[],ids=new Set();
  for(const item of completeItems(raw,'nodes',options.outline?40:12)){
    if(!item || typeof item.id!=='string' || !/^[A-Za-z0-9_-]{1,60}$/.test(item.id) || ids.has(item.id))continue;
    try{const n=normalizeSummary({nodes:[{...item,text:noteFormat.generatedText(item),blocks:undefined}],edges:[]},{...options,partial:true}).nodes[0];
      if(n.id!==item.id)continue;ids.add(n.id);nodes.push(n);
    }catch{}
  }
  const edges=[],seen=new Set();
  for(const e of completeItems(raw,'edges',options.outline?120:30)){
    if(!e || !ids.has(e.from) || !ids.has(e.to) || e.from===e.to)continue;
    const key=e.from+':'+e.to;if(seen.has(key))continue;
    try{const normalized=normalizeSummary({nodes,edges:[...edges,e]},{...options,partial:true});edges.push(normalized.edges.at(-1));seen.add(key);}catch{}
  }
  return {nodes,edges};
};
// Legacy summary callers still receive the old progress shape.
exports.partialNodes=raw=>{
  const match=/"nodes"\s*:\s*\[/.exec(raw);if(!match)return [];
  const nodes=[];let depth=0,start=-1,string=false,escape=false;
  for(let i=match.index+match[0].length;i<raw.length;i++){
    const c=raw[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
    if(c==='"'){string=true;continue;}if(c===']' && depth===0)break;
    if(c==='{'){if(depth===0)start=i;depth++;}if(c==='}' && --depth===0 && start>=0){try{const n=JSON.parse(raw.slice(start,i+1));if(typeof n.title==='string' && (typeof n.text==='string' || n.blocks!==undefined))nodes.push({title:n.title.slice(0,160),text:noteFormat.generatedText(n).slice(0,20000)});}catch{}start=-1;if(nodes.length===12)break;}
  }return nodes;
};
exports.redact=(text,key)=>{
  if(!key)return text;let clean=text.replaceAll(key,'[密钥已隐藏]');
  for(let n=Math.min(key.length-1,clean.length);n>0;n--)if(clean.endsWith(key.slice(0,n)))return clean.slice(0,-n);
  return clean;
};
