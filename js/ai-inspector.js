(() => {
 'use strict';
 const M=window.Mindmap,$=id=>document.getElementById(id),esc=window.MMContent.escape;let token=0;
 const statusName=value=>({queued:'未处理',running:'处理中',completed:'已完成',partial:'部分完成',stopped:'已停止',failed:'未完成'})[value] || value || '未记录';
 const getRecords=()=>[...(M.state().cur?.outlineSources || []),...(M.state().cur?.aiMemory?.turns || [])];
 function ranges(values){const a=[...new Set(values)].sort((x,y)=>x-y),out=[];for(let i=0;i<a.length;i++){const begin=a[i];while(i+1<a.length && a[i+1]===a[i]+1)i++;out.push(begin===a[i]?''+begin:begin+'–'+a[i]);}return out.join('、') || '无';}
 function shell(html){token++;window.MMAIOutline?.capture();$('mmDlgBody').innerHTML='<section class="mm-inspector">'+html+'<div class="nd-actions"><button type="button" class="mm-b" data-inspector-home>提示词与生成过程</button><span class="spacer"></span><button type="button" class="mm-b" data-mm="dclose">关闭</button></div></section>';if(!$('mmDlg').open)$('mmDlg').showModal();}

 function capacityDetails(snapshot){
   const t=snapshot.transfer||{},limits=snapshot.limits||{},bytes=n=>Number.isFinite(n)?(n/1048576).toFixed(2)+' MiB':'未记录',number=n=>Number.isFinite(n)?n.toLocaleString('zh-CN'):'未记录';
   const lines=[['缓存命中输入 token',Number.isFinite(t.cacheHitTokens)?number(t.cacheHitTokens):'未记录／平台未提供'],['缓存未命中输入 token',Number.isFinite(t.cacheMissTokens)?number(t.cacheMissTokens)+(t.cacheMissDerived?'（输入总量减命中量）':''):'未记录／平台未提供'],['其中思考输出 token',Number.isFinite(t.reasoningTokens)?number(t.reasoningTokens):'未记录／平台未提供'],['本次请求输出预算',number(limits.maxOutputTokens??t.maxOutputTokens)+' tokens'],['应用正文接收上限',bytes(limits.answerBytes??t.answerLimitBytes)],['已接收回答正文',bytes(t.answerBytes)],['已接收传输数据（含包装与思考片段）',bytes(t.transportBytes)],['平台结束原因',t.finishReason||'未记录'],['平台报告的实际输出用量',Number.isFinite(t.completionTokens)?number(t.completionTokens)+' tokens':'未记录／平台未提供'],['平台报告的输入用量',Number.isFinite(t.promptTokens)?number(t.promptTokens)+' tokens':'未记录／平台未提供']];
   const el=document.createElement('details');el.innerHTML='<summary>容量、用量与结束原因</summary><p class="mm-inspect-notice">token不是字数；应用预算不代表模型平台的能力上限。部分平台将思考token计入完成用量；旧记录缺失的统计不会按当前配置补猜。</p>';
   for(const [label,value]of lines){const p=document.createElement('p');p.textContent=label+'：'+value;el.append(p);}return el;
 }
 function openRecord(id){
   const record=getRecords().find(r=>r.id===id);if(!record)return;
   const docs=record.documents || [],runs=record.runs?[...record.runs]: (record.inspection?[{title:'本次整理 / 回答',status:record.status,inspection:record.inspection}]:[]);
   const structureStages=(record.structureReview?.stages || []).map(s=>({...s,title:'结构复核 · '+s.title}));runs.push(...structureStages);
   shell(`<h3>提示词与生成过程</h3><p>${esc(record.title || record.question || '生成记录')} · ${esc(statusName(record.status))}</p><p class="mm-inspect-notice">这里显示本次实际使用的提示词版本、输入和结果。页面图像只记为图像输入，不保存图像编码；不记录密钥或模型思考正文。</p>${docs.length?'<details open><summary>文件与处理范围</summary>'+docs.map(d=>`<div class="mm-inspect-source"><b>${esc(d.name)}</b><p>${esc(statusName(d.status))} · ${d.pageCount} 页 · ${d.embedded?'已选择嵌入到导图':'未选择嵌入到导图'}</p><p>已完成页码：${ranges(d.processedPages || [])}</p>${d.pageCount?`<p>尚未完成页码：${ranges(Array.from({length:d.pageCount},(_,i)=>i+1).filter(p=>!(d.processedPages || []).includes(p)))}</p>`:''}${d.error?`<p class="mm-outline-error">${esc(d.error)}</p>`:''}</div>`).join('')+'</details>':''}<div data-inspector-runs></div>${!runs.length?'<p>这条记录尚无模型调用，或生成于调查功能加入之前。</p>':''}${record.sections?.length?'<details><summary>章节详情（可直接展开，不再次调用模型）</summary>'+record.sections.map(s=>`<div class="mm-inspect-source"><b>${esc(s.title)}</b><p>第 ${ranges(s.pages)} 页</p><button class="mm-b" type="button" data-expand-section="${esc(s.id)}" data-record="${esc(record.id)}">${s.generatedIds?.some(n=>M.findNode(n))?'定位章节':'展开章节到导图'}</button></div>`).join('')+'</details>':''}`);
   const list=$('mmDlgBody').querySelector('[data-inspector-runs]');const usageHost=document.createElement('div');list.before(usageHost);const usage=window.MMAIUsage.attach(usageHost,{mapId:M.state().cur.id,startedAt:record.createdAt||Date.now()});usage.update(record,{stage:'生成记录统计'});usage.finish(record.status,{finishedAt:record.updatedAt||record.finishedAt||record.createdAt||Date.now()});
   if(record.structureReview){const summary=document.createElement('p');summary.className='mm-inspect-notice';summary.textContent='整图结构复核：'+statusName(record.structureReview.status)+(record.structureReview.note?' · '+record.structureReview.note:'')+(record.structureReview.plan?' · '+record.structureReview.plan.reason+(record.structureReview.plan.orderReason?' · 排序依据：'+record.structureReview.plan.orderReason:''):'');list.before(summary);}
   for(const run of runs){const details=document.createElement('details'),snapshot=run.inspection;details.innerHTML='<summary>'+esc(run.title || '模型阶段')+' · '+esc(statusName(run.status || snapshot?.status))+'</summary>';
     if(!snapshot){details.append(document.createTextNode(run.error || '尚未发出模型请求'));list.append(details);continue;}
     const meta=document.createElement('p');meta.className='mm-inspect-notice';meta.textContent=`模板：${snapshot.promptId} · 模板版本 ${snapshot.templateVersion} · 实际版本 ${snapshot.effectiveVersion} · 模型 ${snapshot.model}`;details.append(meta,capacityDetails(snapshot));
     function field(label,value){const p=document.createElement('p');p.textContent=label;const area=document.createElement('textarea');area.readOnly=true;area.setAttribute('aria-label',label);area.value=typeof value==='string'?value:JSON.stringify(value,null,2);details.append(p,area);}
     field('本次实际系统提示词',snapshot.system);field('本次输入',snapshot.input);field('本次输出',snapshot.output || {status:statusName(run.status),error:run.error || snapshot.error || '尚无完整输出'});
     if(snapshot.mathReview){const review=snapshot.mathReview;field('数学排版review：状态、修改与待检查项',review);if(snapshot.generatedOutput)field('数学review前的原始节点',snapshot.generatedOutput);}
     if(snapshot.planning){field('关联与定向提示词',snapshot.planning.system);field('关联与定向输入',snapshot.planning.input);field('关联与定向输出',snapshot.planning.output || {status:snapshot.planning.status || '尚无完整输出'});}
     if(run.error){const p=document.createElement('p');p.className='mm-outline-error';p.textContent=run.error;details.append(p);}list.append(details);
   }
   const refresh=document.createElement('button');refresh.type='button';refresh.className='mm-b';refresh.textContent='刷新过程';refresh.onclick=()=>openRecord(id);list.before(refresh);
 }
 async function open(){
   shell('<h3>提示词与生成过程</h3><p>正在读取提示词…</p>');const version=token;
   try{const response=await fetch('/api/ai/prompts'),data=await response.json();if(!response.ok)throw new Error(data.error || '无法读取提示词');if(version!==token || !$('mmDlg').open)return;
     const records=getRecords();shell('<h3>提示词与生成过程</h3><p class="mm-inspect-notice">提示词集中保存在项目的 prompts 文件夹。此入口只读；手工修改模板后，后续请求读取新版本，历史记录保留当时实际使用的版本。用户自定义编辑留待后续扩展。</p><details open><summary>提示词模板</summary><div data-prompt-templates></div></details><details><summary>当前导图的生成记录</summary><div class="mm-outline-records">'+(records.length?[...records].reverse().map(r=>`<button type="button" data-inspect-record="${esc(r.id)}">${esc(r.title || r.question || '生成记录')}<small>${esc(statusName(r.status))}</small></button>`).join(''):'<p>当前导图还没有生成记录。</p>')+'</div></details>');
     const list=$('mmDlgBody').querySelector('[data-prompt-templates]');for(const prompt of data.prompts){const details=document.createElement('details');details.innerHTML='<summary>'+esc(prompt.title)+'</summary><p class="mm-inspect-notice">'+esc(prompt.description)+'<br>'+esc(prompt.file)+' · 版本 '+esc(prompt.version)+'</p>';const text=document.createElement('textarea');text.readOnly=true;text.setAttribute('aria-label',prompt.title+'提示词');text.value=prompt.template;details.append(text);list.append(details);}
   }catch(e){if(version===token)shell('<h3>提示词与生成过程</h3><p class="mm-outline-error">'+esc(e.message)+'</p>');}
 }
 function sources(nodeId){
   const n=M.findNode(nodeId)?.n;if(!n)return;const docs=(M.state().cur.outlineSources || []).flatMap(r=>r.documents || []);
   shell('<h3>节点出处</h3><div class="mm-inspect-sources">'+(n.citations || []).map(c=>{const d=docs.find(d=>d.id===c.documentId),pdf=d?.mediaId && M.state().cur.nodes.find(n=>n.pdf===d.mediaId);return`<div class="mm-inspect-source"><b>${esc(d?.name || '来源文件已移除')}</b><p>第 ${c.page} 页</p>${pdf?`<button type="button" class="mm-b" data-source-pdf="${esc(pdf.id)}" data-page="${c.page}">查看原PDF这一页</button>`:'<p class="mm-inspect-notice">未在当前导图找到原PDF节点，仅保留出处信息。</p>'}</div>`;}).join('')+'</div>');
 }
 const button=document.createElement('button');button.id='mmAIInspectButton';button.type='button';button.className='mm-b';button.textContent='提示词与过程';button.title='查看提示词模板与实际生成过程';$('mmAPISettingsButton').after(button);button.onclick=open;
 document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-node-citations],[data-math-warning]'))event.stopPropagation();},true);
 document.addEventListener('click',async event=>{
   const warning=event.target.closest('[data-math-warning]');if(warning){event.preventDefault();event.stopImmediatePropagation();const node=M.findNode(warning.dataset.mathWarning)?.n;if(node){shell('<h3>公式待检查</h3><p>已保留原文，以下内容需要人工确认：</p><ul>'+node.mathWarnings.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul><p class="mm-inspect-notice">双击节点可编辑源码；具体复核过程可在当前导图的生成记录中查看。</p>');}return;}
   const citation=event.target.closest('[data-node-citations]');if(citation){event.preventDefault();event.stopImmediatePropagation();sources(citation.dataset.nodeCitations);return;}
   const home=event.target.closest('[data-inspector-home]');if(home){open();return;}
   const record=event.target.closest('[data-inspect-record]');if(record){openRecord(record.dataset.inspectRecord);return;}
   const pdf=event.target.closest('[data-source-pdf]');if(pdf){$('mmDlg').close();M.selectNodes([pdf.dataset.sourcePdf]);M.revealBox(M.state().L.nodes.get(pdf.dataset.sourcePdf));await window.MMPDF.activate(pdf.dataset.sourcePdf,{page:Number(pdf.dataset.page),preserveAI:true});return;}
   const section=event.target.closest('[data-expand-section]');if(section){const r=getRecords().find(r=>r.id===section.dataset.record),s=r?.sections.find(s=>s.id===section.dataset.expandSection);if(!s)return;try{$('mmDlg').close();window.MMAILecture.expand(r,s);}catch(e){window.showBanner(e.message);}return;}
   const inspect=event.target.closest('[data-outline-inspect]');if(inspect)openRecord(inspect.dataset.outlineInspect);
 },true);
 window.MMAIInspector={open,openRecord,sources};
})();
