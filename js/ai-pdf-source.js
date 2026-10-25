// Page batches only transport the initial survey. Knowledge is generated from planned semantic units.
(() => {
 'use strict';
 async function open(file,signal){
   if(file.size>50*1024*1024)throw new Error('PDF超过50MB，请压缩后再选择');
   if(new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('文件不是有效的 PDF');
   signal?.throwIfAborted();
   const lib=await import('/vendor/pdfjs/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
   const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false,enableXfa:false});
   let locked=false;task.onPassword=()=>{locked=true;task.destroy().catch(()=>{});};
   const abort=()=>task.destroy().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
   try{const doc=await task.promise;return{doc,lib,close:async()=>{signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}};}
   catch(e){signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});if(signal?.aborted)throw signal.reason;throw new Error(locked?'PDF已加密，请先解除密码后导入':'PDF无法读取，请确认文件完整且能正常打开');}
 }
 async function metadata(file){const pdf=await open(file);try{return pdf.doc.numPages;}finally{await pdf.close();}}
 function encode(canvas){for(const q of [.85,.65,.45]){const value=canvas.toDataURL('image/jpeg',q);if(value.length<=2*1024*1024)return value;}throw new Error('页面图像过大，无法发送给模型');}
 async function* batches(entry,{signal,reading='auto',onPage=()=>{},selection=null}){
   const pdf=await open(entry.file,signal);let pages=[],images=[],chars=0,render=null;
   const cancel=()=>render?.cancel();signal.addEventListener('abort',cancel,{once:true});
   try{
     for(let number=1;number<=pdf.doc.numPages;number++){
       if(selection && !selection.has(number))continue;
       signal.throwIfAborted();onPage(number,pdf.doc.numPages);const page=await pdf.doc.getPage(number);
       let content;try{content=await page.getTextContent();}catch(e){if(signal.aborted)throw signal.reason;throw new Error('第'+number+'页文字提取失败，未跳过该页');}
       const text=content.items.map(t=>t.str+(t.hasEOL?'\n':' ')).join('');
       let visual=reading==='visual' || text.trim().length<35;
       if(reading==='auto' && !visual){const ops=await page.getOperatorList(),names=['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','constructPath'];visual=ops.fnArray.some(n=>names.some(name=>pdf.lib.OPS[name]===n));}
       if(reading==='text'){visual=false;if(!text.trim())throw new Error('第'+number+'页没有可提取文字，请改用自动识别或图文理解');}
       let image=null;
       if(visual){
         signal.throwIfAborted();const unit=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.7,1600/Math.max(unit.width,unit.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
         // Generation screenshots must advance even when the tab has no animation frames.
         // The local PDF.js extension keeps display intent and optional layers unchanged.
         try{render=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)',annotationMode:0,useRequestAnimationFrame:false});await render.promise;signal.throwIfAborted();image={documentId:entry.id,page:number,dataUrl:encode(canvas)};}
         finally{render=null;canvas.width=canvas.height=1;}
       }
       const pieces=Math.max(1,Math.ceil(text.length/12000));
       for(let part=1;part<=pieces;part++){
         const value=text.slice((part-1)*12000,part*12000);
         if(pages.length && (chars+value.length>18000 || pages.length>=4 || images.length>=3)){yield{pages,images};pages=[];images=[];chars=0;signal.throwIfAborted();}
         pages.push({documentId:entry.id,page:number,text:value,part,parts:pieces,visual:!!image});chars+=value.length;if(image && !images.some(i=>i.page===number))images.push(image);
       }
       page.cleanup();
     }
     if(pages.length)yield{pages,images};
   }finally{signal.removeEventListener('abort',cancel);await pdf.close();}
 }
 async function readUnit(entries,references,options){
   const pages=[],images=[],imageKeys=new Set();let chars=0;
   for(const entry of entries){
     const selection=new Set(references.filter(c=>c.documentId===entry.id).map(c=>c.page));if(!selection.size)continue;
     for await(const batch of batches(entry,{...options,selection})){
       pages.push(...batch.pages);for(const image of batch.images){const key=image.documentId+':'+image.page;if(!imageKeys.has(key)){imageKeys.add(key);images.push(image);}}chars+=batch.pages.reduce((n,p)=>n+p.text.length,0);
       if(chars>60000 || images.length>24)throw new Error('该完整知识单元超过单次读取范围，请将材料按有意义的子主题或子论证拆分后再生成；未截断原文');
     }
   }
   const supplied=new Set(pages.map(p=>p.documentId+':'+p.page));
   if(references.some(c=>!supplied.has(c.documentId+':'+c.page)))throw new Error('知识单元的原始页面未完整读入，未继续生成');
   return{pages,images};
 }
 window.MMPDFSource={metadata,batches,readUnit};
})();
