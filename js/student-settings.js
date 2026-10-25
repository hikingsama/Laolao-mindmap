(()=>{
 'use strict';
 const button=document.getElementById('mmStudentSettingsButton');if(!button)return;
 const dialog=document.createElement('dialog');dialog.id='mmStudentSettingsDialog';dialog.className='mm-api-dialog';dialog.setAttribute('aria-labelledby','mmStudentSettingsTitle');
 dialog.innerHTML='<form id="mmStudentSettingsForm"><div class="mm-api-heading"><h2 id="mmStudentSettingsTitle">学习背景</h2><button class="mm-b ic" id="mmStudentClose" type="button" aria-label="关闭学习背景">✕</button></div><div class="mm-api-body"><p class="mm-api-protocol">填写一次，供整个思维导图模块使用。AI 会参考这些信息调整解释深度；各项均可留空，之后可随时修改。</p><div class="mm-api-field"><label for="mmStudentGrade">年级 / 学习阶段</label><input id="mmStudentGrade" maxlength="80" placeholder="例如：本科一年级"></div><div class="mm-api-field"><label for="mmStudentMajor">专业 / 方向</label><input id="mmStudentMajor" maxlength="120" placeholder="例如：机械工程"></div><div class="mm-api-field"><label for="mmStudentCourses">已经学过的课程</label><textarea id="mmStudentCourses" maxlength="2000" rows="4" placeholder="例如：高中数学、微积分上册、大学物理力学；可补充尚不熟悉的内容"></textarea><small>课程之间可换行或用逗号分隔。</small></div></div><div class="mm-api-footer"><p>保存后用于后续提问、导图生成与结构复核。已生成的节点保留原文。</p><p id="mmStudentResult" class="mm-api-result" role="status" aria-live="polite"></p><div class="mm-api-actions"><span class="mm-api-action-gap"></span><button class="mm-b" id="mmStudentCancel" type="button">取消</button><button class="mm-b pri" id="mmStudentSave" type="submit">保存</button></div></div></form>';
 document.body.appendChild(dialog);
 const $=id=>document.getElementById(id),fields={grade:$('mmStudentGrade'),major:$('mmStudentMajor'),courses:$('mmStudentCourses')},result=$('mmStudentResult');let revision=null,pending=null,saving=false,session=0,returnTarget=button,homeProfile=null,homeError='',homeVersion=0,homeFrame=0;
 function report(text,kind=''){result.textContent=text;result.dataset.kind=kind;}
 function busy(value){for(const field of Object.values(fields))field.disabled=value;$('mmStudentSave').disabled=value;$('mmStudentClose').disabled=$('mmStudentCancel').disabled=saving;dialog.setAttribute('aria-busy',String(value));}
 async function request(options,signal){let response;try{response=await fetch('api/ai/student-profile',{...options,signal});}catch(e){if(e.name==='AbortError')throw e;throw Error('无法连接本机服务，请确认服务已启动。');}let data;try{data=await response.json();}catch{throw Error('学习背景接口返回异常，请重启服务后刷新。');}if(!response.ok)throw Error(data.error || '无法读取学习背景，请重启服务后刷新。');return data;}
 function renderHome(){
   const card=document.querySelector('.mm-home-student');if(!card)return;
   const write=(selector,text)=>{const el=card.querySelector(selector);if(el && el.textContent!==text)el.textContent=text;};
   const filled=homeProfile && Object.values(homeProfile).some(Boolean),summary=card.querySelector('[data-student-summary]');summary.hidden=!filled;
   write('[data-student-description]',filled?'AI 会参考这些信息，调整解释的深度和使用的方法。':'填写年级、专业和已学课程，让每次解释更贴合你的基础。');
   for(const key of ['grade','major','courses']){const el=card.querySelector('[data-student-'+key+']'),text=homeProfile?.[key] || '未填写';if(el.textContent!==text)el.textContent=text;el.title=text;}
   write('[data-student-settings]',filled?'修改学习背景':'填写学习背景');
   write('[data-student-state]',homeError || (homeProfile?'全模块共用 · 可随时修改':'正在读取学习背景…'));
 }
 function scheduleHome(){if(homeFrame)return;homeFrame=requestAnimationFrame(()=>{homeFrame=0;renderHome();});}
 async function refreshHome(){const token=++homeVersion;try{const data=await request({});if(token!==homeVersion)return;homeProfile=data.profile;homeError='';}catch{if(token!==homeVersion)return;homeError='暂时无法读取，打开设置后可重试。';}renderHome();}
 function close(){if(saving)return;session++;pending?.abort();dialog.close();(returnTarget?.isConnected?returnTarget:button).focus();}
 async function open(trigger=button){
   if(document.querySelector('dialog[open]'))return;returnTarget=trigger;revision=null;for(const field of Object.values(fields))field.value='';dialog.showModal();
   const token=++session,controller=new AbortController();pending=controller;busy(true);report('正在读取学习背景…');
   try{const data=await request({},controller.signal);if(token!==session || !dialog.open)return;revision=data.revision;homeVersion++;homeProfile=data.profile;homeError='';renderHome();for(const [key,field] of Object.entries(fields))field.value=data.profile[key];report('');}
   catch(e){if(token===session && e.name!=='AbortError')report(e.message,'error');}
   finally{if(token===session && dialog.open){pending=null;busy(false);$('mmStudentSave').disabled=revision===null;fields.grade.focus();}}
 }
 button.addEventListener('click',()=>open(button));
 document.addEventListener('click',event=>{const trigger=event.target.closest('[data-student-settings]');if(trigger)open(trigger);});
 $('mmStudentSettingsForm').addEventListener('submit',async event=>{
   event.preventDefault();if(saving || revision===null)return;saving=true;busy(true);report('正在保存…');const controller=new AbortController();pending=controller;
   try{const profile=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value]));const data=await request({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,profile})},controller.signal);revision=data.revision;homeVersion++;homeProfile=data.profile;homeError='';renderHome();for(const [key,field] of Object.entries(fields))field.value=data.profile[key];report('已保存，后续提问与生成将使用此背景。','success');window.dispatchEvent(new Event('mm:student-profile-saved'));}
   catch(e){report(e.message,'error');}finally{saving=false;pending=null;busy(false);}
 });
 $('mmStudentClose').onclick=$('mmStudentCancel').onclick=close;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{session++;pending?.abort();pending=null;revision=null;for(const field of Object.values(fields))field.value='';});
 for(const type of ['keydown','copy','cut','paste'])document.addEventListener(type,event=>{if(!dialog.open)return;event.stopImmediatePropagation();if(type==='keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s')event.preventDefault();},true);
 const box=document.getElementById('mmBox');if(box)new MutationObserver(scheduleHome).observe(box,{childList:true,subtree:true});
 window.addEventListener('focus',()=>{if(document.querySelector('.mm-home-student'))refreshHome();});
 refreshHome();
})();

