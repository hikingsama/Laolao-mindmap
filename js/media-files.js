(() => {
  "use strict";
  const $=id=>document.getElementById(id), M=()=>window.Mindmap, states=window.MMWorkspaceSessions?.states || new Map(), esc=s=>window.MMContent.escape(String(s));
  let open=false, mapId=null, disk=[], diskMap=null, error="", uploading=false, revision=0, fileBusy=false, busy=false;
  const expanded=new Set();
  const current=()=>M()?.state().cur;
  const url=(id,asset="")=>`/api/maps/${encodeURIComponent(id)}${asset?"/media/"+encodeURIComponent(asset)+"?draft=1":""}`;
  async function request(address,options) {
    options={...options,headers:{...options?.headers}};
    const match=/^\/api\/maps\/([^/?]+)\/media(?:[/?]|$)/.exec(address);
    if(match){const state=states.get(decodeURIComponent(match[1]));if(state?.token){if(!address.includes('draft=1'))address+=(address.includes('?')?'&':'?')+'draft=1';options.headers['X-MM-Draft-Token']=state.token;}}
    let r;try{r=await fetch(address,options);}catch(error){if(error.name==='AbortError')throw error;throw new Error("本地文件服务未连接，请检查启动窗口，并通过本地服务地址使用导图");}
    const value=await r.json();if(!r.ok)throw new Error(value.error || "文件操作失败");return value;
  }
  function status(message) {const el=$("mmFileStatus");if(el)el.textContent=message;const top=$("mmSync");if(top && current())top.textContent=message;}
  const draftKey=id=>'mm_recovery_v1_'+id;
  function state(id){let s=states.get(id);if(!s || s.disabled){s={chain:Promise.resolve(),latest:null,saved:null,timer:null,token:null,base:null,ready:null,disabled:false};states.set(id,s);}return s;}
  function remember(id,s,json){const value={map:JSON.parse(json),token:s.token,updated:Date.now()};if(window.MMDocumentCache)window.MMDocumentCache.set(draftKey(id),value);else try{localStorage.setItem(draftKey(id),JSON.stringify(value));}catch{}}
  function choose(kind){
    const dlg=$("mmDlg"),editor=document.querySelector('.mm-edit');
    const recovery=kind==='recover',saving=kind==='save';
    $("mmDlgBody").innerHTML=recovery?`<h3>发现未完成的编辑</h3><p>是否恢复上次的草稿？正式保存的版本仍然保留。</p><div class="mm-label-buttons"><button class="mm-b" data-session-choice="cancel">取消打开</button><button class="mm-b" data-session-choice="discard">放弃草稿</button><button class="mm-b pri" data-session-choice="recover">恢复草稿</button></div>`:`<h3>${saving?'保存并退出':'不保存退出'}</h3><p>${saving?'保存当前修改后，返回主界面？':'确定放弃最近一次明确保存之后的修改，并返回主界面？'}</p><div class="mm-label-buttons"><button class="mm-b" data-session-choice="cancel">取消</button><button class="mm-b ${saving?'pri':'danger'}" data-session-choice="confirm">${saving?'保存并退出':'放弃修改并退出'}</button></div>`;
    return new Promise(resolve=>{
      let settled=false;
      const cancel=e=>{e.preventDefault();finish('cancel');};
      const finish=value=>{if(settled)return;settled=true;dlg.removeEventListener('cancel',cancel);dlg.close();if(editor?.isConnected)editor.focus();resolve(value);};
      dlg.querySelectorAll('[data-session-choice]').forEach(b=>b.onclick=()=>finish(b.dataset.sessionChoice));
      // close events are asynchronous; a preceding dialog's event must not cancel
      // a confirmation opened immediately after it.
      dlg.addEventListener('cancel',cancel);if(!dlg.open)dlg.showModal();
    });
  }
  async function prepare(map){
    const s=state(map.id);if(s.ready)return s.ready;if(s.token)return map;
    const opening=(async()=>{
      let data=await request(url(map.id)+'/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:map})});
      s.token=data.token;s.base=structuredClone(data.base);await M().noteFile(data.base);
      let local;await window.MMDocumentCache?.load([draftKey(map.id)]);try{local=window.MMDocumentCache?window.MMDocumentCache.get(draftKey(map.id)):JSON.parse(localStorage.getItem(draftKey(map.id)));}catch{}
      if(local?.token===data.token && local.updated>data.updated && JSON.stringify(local.map)!==JSON.stringify(data.base))data={...data,draft:local.map,recoverable:true};
      s.openingClean=!data.recoverable;
      if(data.recoverable){const choice=await choose('recover');if(choice==='cancel'){s.token=null;return null;}if(choice==='discard'){
        await request(url(map.id)+'/draft',{method:'DELETE',headers:{'X-MM-Draft-Token':s.token}});if(window.MMDocumentCache)window.MMDocumentCache.remove(draftKey(map.id));else localStorage.removeItem(draftKey(map.id));data=await request(url(map.id)+'/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:data.base})});s.token=data.token;s.base=structuredClone(data.base);s.openingClean=true;return data.base;
      }return data.draft;}
      return data.base;
    })();s.ready=opening;
    try{return await opening;}catch(e){states.delete(map.id);throw e;}finally{s.ready=null;}
  }
  function queue(map){
    if(!map?.id)return;const existing=states.get(map.id);if(existing?.disabled)return;const s=state(map.id),json=JSON.stringify(map);if(s.latest===json)return;
    s.latest=json;remember(map.id,s,json);clearTimeout(s.timer);if(current()?.id===map.id)status('正在自动保存草稿…');
    s.timer=setTimeout(()=>flushId(map.id).catch(e=>{if(current()?.id===map.id)status(e.message);}),400);
  }
  function flushId(id){
    const s=states.get(id);if(!s || s.disabled)return Promise.resolve();clearTimeout(s.timer);
    s.chain=s.chain.catch(()=>{}).then(async()=>{if(s.ready)await s.ready;if(!s.token || !s.latest || s.disabled)return;
      const snapshot=s.latest;if(s.saved===snapshot)return;await request(url(id)+'/draft',{method:'PUT',headers:{'Content-Type':'application/json','X-MM-Draft-Token':s.token},body:snapshot});s.saved=snapshot;remember(id,s,snapshot);if(current()?.id===id)status(s.cleanEditor===stable(JSON.parse(snapshot))?'已保存':'草稿已自动保存');
    });return s.chain;
  }
  async function flush(map=current()){if(!map)return;queue(map);await flushId(map.id);await window.MMDocumentCache?.flush();}
  function lock(on){busy=on;window.dispatchEvent(new Event('mm:file-busy'));$("mmBox").inert=on;$("mmTitleIn").disabled=on;for(const id of ['mmSaveExit','mmDiscardExit','mmOpenLocal'])$(id).disabled=on;}
  async function saveCheckpoint(exit=false){
    if(busy || uploading || fileBusy){showBanner('文件正在处理，请稍后再试');return false;}const map=current();if(!map)return false;
    lock(true);revision++;
    try{M().finishEditing();await flush(map);const s=states.get(map.id),result=await request(url(map.id)+'/commit',{method:'POST',headers:{'X-MM-Draft-Token':s.token}});
      s.token=result.token;s.base=structuredClone(result.map);s.cleanEditor=stable(result.map);s.saved=null;if(window.MMDocumentCache)window.MMDocumentCache.remove(draftKey(map.id));else localStorage.removeItem(draftKey(map.id));await M().noteFile(result.map);
      if(exit){s.disabled=true;clearTimeout(s.timer);M().leaveDocument(result.map);}else{M().replaceDocument(result.map);s.latest=JSON.stringify(result.map);s.saved=s.latest;status('已正式保存');}
      window.dispatchEvent(new Event('mm:files-saved'));
      return true;
    }catch(e){showBanner(e.message);status('保存失败：'+e.message);return false;}finally{lock(false);}
  }
  async function exit(save){
    if(busy || uploading || fileBusy){showBanner('文件正在处理，请稍后退出');return;}
    const map=current();if(!map)return;if(await choose(save?'save':'discard')!=='confirm')return;
    if(save){await saveCheckpoint(true);return;}
    lock(true);revision++;
    try{const s=states.get(map.id);clearTimeout(s.timer);await s.chain.catch(()=>{});
      const result=await request(url(map.id)+'/draft',{method:'DELETE',headers:{'X-MM-Draft-Token':s.token}});s.disabled=true;clearTimeout(s.timer);s.latest=null;
      if(window.MMDocumentCache)window.MMDocumentCache.remove(draftKey(map.id));else localStorage.removeItem(draftKey(map.id));await M().noteFile(result.map);M().leaveDocument(result.map);
    }catch(e){showBanner('未能退出，草稿已保留：'+e.message);}finally{lock(false);}
  }
  function items(){
    const map=current();if(!map)return [];
    const used=new Set(map.nodes.map(n=>n.image || n.pdf).filter(Boolean)),list=new Map();
    for(const f of map.media || [])if(!f.sourceMap || f.sourceMap===map.id || used.has(f.id))list.set(f.id,f);
    if(diskMap===map.id)for(const f of disk)list.set(f.id,{...list.get(f.id),...f,sourceMap:map.id});
    return [...list.values()];
  }
  function placements(id){return (current()?.nodes || []).filter(n=>(n.image || n.pdf)===id);}
  function locationLabel(node,index){
    const b=M().state().L?.nodes.get(node.id),groups=(current()?.groups || []).filter(g=>b && window.MMGroups?.contains(g,b)).sort((a,b)=>a.w*a.h-b.w*b.h);
    return '位置 '+(index+1)+' · '+(groups[0]?.title || '未分组');
  }
  function locate(id){const box=M().state().L?.nodes.get(id);if(!box)return;M().selectNode(id);M().revealBox(box);}
  function confirmDelete(media){
    const count=placements(media.id).length,dlg=document.createElement('dialog');
    dlg.id='mmMediaDeleteDialog';dlg.className='mm-workspace-confirm';dlg.setAttribute('aria-labelledby','mmMediaDeleteTitle');dlg.setAttribute('aria-describedby','mmMediaDeleteDescription');
    dlg.innerHTML=`<h3 id="mmMediaDeleteTitle">删除「${esc(media.name)}」？</h3><p id="mmMediaDeleteDescription">${count?`同时删除画布上使用此文件的 ${count} 个节点及相关连线。`:'此文件尚未放置到画布。'}删除操作可撤销。若仅需要删除某个位置，请在当前弹窗选择取消，然后在画布中单独删除目标节点。</p><div class="mm-label-buttons"><button type="button" class="mm-b" data-media-delete="cancel" autofocus>取消</button><button type="button" class="mm-b danger" data-media-delete="confirm">删除文件</button></div>`;
    document.body.append(dlg);
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;dlg.close();dlg.remove();resolve(value);};
      dlg.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dlg.addEventListener('close',()=>finish(false));
      // Canvas shortcuts must not act on nodes while this modal has focus.
      dlg.addEventListener('keydown',e=>e.stopPropagation());
      dlg.querySelectorAll('[data-media-delete]').forEach(b=>b.onclick=()=>finish(b.dataset.mediaDelete==='confirm'));
      dlg.showModal();dlg.querySelector('[data-media-delete="cancel"]').focus();
    });
  }
  function renameDialog(media,submit){
    const dlg=$('mmDlg'),ext=/\.[^.]+$/.exec(media.name)?.[0] || '',stem=ext?media.name.slice(0,-ext.length):media.name;
    $('mmDlgBody').innerHTML=`<form id="mmMediaRenameForm"><h3>重命名媒体文件</h3><p>修改文件主名，后缀保持不变。同一文件在画布上的所有标签会一起更新。</p><div class="mm-media-rename-name"><input id="mmMediaRenameName" aria-label="文件主名" value="${esc(stem)}" maxlength="${255-ext.length}" required><input id="mmMediaRenameExt" aria-label="文件后缀" value="${esc(ext)}" readonly tabindex="-1"></div><p id="mmMediaRenameError" class="mm-file-error" role="alert"></p><div class="mm-label-buttons"><button type="button" class="mm-b" id="mmMediaRenameCancel">取消</button><button type="submit" class="mm-b pri" id="mmMediaRenameConfirm">重命名</button></div></form>`;
    return new Promise(resolve=>{let pending=false,settled=false;
      const close=()=>{if(settled || pending)return;settled=true;dlg.removeEventListener('cancel',cancel);dlg.close();resolve();},cancel=e=>{e.preventDefault();close();};
      $('mmMediaRenameCancel').onclick=close;dlg.addEventListener('cancel',cancel);
      $('mmMediaRenameForm').onsubmit=async e=>{e.preventDefault();if(pending)return;const raw=$('mmMediaRenameName').value.trim(),name=ext && raw.toLowerCase().endsWith(ext.toLowerCase())?raw.slice(0,-ext.length):raw;
        if(!name || name.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)){$('mmMediaRenameError').textContent='请输入有效的文件主名，不要包含路径或特殊字符。';return;}
        pending=true;$('mmMediaRenameConfirm').disabled=true;$('mmMediaRenameCancel').disabled=true;
        try{await submit(name+ext);pending=false;close();}catch(error){$('mmMediaRenameError').textContent=error.message;}finally{pending=false;if($('mmMediaRenameConfirm')){$('mmMediaRenameConfirm').disabled=false;$('mmMediaRenameCancel').disabled=false;}}
      };
      dlg.showModal();$('mmMediaRenameName').focus();$('mmMediaRenameName').select();
    });
  }
  async function rename(mediaId){
    if(!current() || busy || fileBusy || uploading || $('mmDlg').open)return;const map=current(),media=items().find(f=>f.id===mediaId);if(!media)return;
    window.MMContextMenus?.hideAll();M().finishEditing();fileBusy=true;
    try{await renameDialog(media,async name=>{
      if(current()!==map)throw Error('导图已切换，请重新打开文件菜单。');if(name===media.name)return;
      await flush(map);const updated=await request(url(map.id,media.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
      if(current()===map){M().editMap(()=>{for(const f of map.media || [])if(f.id===media.id)f.name=updated.name;});await refresh();}
    });}finally{fileBusy=false;}
  }
  function renameNode(id){const node=M().findNode(id)?.n;if(node) return rename(node.image || node.pdf);}
  function renderList() {
    const list=$("mmMediaList");if(!list || !current())return;
    list.innerHTML=items().map(f=>{const nodes=placements(f.id),show=expanded.has(f.id);return `<div class="mm-media-item" data-media-id="${esc(f.id)}"><button class="mm-media-open" data-file-action="locate" data-id="${esc(f.id)}" aria-expanded="${show}">${f.mime==='application/pdf'?'<span class="mm-media-pdf-icon">PDF</span>':`<img src="${url(current().id,f.id)}" alt="${esc(f.name)}">`}<span>${esc(f.name)}</span></button><small>${nodes.length?'使用中 · '+nodes.length+' 处':'未放置到画布'}${f.bytes?' · '+Math.round(f.bytes/1024)+' KB':''}</small><div class="mm-media-actions"><button class="mm-b" data-file-action="insert" data-id="${esc(f.id)}">插入</button><button class="mm-b" data-file-action="rename" data-id="${esc(f.id)}">改名</button><button class="mm-b danger" data-file-action="remove" data-id="${esc(f.id)}">删除文件</button></div>${show?`<div class="mm-media-places">${nodes.map((n,i)=>`<button data-file-action="location" data-id="${esc(f.id)}" data-node="${esc(n.id)}">${esc(locationLabel(n,i))}<small>定位 ↗</small></button>`).join('')}</div>`:''}</div>`;}).join('') || `<p class="mm-media-empty">还没有媒体文件。可选择或拖入图片、PDF，也可粘贴截图。</p>`;
    if(error) {const p=document.createElement("p");p.className="mm-file-error";p.textContent=error;list.prepend(p);}
  }
  async function refresh() {
    const map=current(),id=map?.id,token=++revision;if(!id)return;
    try{await flush(map);const data=await request(url(id)+"/media");if(current()!==map || token!==revision)return;
      disk=data.files.map(f=>({...f,sourceMap:id}));diskMap=id;error="";M().syncMedia(disk);renderList();
      // A cross-map paste may mount its image before the staged copy is ready.
      // Retained node DOM needs an explicit retry once the file list confirms it.
      for(const image of document.querySelectorAll('.mm-node-image'))if(!image.naturalWidth){const node=M().findNode(image.closest('.mm-node').dataset.id)?.n;if(node && disk.some(f=>f.id===node.image))image.src=url(id,node.image)+'&v='+token;}
      window.MMPDF?.retry(disk);
    }catch(e){if(current()===map && token===revision){error=e.message;renderList();}}
  }
  async function openLocal() {
    try {
      await flush();const data=await request("/api/maps"),dlg=$("mmDlg");
      $("mmDlgBody").innerHTML=`<h3>打开本地导图</h3><p>从 storage/maps 下读取导图及同文件夹中的图片、PDF。</p><select id="mmLocalMapSelect"><option value="">选择导图…</option>${data.maps.map(m=>`<option value="${esc(m.id)}">${esc(m.title || "未命名导图")}</option>`).join("")}</select><button class="mm-b" id="mmLocalMapClose">关闭</button>`;
      $("mmLocalMapClose").onclick=()=>dlg.close();$("mmLocalMapSelect").onchange=async e=>{if(!e.target.value)return;try{const map=await request(url(e.target.value));await M().openDocument(map);dlg.close();}catch(err){showBanner(err.message);}};dlg.showModal();
    }catch(e){showBanner(e.message);}
  }
  function mount() {
    const tools=document.querySelector(".mm-tools"),main=document.querySelector(".mm-main");if(!tools || !main || $("mmMediaPanel"))return;
    const group=document.createElement("div");group.className="mm-tg";group.innerHTML=`<button class="mm-b" id="mmMediaToggle" aria-expanded="${open}">媒体文件</button><button class="mm-b" id="mmInsertImage">插入图片</button><button class="mm-b" id="mmInsertPDF">插入PDF</button><input id="mmImagePicker" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden><input id="mmPDFPicker" type="file" accept="application/pdf,.pdf" multiple hidden>`;tools.appendChild(group);
    const panel=document.createElement("aside");panel.id="mmMediaPanel";panel.className="mm-media-panel";panel.innerHTML=`<div class="mm-media-heading"><b>媒体文件</b><button class="mm-b" id="mmMediaClose" aria-label="关闭媒体文件">✕</button></div><p id="mmMapFolder"></p><p id="mmFileStatus" role="status"></p><button class="mm-b" id="mmMediaRefresh">刷新文件列表</button><div id="mmMediaList"></div>`;main.prepend(panel);
    $("mmMediaToggle").onclick=()=>toggle(!open);$("mmMediaClose").onclick=()=>toggle(false);$("mmMediaRefresh").onclick=refresh;
    $("mmInsertImage").onclick=()=>$("mmImagePicker").click();$("mmImagePicker").onchange=async e=>{await insertFiles([...e.target.files]);e.target.value="";};
    $("mmInsertPDF").onclick=()=>$("mmPDFPicker").click();$("mmPDFPicker").onchange=async e=>{await insertFiles([...e.target.files]);e.target.value='';};
    panel.addEventListener("click",async e=>{
      const b=e.target.closest("[data-file-action]");if(!b || !current())return;if(busy || fileBusy || uploading){status('文件正在处理，请稍后再试');return;}const map=current(),id=map.id,media=items().find(m=>m.id===b.dataset.id);if(!media)return;
      if(b.dataset.fileAction==='rename'){await rename(media.id);return;}
      fileBusy=true;try {
        if(b.dataset.fileAction==='locate'){const nodes=placements(media.id);if(nodes.length===1)locate(nodes[0].id);else if(nodes.length>1){expanded.has(media.id)?expanded.delete(media.id):expanded.add(media.id);renderList();}return;}
        if(b.dataset.fileAction==='location'){locate(b.dataset.node);return;}
        if(b.dataset.fileAction==="insert") {if(media.mime==='application/pdf')M().addPDF(media,center());else{const size=await dimensions(url(id,media.id));if(current()===map)M().addImage({...media,...size},center());}}
        if(b.dataset.fileAction==="remove") {
          if(!await confirmDelete(media))return;
          if(current()!==map)throw Error('导图已切换，请重新打开文件菜单。');
          M().finishEditing();await flush(map);
          if(current()!==map)throw Error('导图已切换，请重新打开文件菜单。');
          await request(url(id,media.id),{method:"DELETE"});
          if(current()===map){
            revision++;if(diskMap===id)disk=disk.filter(f=>f.id!==media.id);expanded.delete(media.id);error='';
            M().editMap(()=>{const ids=new Set(map.nodes.filter(n=>(n.image || n.pdf)===media.id).map(n=>n.id));map.nodes=map.nodes.filter(n=>!ids.has(n.id));map.edges=(map.edges||[]).filter(e=>!ids.has(e.from.node)&&!ids.has(e.to.node));for(const name of M().LAYER_MAPS)for(const id of ids)delete(map[name]||{})[id];map.media=(map.media||[]).filter(f=>f.id!==media.id);});
            await refresh();if(current()===map)status(error?'文件已删除，列表刷新失败：'+error:'文件及相关节点已删除，可撤销');
          }
        }
      }catch(e){if(current()===map){showBanner(e.message);status((b.dataset.fileAction==='remove'?'删除失败：':'文件操作失败：')+e.message);}}finally{fileBusy=false;}
    });
    toggle(open,false);
  }
  function toggle(on,load=true){open=on;if($("mmMediaPanel"))$("mmMediaPanel").classList.toggle("hidden",!on);$("mmMediaToggle")?.setAttribute("aria-expanded",String(on));window.dispatchEvent(new Event("resize"));if(on && load)refresh();}
  function onDraw(map) {
    const changed=mapId!==map.id;
    if(changed){revision++;disk=[];diskMap=null;error='';expanded.clear();}
    mapId=map.id;mount();$("mmMapFolder").textContent=`storage/maps/${map.id}/`;renderList();queue(map);
    const state=states.get(map.id);if(state?.saved===state?.latest)status(state.cleanEditor===stable(map)?'已保存':'草稿已自动保存');
    if(changed && open)refresh();
  }
  function center(){const r=$("mmView").getBoundingClientRect(),p=M().clientPoint(r.left+r.width/2,r.top+r.height/2);return {x:p.x-150,y:p.y-110};}
  function dimensions(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error("图片无法解码，请使用 PNG、JPEG、GIF 或 WebP 文件"));img.src=src;});}
  async function insertFiles(files,at) {
    if(uploading || !current())return;const map=current(),id=map.id;uploading=true;let offset=0;
    try {
      await flush(map);
      for(const file of files) {
        const pdf=file.type==='application/pdf' || /\.pdf$/i.test(file.name);if(file.size>(pdf?50:20)*1024*1024)throw new Error(pdf?'PDF超过50MB':'图片超过20MB，请缩小后插入');
        let size;if(!pdf){const temp=URL.createObjectURL(file);try{size=await dimensions(temp);}finally{URL.revokeObjectURL(temp);}}
        else if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('文件不是有效的PDF');
        const media=await request(url(id)+"/media",{method:"POST",headers:{"Content-Type":"application/octet-stream",'X-MM-File-Name':encodeURIComponent(file.name)},body:file});
        if(current()?.id!==id)throw new Error("导图已切换，文件保存在原导图草稿，请切回后从媒体列表插入");
        const p=at || center();if(pdf)M().addPDF(media,{x:p.x+offset,y:p.y+offset});else M().addImage({...media,...size},{x:p.x+offset,y:p.y+offset});offset+=36;
      }
      await flush(map);open=true;toggle(true);await refresh();
    }catch(e){showBanner(e.message);status(e.message);}finally{uploading=false;}
  }
  document.addEventListener("paste",e=>{
    if(!current() || e.target.closest("input,textarea,[contenteditable=true]") || $("mmDlg").open)return;
    const files=[...(e.clipboardData?.items || [])].filter(i=>i.kind==="file" && (i.type.startsWith("image/") || i.type==='application/pdf')).map(i=>i.getAsFile()).filter(Boolean);
    if(files.length){e.preventDefault();e.stopImmediatePropagation();insertFiles(files);}
  },true);
  document.addEventListener("dragover",e=>{if(e.target.closest("#mmView") && e.dataTransfer?.types.includes("Files")){e.preventDefault();e.dataTransfer.dropEffect="copy";}},true);
  document.addEventListener("drop",e=>{if(!current() || !e.target.closest("#mmView") || !e.dataTransfer?.files?.length)return;e.preventDefault();e.stopImmediatePropagation();insertFiles([...e.dataTransfer.files],M().clientPoint(e.clientX,e.clientY));},true);
  async function forget(id){const s=states.get(id);if(!s)return;s.disabled=true;clearTimeout(s.timer);await s.chain.catch(()=>{});states.delete(id);}
  let aiImageUploads=Promise.resolve();
  function stageAIImage(dataUrl,mapId,signal){
    const task=aiImageUploads.catch(()=>{}).then(()=>{if(signal?.aborted)throw new DOMException('已停止','AbortError');return storeAIImage(dataUrl,mapId,signal);});
    aiImageUploads=task;return task;
  }
  async function storeAIImage(dataUrl,mapId,signal){
    const map=current();if(!map || map.id!==mapId)throw new Error('导图已切换，图片尚未保存，请返回原导图重试');
    if(fileBusy || uploading || busy)throw new Error('文件正在处理，请稍后重试配图');
    fileBusy=true;
    try{
      const size=await dimensions(dataUrl),blob=await (await fetch(dataUrl)).blob();
      if(blob.size>20*1024*1024)throw new Error('生成图片超过20MB');
      await flush(map);
      if(current()?.id!==mapId)throw new Error('导图已切换，请返回原导图重试');
      if(!states.get(mapId)?.token)throw new Error('导图草稿尚未准备好，请稍后重试');
      if(signal?.aborted)throw new DOMException('已停止','AbortError');
      const media=await request(url(mapId)+'/media',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob,signal});
      if(current()?.id!==mapId)throw new Error('图片已留在原导图草稿，请返回原导图查看');
      return {...media,...size};
    }finally{fileBusy=false;}
  }
  async function stagePDF(file,mapId,signal){
    if(current()?.id!==mapId)throw new Error('导图已切换，PDF未保存');
    if(busy || uploading || fileBusy)throw new Error('文件正在处理，请稍后再试');
    if(file.size>50*1024*1024 || new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('请使用50MB以内的有效PDF');
    fileBusy=true;try{await flush();signal?.throwIfAborted();if(current()?.id!==mapId)throw new Error('导图已切换，PDF未保存');
      const media=await request(url(mapId)+'/media',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-MM-File-Name':encodeURIComponent(file.name)},body:file,signal});
      if(current()?.id!==mapId)throw new Error('PDF已留在原导图草稿，未写入新导图');return media;
    }finally{fileBusy=false;}
  }

  // Ignore property order; opening migrations establish a clean editor baseline.
  function stable(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
  function editorOpened(map){const s=states.get(map.id);if(s?.openingClean){s.cleanEditor=stable(map);s.openingClean=false;}}
  async function hasChanges(){const map=current();if(!map)return false;await flush(M().editingSnapshot());const s=states.get(map.id),data=await request(url(map.id)+'/draft');return !!data.mediaChanged||(s?.cleanEditor?stable(M().editingSnapshot())!==s.cleanEditor:!!data.recoverable);}
  async function discardCheckpoint(){
    await window.MMFiles.whenIdle();const map=current();if(!map)return true;lock(true);revision++;
    try{M().finishEditing();const s=states.get(map.id);clearTimeout(s.timer);await s.chain.catch(()=>{});
      const result=await request(url(map.id)+'/draft',{method:'DELETE',headers:{'X-MM-Draft-Token':s.token}});
      const data=await request(url(map.id)+'/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:result.map})});
      s.token=data.token;s.base=structuredClone(data.base);s.latest=null;s.saved=null;s.openingClean=true;if(window.MMDocumentCache)window.MMDocumentCache.remove(draftKey(map.id));else localStorage.removeItem(draftKey(map.id));await M().noteFile(data.base);M().restoreCheckpoint(data.base);editorOpened(current());status('已保存');return true;
    }catch(e){showBanner('未能放弃修改，当前内容已保留：'+e.message);return false;}finally{lock(false);}
  }
  function capacityInfo(id){const s=states.get(id),map=current();
    if(!s||map?.id!==id)return null;
    const json=s.latest;
    if(typeof json==='string'&&s.measuredJSON!==json){s.measuredJSON=json;s.documentBytes=new Blob([json]).size;}
    return{documentBytes:s.documentBytes??null,attachmentBytes:(map.media||[]).reduce((sum,f)=>sum+(Number.isFinite(f.bytes)?f.bytes:0),0)};
  }
  window.MMFiles={capacityInfo,hasChanges,discard:discardCheckpoint,editorOpened,get busy(){return busy||uploading||fileBusy;},whenIdle:async()=>{const started=Date.now();while(busy||uploading||fileBusy){if(Date.now()-started>60000)throw new Error('文件操作仍在进行，请稍后再切换导图');await new Promise(resolve=>setTimeout(resolve,25));}},sessionSnapshot:id=>{const s=states.get(id);return s && !s.disabled && s.token && s.latest?JSON.parse(s.latest):null;},stagePDF,stageAIImage,queue,flush,onDraw,insertFiles,refresh,prepare,save:saveCheckpoint,exit,renameNode,forget};
  for(const [id,save] of [['mmSaveExit',true],['mmDiscardExit',false]]){$(id).addEventListener('pointerdown',e=>e.preventDefault());$(id).onclick=()=>exit(save);}
  document.addEventListener('keydown',e=>{if(busy){e.preventDefault();e.stopImmediatePropagation();return;}if(current() && (e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s' && !e.target.closest('#mmAI,#mmShortcuts')){e.preventDefault();e.stopImmediatePropagation();saveCheckpoint();}},true);
  document.addEventListener('input',e=>{if(current() && (e.target.matches('.mm-edit') || e.target.id==='mmTitleIn'))queue(M().editingSnapshot());});
  window.addEventListener('beforeunload',()=>{if(current())queue(M().editingSnapshot());});
  $("mmOpenLocal").onclick=openLocal;
})();
