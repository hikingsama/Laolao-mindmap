'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
let library;
async function load(){
 if(!library){const canvas=require('@napi-rs/canvas');for(const name of ['DOMMatrix','ImageData','Path2D'])globalThis[name] ||= canvas[name];
  if(!Map.prototype.getOrInsertComputed)Object.defineProperty(Map.prototype,'getOrInsertComputed',{value(key,fn){if(!this.has(key))this.set(key,fn(key));return this.get(key);},configurable:true});
  library=import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href).then(lib=>{lib.GlobalWorkerOptions.workerSrc=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;return lib;});
 }return library;
}
async function open(file,signal){
 signal?.throwIfAborted();const lib=await load(),root=path.resolve(__dirname,'../vendor/pdfjs');
 const task=lib.getDocument({data:new Uint8Array(fs.readFileSync(file)),cMapUrl:path.join(root,'cmaps')+'/',cMapPacked:true,standardFontDataUrl:path.join(root,'standard_fonts')+'/',wasmUrl:path.join(root,'wasm')+'/',useSystemFonts:true,disableFontFace:true,isEvalSupported:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,useWorkerFetch:false,enableXfa:false});
 let locked=false;task.onPassword=()=>{locked=true;task.destroy().catch(()=>{});};const abort=()=>task.destroy().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 try{return{lib,doc:await task.promise,close:async()=>{signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}};}catch(e){signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});signal?.throwIfAborted();throw Error(locked?'PDF已加密，请先解除密码':'PDF读取失败：'+e.message);}
}
async function metadata(file,signal){const pdf=await open(file,signal);try{return pdf.doc.numPages;}finally{await pdf.close();}}
async function* batches(document,file,{signal,reading='auto',selection,onPage=()=>{}}){
 const pdf=await open(file,signal);let pages=[],images=[],chars=0,render;const abort=()=>render?.cancel();signal.addEventListener('abort',abort,{once:true});
 try{for(let number=1;number<=pdf.doc.numPages;number++){
  if(selection&&!selection.has(number))continue;signal.throwIfAborted();onPage(number,pdf.doc.numPages);
  const page=await pdf.doc.getPage(number),content=await page.getTextContent(),text=content.items.map(t=>t.str+(t.hasEOL?'\n':' ')).join('');let visual=reading==='visual'||text.trim().length<35;
  if(reading==='auto'&&!visual){const ops=await page.getOperatorList();visual=ops.fnArray.some(op=>['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','constructPath'].some(name=>pdf.lib.OPS[name]===op));}
  if(reading==='text'){visual=false;if(!text.trim())throw Error('第'+number+'页没有可提取文字，请使用自动识别或图文理解');}
  let image;if(visual){const unit=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.7,1600/Math.max(unit.width,unit.height))}),canvas=require('@napi-rs/canvas').createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
   try{render=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)',annotationMode:0,useRequestAnimationFrame:false});await render.promise;signal.throwIfAborted();let dataUrl;for(const quality of [.85,.65,.45]){dataUrl=canvas.toDataURL('image/jpeg',quality);if(dataUrl.length<=2*1024*1024)break;}if(dataUrl.length>2*1024*1024)throw Error('页面图像过大');image={documentId:document.id,page:number,dataUrl};}
   finally{render=null;canvas.width=canvas.height=1;}
  }
  const parts=Math.max(1,Math.ceil(text.length/12000));for(let part=1;part<=parts;part++){const value=text.slice((part-1)*12000,part*12000);if(pages.length&&(chars+value.length>18000||pages.length>=4||images.length>=3)){yield{pages,images};pages=[];images=[];chars=0;signal.throwIfAborted();}pages.push({documentId:document.id,page:number,text:value,part,parts,visual});chars+=value.length;if(image&&!images.some(i=>i.page===number))images.push(image);}page.cleanup();
 }if(pages.length)yield{pages,images};}finally{signal.removeEventListener('abort',abort);await pdf.close();}
}
async function readUnit(documents,fileFor,refs,options){const pages=[],images=[],seen=new Set();let chars=0;for(const d of documents){const selection=new Set(refs.filter(c=>c.documentId===d.id).map(c=>c.page));if(!selection.size)continue;for await(const b of batches(d,fileFor(d),{...options,selection})){pages.push(...b.pages);chars+=b.pages.reduce((n,p)=>n+p.text.length,0);for(const image of b.images){const key=image.documentId+':'+image.page;if(!seen.has(key)){seen.add(key);images.push(image);}}if(chars>60000||images.length>24)throw Error('完整知识单元超过单次容量，未截断原文');}}if(refs.some(c=>!pages.some(p=>p.documentId===c.documentId&&p.page===c.page)))throw Error('知识单元原文未完整读入');return{pages,images};}
module.exports={metadata,batches,readUnit};
