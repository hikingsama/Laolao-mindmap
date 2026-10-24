/* Only one full reader is active. Inactive placements retain a raster preview
   of the visible document region, including page offsets and page boundaries. */
(() => {
  'use strict';
  const records=new Map(),documents=new Map(),M=()=>window.Mindmap;
  let modules,active=null,mapId=null,modal=null,hoverId=null,hoverTimer=0,leaveTimer=0,ownWheel=null,pointer={x:0,y:0};
  const state=id=>{const raw=M()?.state().cur?.pdfViews?.[id] || {},number=Number(raw.scale),scale=['page-width','page-fit','auto'].includes(raw.scale)?raw.scale:Number.isFinite(number)&&number>=.15&&number<=4?number:'page-width';return {page:Number.isSafeInteger(raw.page)&&raw.page>0?raw.page:1,scale,...(Number.isFinite(raw.top)&&raw.top>=0?{top:raw.top}:{}),...(Number.isFinite(raw.left)&&raw.left>=0?{left:raw.left}:{}),...(Number.isFinite(raw.offset)?{offset:raw.offset}:{})};};
  const asset=(id,map)=>'/api/maps/'+encodeURIComponent(map)+'/media/'+encodeURIComponent(id)+'?draft=1';
  async function libraries(){
    if(!modules)modules=(async()=>{const core=await import('/vendor/pdfjs/build/pdf.mjs');globalThis.pdfjsLib=core;core.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';return {core,...await import('/vendor/pdfjs/web/pdf_viewer.mjs')};})();
    try{return await modules;}catch(e){modules=null;throw e;}
  }
  async function documentFor(media,map){
    const key=map+':'+media;let entry=documents.get(key);
    if(!entry){entry={};documents.set(key,entry);entry.promise=(async()=>{const lib=await libraries();if(documents.get(key)!==entry)throw Error('PDF加载已取消');entry.task=lib.core.getDocument({url:asset(media,map),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false,enableXfa:false,disableAutoFetch:true,disableStream:true});return entry.task.promise;})();
      entry.promise.catch(()=>{if(documents.get(key)===entry)documents.delete(key);});
    }
    // Keep a few parsed files warm, never evict a reader or pending page render.
    entry.used=Date.now();return entry.promise;
  }
  function position(r){const page=r.viewer.currentPageNumber,view=r.viewer.getPageView(page-1),scale=r.viewer.currentScaleValue;return {page,scale:typeof scale==='string'?scale:Number(scale),top:r.scroll.scrollTop,left:r.scroll.scrollLeft,...(view?.div.clientHeight?{offset:(r.scroll.scrollTop-view.div.offsetTop)/view.div.clientHeight}:{})};}
  function persist(r){
    if(!r.viewer || !r.ready || r.map!==M()?.state().cur?.id || r.applying)return;
    const value=position(r);
    M().updatePDFView(r.id,value);r.applied=JSON.stringify(value);
  }
  function status(r,text){r.root.querySelector('.mm-pdf-status').textContent=text;}
  function viewport(r){const b=M()?.state().L?.nodes.get(r.id);return {w:Math.max(1,r.scroll.clientWidth || r.lastWidth || (b?.w || 460)-32),h:Math.max(1,r.scroll.clientHeight || r.lastHeight || (b?.h || 520)-70)};}
  function previewKey(r){return JSON.stringify([state(r.id),viewport(r)]);}
  function previewCanvas(r){const {w,h}=viewport(r),ratio=Math.min(1.5,Math.sqrt(4*1024*1024/(w*h))),canvas=document.createElement('canvas');canvas.width=Math.ceil(w*ratio);canvas.height=Math.ceil(h*ratio);canvas.getContext('2d').fillStyle='#e7e9ed';canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);return {canvas,ratio,w,h};}
  function showPreview(r,canvas,pages,key){r.cover.replaceChildren(canvas);r.cover.dataset.pages=pages.join(',');r.previewKey=key;r.previewPage=state(r.id).page;r.root.querySelector('.mm-pdf-cover-hint').textContent=`第 ${r.previewPage} / ${r.doc.numPages} 页 · 悬浮阅读`;r.root.querySelector('.mm-pdf-pages').textContent='/ '+r.doc.numPages;r.root.querySelector('.mm-pdf-page-input').value=r.previewPage;r.root.querySelector('.mm-pdf-page-input').max=r.doc.numPages;r.error=false;if(active!==r)status(r,'');}
  function freeze(r){
    if(!r.ready || !r.viewer)return false;const {canvas,ratio,w,h}=previewCanvas(r),ctx=canvas.getContext('2d'),box=r.scroll.getBoundingClientRect(),k=box.width/r.scroll.offsetWidth || 1,pages=[];
    for(const page of r.scroll.querySelectorAll('.page')){const source=page.querySelector('canvas'),rect=page.getBoundingClientRect(),x=(rect.left-box.left)/k,y=(rect.top-box.top)/k,number=Number(page.dataset.pageNumber);if(y>=h || y+rect.height/k<=0)continue;if(!source?.width || !source?.height || r.viewer.getPageView(number-1)?.renderingState!==3)return false;ctx.drawImage(source,x*ratio,y*ratio,rect.width/k*ratio,rect.height/k*ratio);pages.push(number);}
    if(!pages.length)return false;showPreview(r,canvas,pages,previewKey(r));return true;
  }
  function restorePosition(r,s){
    r.viewer.currentScaleValue=s.scale || 'page-width';r.viewer.currentPageNumber=Math.min(r.doc.numPages,Math.max(1,s.page || 1));const page=r.viewer.getPageView(r.viewer.currentPageNumber-1);
    if(page && Number.isFinite(s.offset))r.scroll.scrollTop=page.div.offsetTop+s.offset*page.div.clientHeight;else if(Number.isFinite(s.top))r.scroll.scrollTop=s.top;
    if(Number.isFinite(s.left))r.scroll.scrollLeft=s.left;r.viewer.update();
  }
  function layout(r){
    const top=r.root.querySelector('.mm-pdf-titlebar').offsetHeight+r.root.querySelector('.mm-pdf-toolbar').offsetHeight+r.root.querySelector('.mm-pdf-find').offsetHeight;r.scroll.style.top=top+'px';const cover=r.root.querySelector('.mm-pdf-cover');cover.style.top=top+'px';cover.style.width=r.scroll.clientWidth+'px';
    const {w,h}=viewport(r),changed=r.lastWidth!==w || r.lastHeight!==h;r.lastWidth=w;r.lastHeight=h;if(!changed)return;
    if(active===r && r.ready && !r.applying){const s=position(r),token=r.version;r.applying=true;cancelAnimationFrame(r.resizeFrame);r.resizeFrame=requestAnimationFrame(()=>{if(active!==r || token!==r.version || !r.viewer)return;restorePosition(r,s);r.applying=false;persist(r);});}
    else if(active!==r && r.root.isConnected)preview(r);
  }
  function title(r){
    const file=(M()?.state().cur?.media || []).find(m=>m.id===r.media),name=file?.name || 'PDF文档';
    const bar=r.root.querySelector('.mm-pdf-titlebar');bar.title=name+' · 拖动标题栏移动，右键设置样式';
    bar.querySelector('.mm-pdf-title').textContent=name;
  }
  function element(id,media){
    const currentId=M().state().cur.id;if(mapId!==currentId){close();mapId=currentId;}
    let r=records.get(id);if(r && r.media!==media){destroy(r);r=null;}
    if(r){title(r);return r.root;}
    const root=document.createElement('div');root.className='mm-pdf-shell';root.dataset.pdfNode=id;root.dataset.reading='false';root.tabIndex=0;
    root.innerHTML=`<div class="mm-pdf-titlebar" data-image-label="${id}" role="button" tabindex="0" aria-label="拖动PDF标题栏移动节点"><span class="mm-pdf-title-icon" aria-hidden="true">PDF</span><span class="mm-pdf-title"></span><span class="mm-pdf-grip" aria-hidden="true">⠿</span></div><div class="mm-pdf-cover"><div class="mm-pdf-page-preview"></div><span class="mm-pdf-cover-hint">PDF · 悬浮阅读</span></div><div class="mm-pdf-reader" hidden><div class="mm-pdf-toolbar"><button data-pdf="prev" title="上一页">‹</button><input class="mm-pdf-page-input" type="number" min="1" value="1" aria-label="PDF页码"><span class="mm-pdf-pages">/ —</span><button data-pdf="next" title="下一页">›</button><button data-pdf="zoom-out" title="缩小PDF页面">−</button><button data-pdf="zoom-in" title="放大PDF页面">＋</button><button data-pdf="fit" title="适应宽度">适宽</button><button data-pdf="find" title="搜索文档（Ctrl+F）">搜索</button><button data-pdf="expand" title="放大阅读">⛶</button><button data-pdf="close" title="退出阅读（Esc）">退出</button></div><div class="mm-pdf-find" hidden><input type="search" aria-label="搜索PDF正文" placeholder="搜索文档文字"><button data-pdf="find-prev" title="上一个结果">↑</button><button data-pdf="find-next" title="下一个结果">↓</button><span class="mm-pdf-match" aria-live="polite"></span></div><div class="mm-pdf-scroll" tabindex="0"><div class="pdfViewer"></div></div></div><div class="mm-pdf-status" role="status">正在加载PDF预览…</div>`;
    r={id,media,map:currentId,root,scroll:root.querySelector('.mm-pdf-scroll'),cover:root.querySelector('.mm-pdf-page-preview'),ready:false,version:0,previewPage:0};records.set(id,r);
    title(r);
    root.querySelector('.mm-pdf-titlebar').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();M().selectNode(id);}});
    root.querySelector('.mm-pdf-reader').hidden=false;
    r.uiResize=new ResizeObserver(()=>layout(r));r.uiResize.observe(root);r.uiResize.observe(root.querySelector('.mm-pdf-toolbar'));r.uiResize.observe(root.querySelector('.mm-pdf-find'));
    root.addEventListener('contextmenu',e=>{if(active===r && !e.target.closest('.mm-pdf-titlebar'))e.stopPropagation();});root.addEventListener('dblclick',e=>{if(active===r && !e.target.closest('.mm-pdf-titlebar'))e.stopPropagation();});
    root.addEventListener('click',e=>{const action=e.target.closest('[data-pdf]')?.dataset.pdf;if(!action)return;e.stopPropagation();
      if(action==='close'){deactivate();return;}if(!r.ready)return;
      if(action==='prev')r.viewer.currentPageNumber=Math.max(1,r.viewer.currentPageNumber-1);
      if(action==='next')r.viewer.currentPageNumber=Math.min(r.doc.numPages,r.viewer.currentPageNumber+1);
      if(action==='zoom-in' || action==='zoom-out'){r.viewer.currentScale=Math.min(4,Math.max(.15,r.viewer.currentScale*(action==='zoom-in'?1.2:1/1.2)));}
      if(action==='fit')r.viewer.currentScaleValue='page-width';
      if(action==='find')showFind(r);
      if(action==='find-prev' || action==='find-next')find(r,action==='find-prev',true);
      if(action==='expand')expand(r);
      persist(r);
    });
    root.querySelector('.mm-pdf-page-input').onchange=e=>{if(!r.ready)return;const page=Number(e.target.value);r.viewer.currentPageNumber=Math.min(r.doc.numPages,Math.max(1,Math.trunc(page)||1));e.target.value=r.viewer.currentPageNumber;persist(r);};
    root.querySelector('.mm-pdf-find input').oninput=()=>find(r);
    r.scroll.addEventListener('scroll',()=>{clearTimeout(r.timer);r.timer=setTimeout(()=>persist(r),180);});
    return root;
  }
  function preview(r,force=false){if(r.previewBusy){r.previewAgain ||= force || r.previewTarget!==previewKey(r);return r.previewPromise || Promise.resolve();}const task=renderPreview(r,force);r.previewPromise=task;return task;}
  async function renderPreview(r,force=false){
    const s=state(r.id),key=previewKey(r);if(r.previewBusy || (!force && (r.error || r.previewKey===key)))return;r.previewBusy=true;r.previewTarget=key;
    const token=r.version;
    try{const doc=await documentFor(r.media,r.map);if(records.get(r.id)!==r || token!==r.version)return;r.doc=doc;
      const number=Math.min(doc.numPages,Math.max(1,s.page)),anchor=await doc.getPage(number),unit=anchor.getViewport({scale:1}),{canvas,ratio,w,h}=previewCanvas(r),ctx=canvas.getContext('2d'),scale=s.scale==='page-width'?w/unit.width:s.scale==='page-fit'?Math.min(w/unit.width,h/unit.height):s.scale==='auto'?Math.min(1.25*96/72,w/unit.width):Number(s.scale)*96/72;
      const size=page=>({w:Math.max(1,Math.floor(page.getViewport({scale}).width)),h:Math.max(1,Math.floor(page.getViewport({scale}).height))});
      let index=number,y=-((s.offset || 0)*size(anchor).h),page=anchor;const pages=[];
      // Legacy snapshots stored only absolute scrollTop. Translate it once using page metadata.
      if(!Number.isFinite(s.offset) && Number.isFinite(s.top)){let before=0;for(let i=1;i<number;i++)before+=size(await doc.getPage(i)).h+10;y=before-s.top;}
      while(y>0 && index>1){page=await doc.getPage(--index);y-=size(page).h+10;}
      for(;index<=doc.numPages && y<h;index++){
        if(records.get(r.id)!==r || token!==r.version)return;page=await doc.getPage(index);const dimensions=size(page),bottom=y+dimensions.h;
        if(bottom>0){const x=Math.max(0,(w-dimensions.w)/2)-(s.left || 0),visibleLeft=Math.max(0,x),visibleTop=Math.max(0,y),cropX=Math.max(0,-x),cropY=Math.max(0,-y),visibleWidth=Math.min(w,x+dimensions.w)-visibleLeft,visibleHeight=Math.min(h,bottom)-visibleTop;
          if(visibleWidth>0){const tile=document.createElement('canvas');tile.width=Math.ceil(visibleWidth*ratio);tile.height=Math.ceil(visibleHeight*ratio);
            r.renderTask=page.render({canvas:tile,canvasContext:tile.getContext('2d'),viewport:page.getViewport({scale}),transform:[ratio,0,0,ratio,-cropX*ratio,-cropY*ratio]});await r.renderTask.promise;ctx.drawImage(tile,visibleLeft*ratio,visibleTop*ratio);
          }pages.push(index);
        }y=bottom+10;
      }
      if(records.get(r.id)!==r || token!==r.version || key!==previewKey(r)){r.previewAgain=true;return;}showPreview(r,canvas,pages,key);
    }catch(e){if(e.name!=='RenderingCancelledException' && records.get(r.id)===r){r.error=true;status(r,e.name==='PasswordException'?'暂不支持加密PDF，请使用解密后的文件':'PDF无法读取：'+e.message);}}
    finally{r.previewBusy=false;r.renderTask=null;trim();if(r.previewAgain && records.get(r.id)===r){r.previewAgain=false;queueMicrotask(()=>preview(r));}}
  }
  function showFind(r){const bar=r.root.querySelector('.mm-pdf-find');bar.hidden=false;layout(r);const input=bar.querySelector('input');input.focus({preventScroll:true});input.select();r.viewer?.update();}
  function find(r,previous=false,again=false){if(!r.bus)return;const query=r.root.querySelector('.mm-pdf-find input').value;r.bus.dispatch('find',{source:r.root,type:again?'again':'',query,phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous,matchDiacritics:false});}
  async function activate(id,options={}){
    const n=M().findNode(id)?.n;if(!n?.pdf)return;
    if(options.page){M().updatePDFView(id,{page:options.page,scale:'page-width'});if(active?.id===id && active.ready){active.viewer.currentPageNumber=Math.min(active.doc.numPages,options.page);persist(active);return;}}
    if(options.hover && (M().view().k<=.2 || M().state().editing))return;
    if(active?.id===id){if(!options.hover){active.hover=false;M().selectNode(id);if(active.ready && (M().view().k<.65))expand(active);else active.scroll.focus({preventScroll:true});}return;}
    deactivate();if(!options.hover){if(!options.preserveAI)M().finishEditing();M().selectNode(id);}const box=M().state().L.nodes.get(id);if(box && !options.hover)M().ensureVisible({x:box.x,y:box.y-38,w:Math.min(box.w,350),h:100});const root=element(id,n.pdf),r=records.get(id);active=r;r.hover=!!options.hover;r.version++;r.applying=true;r.root.dataset.reading='true';r.root.dataset.ready='false';r.root.querySelector('.mm-pdf-reader').hidden=false;status(r,'正在打开PDF…');
    M().refresh();layout(r);const token=r.version,saved=state(id);
    try{
      const lib=await libraries(),doc=await documentFor(r.media,r.map);if(active!==r || token!==r.version)return;r.doc=doc;
      const bus=r.bus=new lib.EventBus(),linkService=new lib.PDFLinkService({eventBus:bus,externalLinkTarget:lib.LinkTarget.BLANK,externalLinkRel:'noopener noreferrer'}),findController=new lib.PDFFindController({eventBus:bus,linkService});
      r.abort=new AbortController();r.viewer=new lib.PDFViewer({container:r.scroll,viewer:r.scroll.querySelector('.pdfViewer'),eventBus:bus,linkService,findController,annotationMode:0,textLayerMode:1,annotationEditorMode:-1,removePageBorders:true,maxCanvasPixels:4*1024*1024,enableDetailCanvas:false,enableAutoLinking:false,abortSignal:r.abort.signal});linkService.setViewer(r.viewer);linkService.setDocument(doc);
      bus.on('pagesinit',()=>{if(active!==r)return;restorePosition(r,saved);r.root.querySelector('.mm-pdf-pages').textContent='/ '+doc.numPages;r.root.querySelector('.mm-pdf-page-input').max=doc.numPages;
        requestAnimationFrame(()=>{if(active!==r || token!==r.version)return;restorePosition(r,saved);if(r.pending){r.scroll.scrollTop+=r.pending.y;r.scroll.scrollLeft+=r.pending.x;r.pending=null;}r.ready=true;r.applying=false;r.root.dataset.ready='true';r.root.querySelector('.mm-pdf-cover').hidden=true;status(r,'');r.viewer.update();persist(r);if(!r.hover){if(box && (box.w*M().view().k<320 || box.h*M().view().k<260))expand(r);r.scroll.focus({preventScroll:true});}});});
      bus.on('pagechanging',({pageNumber})=>{r.root.querySelector('.mm-pdf-page-input').value=pageNumber;if(r.ready)persist(r);});
      bus.on('updatefindmatchescount',({matchesCount})=>{r.root.querySelector('.mm-pdf-match').textContent=matchesCount.total?`${matchesCount.current} / ${matchesCount.total}`:'无匹配';});
      bus.on('updatefindcontrolstate',({state:code})=>{if(code===1)r.root.querySelector('.mm-pdf-match').textContent='无匹配';});
      r.viewer.setDocument(doc);
    }catch(e){if(active===r)status(r,'PDF无法打开：'+e.message);}
  }
  function moveReader(r,move){
    const page=r.viewer?.currentPageNumber || state(r.id).page,scale=r.viewer?.currentScaleValue || state(r.id).scale,pageView=r.viewer?.getPageView(page-1),fraction=pageView?.div.clientHeight?(r.scroll.scrollTop-pageView.div.offsetTop)/pageView.div.clientHeight:0,version=r.version;
    r.applying=true;move();requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(active!==r || !r.viewer || version!==r.version)return;r.viewer.currentScaleValue=scale;r.viewer.currentPageNumber=page;
      const view=r.viewer.getPageView(page-1);if(view)r.scroll.scrollTop=view.div.offsetTop+fraction*view.div.clientHeight;r.viewer.update();r.applying=false;persist(r);r.scroll.focus({preventScroll:true});
    }));
  }
  function restoreModal(){if(!modal?.open)return;const r=active,node=r && document.querySelector(`.mm-node[data-id="${r.id}"]`);if(r && node)moveReader(r,()=>{modal.close();node.replaceChildren(r.root);});else modal.close();}
  function expand(r){
    if(modal?.open){restoreModal();requestAnimationFrame(()=>r.viewer?.update());return;}
    if(!modal){modal=document.createElement('dialog');modal.className='mm-pdf-dialog';modal.setAttribute('aria-label','PDF放大阅读');document.body.appendChild(modal);modal.addEventListener('cancel',e=>{e.preventDefault();deactivate();});}
    moveReader(r,()=>{modal.replaceChildren(r.root);modal.showModal();});
  }
  function deactivate(){
    const r=active;if(!r)return;persist(r);const frozen=freeze(r);restoreModal();active=null;r.version++;r.ready=false;r.applying=false;cancelAnimationFrame(r.resizeFrame);clearTimeout(r.timer);r.root.dataset.reading='false';r.root.dataset.ready='false';r.root.querySelector('.mm-pdf-cover').hidden=false;
    ownWheel=null;r.pending=null;
    r.viewer?.setDocument(null);r.abort?.abort();r.viewer=null;r.bus=null;r.scroll.querySelector('.pdfViewer').replaceChildren();layout(r);if(!frozen || r.previewKey!==previewKey(r))preview(r,true);
  }
  function destroy(r){if(active===r){restoreModal();active=null;}r.version++;clearTimeout(r.timer);cancelAnimationFrame(r.resizeFrame);r.renderTask?.cancel();r.uiResize?.disconnect();r.abort?.abort();r.viewer?.setDocument(null);r.root.remove();records.delete(r.id);}
  function trim(){if(documents.size<=3)return;for(const [key,entry] of [...documents].sort((a,b)=>a[1].used-b[1].used)){
    const media=key.slice(key.indexOf(':')+1);if([...records.values()].some(r=>r.media===media && (r===active || r.previewBusy)))continue;documents.delete(key);entry.task?.destroy();if(documents.size<=3)break;
  }}
  function sync(){
    const map=M()?.state().cur;if(!map)return;
    if(mapId!==map.id){close();mapId=map.id;}
    const ids=new Set(map.nodes.filter(n=>n.pdf).map(n=>n.id));for(const r of [...records.values()])if(!ids.has(r.id))destroy(r);
    for(const r of records.values())if(r.root.isConnected && r!==active)preview(r);
    if(active?.ready && !active.applying){const s=state(active.id),json=JSON.stringify(s);if(json!==active.applied){active.applied=json;active.applying=true;restorePosition(active,s);active.applying=false;}}
  }
  function close(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);hoverId=null;ownWheel=null;for(const r of [...records.values()])destroy(r);for(const e of documents.values())e.task?.destroy();documents.clear();mapId=null;}
  function exportNode(id,target){
    const r=records.get(id),page=r?.viewer?.currentPageNumber || r?.previewPage || 1,canvas=r?.cover.querySelector('canvas');target.replaceChildren();
    const bar=r?.root.querySelector('.mm-pdf-titlebar');if(bar)target.appendChild(bar.cloneNode(true));
    if(canvas){const image=document.createElement('img');image.src=canvas.toDataURL('image/png');image.className='mm-pdf-export';image.style.height='calc(100% - 30px)';target.appendChild(image);}
    else{const label=document.createElement('div');label.textContent='PDF · 第 '+page+' 页';target.appendChild(label);}
  }
  // Window capture precedes the canvas' dragging and global keyboard handlers.
  function foreignWheel(id){const old=M()?.scrollGesture(),now=performance.now();return old && now-old.at<220 && old.owner!==id;}
  function currentPDF(target){return target?.closest?.('.mm-pdf-titlebar')?null:target?.closest?.('.mm-pdf-shell')?.dataset.pdfNode || null;}
  function scheduleHover(id){
    clearTimeout(hoverTimer);clearTimeout(leaveTimer);hoverId=id;
    if(id){const open=()=>{if(hoverId!==id || !M()?.state().cur)return;if(foreignWheel(id) || ownWheel && performance.now()-ownWheel.at<220 && ownWheel.id!==id){hoverTimer=setTimeout(open,230);return;}activate(id,{hover:true});};hoverTimer=setTimeout(open,160);}
    else{const closeWhenIdle=()=>{if(!active || modal?.open || hoverId===active.id)return;const focus=document.activeElement,selection=getSelection();if(active.root.contains(focus)&&focus.matches('input,select,textarea') || selection?.toString() && active.root.contains(selection.anchorNode) || ownWheel && performance.now()-ownWheel.at<220){leaveTimer=setTimeout(closeWhenIdle,250);return;}deactivate();};leaveTimer=setTimeout(closeWhenIdle,280);}
  }
  window.addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};if(e.pointerType==='touch' || e.buttons)return;const id=currentPDF(e.target);if(id!==hoverId)scheduleHover(id);},true);
  window.addEventListener('pointerup',e=>{pointer={x:e.clientX,y:e.clientY};const id=currentPDF(document.elementFromPoint(pointer.x,pointer.y));if(id!==hoverId)scheduleHover(id);},true);
  window.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY};ownWheel=null;M()?.resetScroll?.();if(e.target.closest('.mm-pdf-titlebar') && !modal?.open){clearTimeout(hoverTimer);hoverId=null;if(active)deactivate();return;}if(active?.root.contains(e.target)){if((e.ctrlKey||e.metaKey)&&!modal?.open){deactivate();return;}e.stopPropagation();}else if(active)deactivate();},true);
  for(const type of ['copy','cut','paste'])window.addEventListener(type,e=>{if(active?.root.contains(e.target) || (type==='copy' && active?.root.contains(window.getSelection()?.anchorNode)))e.stopPropagation();},true);
  window.addEventListener('keydown',e=>{
    if(!active || !active.root.contains(e.target))return;
    if((e.ctrlKey||e.metaKey)&&['s','=','+','-'].includes(e.key.toLowerCase()))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();deactivate();document.getElementById('mmView')?.focus();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();showFind(active);}
    if(e.key==='Enter' && e.target.matches('.mm-pdf-find input')){e.preventDefault();find(active,e.shiftKey,true);}
    if(e.key==='Enter' && e.target.matches('.mm-pdf-page-input')){e.preventDefault();e.target.dispatchEvent(new Event('change'));active.scroll.focus({preventScroll:true});}
    e.stopPropagation();
  },true);
  window.addEventListener('wheel',e=>{
    if(modal?.open && active?.root.contains(e.target)){e.preventDefault();if(e.ctrlKey||e.metaKey){if(active.viewer)active.viewer.currentScale=Math.min(4,Math.max(.15,active.viewer.currentScale*Math.exp(-e.deltaY*.0022)));}else{active.scroll.scrollTop+=e.deltaY;active.scroll.scrollLeft+=e.deltaX;}e.stopPropagation();return;}
    if(e.ctrlKey||e.metaKey){ownWheel=null;return;}if(!M()?.state().cur || M().state().editing || M().view().k<=.2)return;
    const now=performance.now(),locked=ownWheel && now-ownWheel.at<220 && active?.id===ownWheel.id,id=locked?ownWheel.id:currentPDF(e.target);if(!id || !locked && foreignWheel(id))return;
    if(active?.id!==id)activate(id,{hover:true});const r=active;if(!r || r.id!==id)return;e.preventDefault();e.stopPropagation();ownWheel={id,at:now};const unit=e.deltaMode===1?24:e.deltaMode===2?r.scroll.clientHeight:1,k=M().view().k;let x=e.deltaX*unit/k,y=e.deltaY*unit/k;if(e.shiftKey&&!x){x=y;y=0;}if(r.ready){r.scroll.scrollTop+=y;r.scroll.scrollLeft+=x;}else{r.pending ||= {x:0,y:0};r.pending.x+=x;r.pending.y+=y;}
  },{capture:true,passive:false});
  async function prepareExport(){const map=M().state().cur;if(active)persist(active);for(const n of map.nodes.filter(n=>n.pdf)){if(M().state().cur!==map)throw Error('导图已切换，请重新导出');element(n.id,n.pdf);const r=records.get(n.id);await preview(r,true);if(M().state().cur!==map)throw Error('导图已切换，请重新导出');if(r.previewPage!==(state(n.id).page || 1))await preview(r,true);}}
  function retry(files){for(const r of records.values())if(r.error && r!==active && r.root.isConnected && files.some(f=>f.id===r.media)){r.error=false;preview(r,true);}}
  window.MMPDF={element,sync,activate,deactivate,isActive:id=>active?.id===id,capture:()=>{if(active)persist(active);},close,exportNode,prepareExport,retry};
})();
