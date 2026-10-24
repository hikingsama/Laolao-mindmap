(() => {
 'use strict';
 const M=window.Mindmap,P=window.MMStructurePlan,$=id=>document.getElementById(id);let requests=0,manual=null;
 function collect(map,ids){const wanted=new Set(ids),nodes=map.nodes.filter(n=>wanted.has(n.id) && !n.pdf && !n.image && !n.mapLink && n.text.trim() && !window.MMLectureCleanup?.placeholder(n)),known=new Set(nodes.map(n=>n.id));return P.input({title:map.title,relations:(map.edges || []).filter(e=>known.has(e.from.node) && known.has(e.to.node)).map(e=>({from:e.dir==='rev'?e.to.node:e.from.node,to:e.dir==='rev'?e.from.node:e.to.node,kind:e.kind,label:e.label})),nodes:nodes.map(n=>({id:n.id,title:window.MMTopicLayout.title(n),brief:n.brief || '',topic:n.topic || '',...(known.has(n.layoutParent)?{parentId:n.layoutParent}:{}),...(!n.brief?{excerpt:n.text.slice(0,320)}:{})})),catalog:nodes.filter(n=>/目录|框架|主要内容|总览|概述/.test(n.text.slice(0,2000))).slice(0,12).map(n=>n.text.slice(0,1400))});}
 function stamp(map,ids){const wanted=new Set(ids);return JSON.stringify(map.nodes.filter(n=>wanted.has(n.id)).map(n=>[n.id,n.text,n.brief,n.topic,n.layoutParent,n.structureScope]));}
 async function request(url,opts={}){const r=await fetch(url,opts),data=await r.json();if(!r.ok)throw Error(data.error || '结构复核连接失败');return data;}
 const delay=signal=>new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},180);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 async function run({mapId,ids,signal,onStage=()=>{},onAudit=()=>{},onUsage=()=>{}}){
   const map=M.state().cur,job=crypto.randomUUID();let source,sourceIds=[],before='',audit={status:'running',stages:[],modelCalls:0};requests++;
   try{
     source=collect(map,ids);sourceIds=source.nodes.map(n=>n.id);before=stamp(map,sourceIds);
     if(!sourceIds.length)throw Error('没有可复核的知识节点');onStage('整图结构复核：统一主模块与子主题');onAudit(audit);
     let data=await request('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'structure-review',structure:source,requestId:job}),signal});const began=Date.now();
     while(data.status==='running'){onUsage(data);if(data.inspection?.structureReview){audit=data.inspection.structureReview;onAudit(audit);}onStage(data.stage || '整图结构复核中');if(Date.now()-began>window.MMCapacity.structurePollTimeoutMs)throw Error('结构复核等待超时，保留原结构');await delay(signal);data=await request('/api/ai/jobs/'+job,{signal});}
     onUsage(data);signal.throwIfAborted();if(data.status!=='completed')throw Error(data.error || '结构复核未完成');audit=data.structureReview;if(!audit)throw Error('结构复核结果缺失');
     if(M.state().cur?.id!==mapId || stamp(M.state().cur,sourceIds)!==before)throw Error('复核期间节点内容或结构已变化，未应用旧方案');
     if(audit.status==='completed')audit.plan=P.validate(audit.plan,source.nodes);onAudit(audit);return{audit,plan:audit.status==='completed'?audit.plan:null,sourceIds,before};
   }catch(e){if(signal.aborted){audit={...audit,status:'stopped',note:'结构复核已停止'};onAudit(audit);throw new DOMException('已停止','AbortError');}audit={...audit,status:'failed',note:e.message};onAudit(audit);return{audit,plan:null,sourceIds,before};}
   finally{requests--;fetch('/api/ai/jobs/'+job,{method:'DELETE'}).catch(()=>{});}
 }
 function recordAudit(record,audit){record.structureReview=audit;record.updatedAt=Date.now();if(M.state().cur)M.saveOutlineSource(record);}
 function preview(result,record){const host=$('mmDlgBody');host.replaceChildren();const h=document.createElement('h3');h.textContent='整图结构复核';host.append(h);const info=document.createElement('p');info.textContent=result.plan?result.plan.reason+(result.plan.orderReason?' 排序依据：'+result.plan.orderReason:''):(result.audit.note || '复核未完成，已保留原结构');host.append(info);
   if(result.plan){const list=document.createElement('ul');for(const m of result.plan.modules){const li=document.createElement('li');li.textContent=String(m.order).padStart(2,'0')+' · '+m.title+' · '+P.members(m).length+' 个原节点';if(m.children.length){const sub=document.createElement('ul');for(const c of m.children){const v=document.createElement('li');v.textContent=c.title+' · '+c.nodeIds.length+' 个原节点';sub.append(v);}li.append(sub);}list.append(li);}host.append(list);const apply=document.createElement('button');apply.type='button';apply.className='mm-b pri';apply.id='mmStructureApply';apply.textContent='应用结构（可一步撤销）';apply.onclick=()=>{try{if(M.state().cur?.id!==record.mapId || stamp(M.state().cur,result.sourceIds)!==result.before)throw Error('节点已修改、删除或导图已切换，请重新复核');M.applyReviewedStructure(result.plan,record.id);record.status='completed';record.applied=true;recordAudit(record,result.audit);$('mmDlg').close();window.showBanner('结构已更新，正文与出处保留，可一步撤销');}catch(e){info.textContent=e.message;apply.disabled=true;}};host.append(apply);}
   const close=document.createElement('button');close.type='button';close.className='mm-b';close.textContent='关闭';close.onclick=()=>$('mmDlg').close();host.append(close);
 }
 function open(){if(requests || window.MMAILecture?.running || window.MMAIOutline?.running){window.showBanner('请等待或停止当前生成，再复核整图结构');return;}const map=M.state().cur;if(!map)return;const host=$('mmDlgBody');host.innerHTML='<h3>整图结构复核</h3><p>复用当前模型检查整张导图的模块归并、层级与学习顺序，先预览方案，再应用。正文、公式和出处保留。</p><p>通常额外调用一次模型；超过100个节点时会分层复核。仅发送标题、简述、父级、已有知识连线和少量目录文字；缺少简述时附短正文摘录。</p><button type="button" class="mm-b pri" id="mmStructureStart">开始复核</button><button type="button" class="mm-b" data-mm="dclose">取消</button>';
   $('mmStructureStart').onclick=async()=>{if(requests)return;const controller=new AbortController(),record={id:crypto.randomUUID(),mapId:map.id,mode:'structure-review',title:'整图结构复核',status:'running',createdAt:Date.now(),generatedIds:[]};manual={controller,mapId:map.id,record};host.innerHTML='<h3>整图结构复核</h3><p id="mmStructureStatus" role="status">准备复核…</p><button type="button" class="mm-b" id="mmStructureStop">停止</button>';$('mmStructureStop').onclick=()=>controller.abort();
     const usage=window.MMAIUsage.attach(host,{mapId:map.id});
     try{const result=await run({onUsage:data=>usage.update(data,{stage:data.stage||'整图结构复核中'}),mapId:map.id,ids:map.nodes.map(n=>n.id),signal:controller.signal,onStage:text=>{if($('mmStructureStatus'))$('mmStructureStatus').textContent=text;},onAudit:a=>{if(M.state().cur?.id===map.id)recordAudit(record,a);}});if(M.state().cur?.id===map.id){record.status=result.plan?'completed':'failed';recordAudit(record,result.audit);if($('mmDlg').open)preview(result,record);}}
     catch(e){record.status='stopped';if(M.state().cur?.id===map.id)recordAudit(record,{...record.structureReview,status:'stopped',note:'复核已停止，原结构保留'});if($('mmStructureStatus'))$('mmStructureStatus').textContent='复核已停止，原结构保留';}
     finally{usage.finish(record.status);manual=null;}};
   $('mmDlg').showModal();
 }
 document.addEventListener('click',e=>{if(e.target.closest('#mmStructureReviewButton'))open();});
 $('mmDlg').addEventListener('close',()=>manual?.controller.abort());window.addEventListener('mm:ai-interrupt',()=>manual?.controller.abort());
 window.MMAIStructureReview={run,collect,stamp,open,get running(){return requests>0;}};
})();
