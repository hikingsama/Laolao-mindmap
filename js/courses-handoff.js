/* Courses handoff v1: short capability links, explicit v3 edges and acknowledged saves. */
(function(){
  'use strict';
  const params=new URLSearchParams(location.search);if(params.get('from')!=='courses_app')return;
  let active=null,starting=null,busy=false,observer;
  const F=()=>window.CoursesMindmapFormat,M=()=>window.Mindmap;
  const allowed=new Set(window.COURSES_HANDOFF_ALLOWED_ORIGINS||['http://localhost:3000','http://127.0.0.1:3000',location.origin]);
  const receiptKey=(bridge,id)=>'courses_handoff_v1:'+bridge+':'+id;
  const readJSON=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  function remember(){try{localStorage.setItem(receiptKey(active.bridge,active.mapId),JSON.stringify({localId:active.localId,revision:active.revision}));}catch{}}
  function status(text,error=false){
    let box=document.getElementById('coursesHandoffStatus');
    if(!box){box=document.createElement('aside');box.id='coursesHandoffStatus';box.setAttribute('role','status');box.style.cssText='position:fixed;bottom:18px;left:18px;z-index:10000;max-width:min(520px,90vw);padding:12px 16px;background:#fffef8;border:1px solid #b9c2a7;border-radius:10px;box-shadow:0 4px 18px #0002;font:14px/1.6 system-ui';document.body.appendChild(box);}
    box.replaceChildren();const label=document.createElement('span');label.textContent=text;box.appendChild(label);
    if(error){const retry=document.createElement('button');retry.textContent='重试';retry.style.marginLeft='12px';retry.onclick=()=>active?saveBack():start();box.appendChild(retry);}return box;
  }
  async function request(url,options={}){
    let response;try{response=await fetch(url,{...options,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});}catch{throw Error('课程交接服务未连接，请确认课程后端已启动；本地修改仍保留');}
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.message||'交接失败（HTTP '+response.status+'）');return data;
  }
  async function localMap(id){
    const local=readJSON('mm_map_'+id);if(local?.id===id)return local;
    const response=await fetch('/api/maps/'+encodeURIComponent(id));if(response.status===404)return null;
    if(!response.ok)throw Error('无法读取本地导图，请检查本地文件服务');return response.json();
  }
  function controls(){
    const current=M()?.state().cur,tools=document.querySelector('.mm-tools');let button=document.getElementById('coursesSaveBack');
    if(!active||current?.id!==active.localId||!tools){button?.remove();return;}
    if(!button){button=document.createElement('button');button.id='coursesSaveBack';button.className='mm-b';button.textContent='保存并回传课程';button.onclick=saveBack;tools.appendChild(button);}
    if(button.disabled!==busy)button.disabled=busy;
  }
  async function saveBack(){
    if(busy)return;const current=M()?.state().cur;
    if(!active||current?.id!==active.localId){status('请先打开本次交接的导图，再回传课程',true);return;}
    busy=true;controls();
    try{
      if(!window.MMFiles||!await window.MMFiles.save())throw Error('本地保存未完成，尚未回传课程');
      if(M().state().cur?.id!==active.localId)throw Error('当前导图已切换，请重新回传');
      const map=F().normalize(M().state().cur);map.id=active.mapId;delete map.coursesSource;
      status('本地已保存，正在回传课程…');
      const result=await request(active.endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({map,revision:active.revision})});
      active.revision=result.revision;remember();
      if(M().state().cur?.id===active.localId){
        const latest=JSON.parse(JSON.stringify(M().state().cur));latest.coursesSource={bridge:active.bridge,mapId:active.mapId,revision:active.revision,source:active.source};M().replaceDocument(latest);
        if(!await window.MMFiles.save())throw Error('课程回传已成功；本地检查点未保存，请重试保存');
      }
      status('已保存并回传课程。切回课程页即可查看更新。');
    }catch(error){status(error.message,true);}finally{busy=false;controls();}
  }
  async function legacy(){
    const outline=params.get('outline'),legacyId=params.get('legacy');
    if(legacyId){if(!/^courses-legacy-[a-f0-9]{32}$/.test(legacyId))throw Error('旧交接链接无效');const map=await localMap(legacyId);if(!map)throw Error('旧交接内容已不可用，请从课程页重新打开');const opened=await M().openDocument(map);if(opened===false||M().state().cur?.id!==legacyId)throw Error('旧导图未能打开，请检查本地文件服务');return;}
    if(!outline?.trim())throw Error('交接内容缺失，请从课程页重新打开');
    const title=(params.get('title')||'思维导图').trim();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(title+'\n'+outline)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const id='courses-legacy-'+hash.slice(0,32),map=await localMap(id)||F().fromOutline(outline,title,id);
    const opened=await M().openDocument(map);if(opened===false||M().state().cur?.id!==id)throw Error('导图未能打开，请检查本地文件服务或恢复草稿');
    const url=new URL(location.href);url.searchParams.delete('title');url.searchParams.delete('outline');url.searchParams.set('legacy',id);history.replaceState(null,'',url);
    status('已打开旧版课程链接。自动回传需从更新后的课程页面重新进入。');
  }
  function start(){if(starting)return starting;starting=(async()=>{
    status('正在接收课程导图…');
    try{
      for(let i=0;i<100&&(!M()?.openDocument||!F());i++)await new Promise(r=>setTimeout(r,50));
      if(!M()?.openDocument||!F())throw Error('导图组件尚未就绪，请刷新重试');
      const token=new URLSearchParams(location.hash.slice(1)).get('handoff');
      if(!token){await legacy();return;}
      if(!/^[a-f0-9]{64}$/.test(token))throw Error('交接链接无效，请从课程页重新打开');
      const bridge=new URL(params.get('bridge')||'',location.href);
      if(!/^https?:$/.test(bridge.protocol)||!allowed.has(bridge.origin)||bridge.username||bridge.password||bridge.search||bridge.hash||!/^\/[^?#]*api\/mindmap-handoffs\/?$/.test(bridge.pathname))throw Error('课程交接地址未获准，请核对部署配置');
      bridge.pathname=bridge.pathname.replace(/\/$/,'');const endpoint=bridge.href+'/'+token,data=await request(endpoint);
      if(data.version!==1||!/^courses-[a-f0-9]{32}$/.test(data.mapId)||typeof data.revision!=='string')throw Error('课程返回的交接格式无效');
      const receipt=readJSON(receiptKey(bridge.href,data.mapId));
      let localId=receipt?.localId||data.mapId;
      if(!/^courses-[a-f0-9]{32}(?:-[a-f0-9]{12})?$/.test(localId))localId=data.mapId;
      let map=await localMap(localId),forked=false;
      if(map&&map.coursesSource?.revision!==data.revision&&receipt?.revision!==data.revision){
        localId=data.mapId+'-'+data.revision.slice(0,12);map=await localMap(localId);forked=true;
      }
      if(!map){map=data.map?F().normalize(data.map):F().fromOutline(data.outline,data.title,localId);map.id=localId;
        map.coursesSource={bridge:bridge.href,mapId:data.mapId,revision:data.revision,source:data.source};
      }else if(map.coursesSource?.bridge!==bridge.href||map.coursesSource?.mapId!==data.mapId)throw Error('本地导图来源不匹配，未覆盖现有内容');
      const opened=await M().openDocument(map);if(opened===false||M().state().cur?.id!==localId)throw Error('导图未打开，请检查本地文件服务或恢复草稿');
      active={bridge:bridge.href,endpoint,mapId:data.mapId,localId,revision:data.revision,source:data.source};remember();controls();
      status(forked?'课程版本有更新，已另开版本，原本地导图仍保留。':'课程导图已打开；编辑后点击“保存并回传课程”。');
      if(!observer){observer=new MutationObserver(controls);observer.observe(document.body,{childList:true,subtree:true});}
    }catch(error){status(error.message,true);}finally{starting=null;}
  })();return starting;}
  window.CoursesHandoff={start,saveBack};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
