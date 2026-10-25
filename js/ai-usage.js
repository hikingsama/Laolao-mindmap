(function(root){
 'use strict';
 const fields=['promptTokens','cacheHitTokens','cacheMissTokens','completionTokens','reasoningTokens','answerBytes','transportBytes'];
 const valid=n=>Number.isSafeInteger(n)&&n>=0;
 // A stream publishes cumulative snapshots. Count each call once, including when
 // it is present in both a live role transfer and the persisted audit tree.
 function collect(value,into=new Map()){
   const seen=new Set();
   function walk(v){
     if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);
     if(typeof v.callId==='string'&&valid(v.answerBytes)){
       const previous=into.get(v.callId);if(!previous||(v.updatedAt||0)>=(previous.updatedAt||0))into.set(v.callId,{...previous,...v});return;
     }
     if(Array.isArray(v)){for(const x of v)walk(x);return;}
     for(const key of ['transfer','inspection','planning','mathReview','sectionReview','batches','structureReview','stages','calls','audit','runs','answer','math','structure','planningInspection'])walk(v[key]);
   }
   walk(value);return into;
 }
 function summarize(calls){
   const rows=[...calls.values()],totals={calls:rows.length,reported:rows.filter(r=>valid(r.promptTokens)&&valid(r.completionTokens)).length};
   for(const field of fields){const known=rows.filter(r=>valid(r[field]));totals[field]=known.length?known.reduce((s,r)=>s+r[field],0):null;totals[field+'Known']=known.length;}
   return totals;
 }
 const bytes=n=>Number.isFinite(n)?n>=1048576?(n/1048576).toFixed(2)+' MiB':n>=1024?(n/1024).toFixed(1)+' KiB':n+' B':'待计算';
 const number=n=>valid(n)?n.toLocaleString('zh-CN'):'—';
 function attach(host,{mapId,title='用量与容量',startedAt=Date.now()}={}){
   const document=host.ownerDocument,win=document.defaultView,calls=new Map(),details=document.createElement('details');details.className='mm-ai-usage';details.open=true;
   const summary=document.createElement('summary'),body=document.createElement('div');body.className='mm-ai-usage-body';details.append(summary,body);host.append(details);
   let done=false,state='running',meta={},latest=null,timer;
   const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   function render(){
     if(!details.isConnected){clearInterval(timer);return;}
     const totals=summarize(calls),current=latest&&calls.get(latest),cap=win.MMCapacity,map=win.Mindmap?.state().cur,usage=map?.id===mapId?win.MMFiles?.capacityInfo(mapId):null;
     summary.textContent=title+' · '+({running:'生成中',completed:'已完成',partial:'部分完成',failed:'未完成',stopped:'已停止'}[state]||'已结束');
     const cell=(label,value,hint='')=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>'+(hint?'<small>'+esc(hint)+'</small>':'')+'</div>';
     const token=(field)=>valid(current?.[field])?number(current[field]):done?'平台未提供':'等待平台统计';
     const total=(field)=>totals[field]===null?'平台未提供':number(totals[field])+(totals[field+'Known']<totals.calls?'（部分）':'');
     const nodeCount=meta.nodeCount??(map&&map.id===mapId?map.nodes?.length:undefined);
     body.innerHTML='<p class="mm-ai-usage-stage">'+esc(meta.stage||'等待模型响应')+(Number.isFinite(nodeCount)?' · '+nodeCount+' 个节点':'')+' · '+Math.max(0,Math.floor(((meta.finishedAt||Date.now())-startedAt)/1000))+' 秒</p>'+
       (meta.coverage?'<p class="mm-ai-usage-coverage">'+esc(meta.coverage)+'</p>':'')+
       '<dl class="mm-ai-usage-grid">'+cell('当前请求输入',token('promptTokens'),'tokens')+cell('当前请求输出',token('completionTokens'),'tokens · 请求预算 '+number(current?.maxOutputTokens??meta.maxOutputTokens))+cell('缓存命中输入',token('cacheHitTokens'),'tokens')+cell('缓存未命中输入',token('cacheMissTokens'),'tokens'+(current?.cacheMissDerived?' · 由输入总量减命中量计算':''))+
       cell('本次回答接收量',bytes(current?.answerBytes??0)+' / '+bytes(current?.answerLimitBytes??cap.answerBytes))+
       cell('当前导图数据',bytes(usage?.documentBytes)+' / '+bytes(cap.documentBytes),'节点、关系与记录；附件单列')+
       (usage?.attachmentBytes?cell('导图附件',bytes(usage.attachmentBytes),'不计入导图 JSON 上限'):'')+
       (valid(current?.reasoningTokens)?cell('其中思考输出',number(current.reasoningTokens)+' tokens','已包含在输出中，不重复相加'):'')+'</dl>'+
       '<div class="mm-ai-usage-total"><b>整个任务累计 · '+(totals.calls?totals.calls+' 次模型响应':done?'未记录调用统计':'等待模型响应')+'</b><span>输入 '+total('promptTokens')+' · 输出 '+total('completionTokens')+' tokens</span><span>缓存命中 '+total('cacheHitTokens')+' · 未命中 '+total('cacheMissTokens')+' tokens</span><span>回答正文 '+bytes(totals.answerBytes??0)+' · 用量齐全 '+totals.reported+'/'+totals.calls+' 次</span></div>'+
       '<p class="mm-ai-usage-note">token 用量以平台返回为准，部分接口在请求结束时才提供；未提供不记为 0。容量为应用上限，不代表模型上下文或输出能力。</p>';
     if(usage?.documentBytes>cap.documentWarnBytes)body.querySelector('.mm-ai-usage-note').textContent='导图已接近保存上限，请拆分或精简生成记录。'+body.querySelector('.mm-ai-usage-note').textContent;
   }
   function update(data,extra={}){
     collect(data,calls);Object.assign(meta,extra);if(data?.inspection?.limits?.maxOutputTokens)meta.maxOutputTokens=data.inspection.limits.maxOutputTokens;
     const rows=[...calls.values()];if(rows.length)latest=rows.reduce((a,b)=>(b.startedAt||0)>=(a.startedAt||0)?b:a).callId;
     render();
   }
   function finish(status='completed',extra={}){done=true;state=status;meta.finishedAt=Date.now();meta.stage=({completed:'本轮生成完成',partial:'本轮部分完成',failed:'本轮未完成',stopped:'本轮已停止'})[status]||'本轮结束';Object.assign(meta,extra);clearInterval(timer);render();}
   timer=setInterval(render,1000);render();
   return{update,finish,details,calls,destroy(){clearInterval(timer);details.remove();}};
 }
 const api={collect,summarize,attach,bytes};if(typeof module==='object'&&module.exports)module.exports=api;else root.MMAIUsage=api;
})(typeof window==='object'?window:globalThis);
