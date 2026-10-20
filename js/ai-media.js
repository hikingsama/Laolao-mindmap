(function(root){
  "use strict";
  function parsePages(raw,total){
    const pages=new Set();
    if(!Number.isSafeInteger(total) || total<1)throw new Error("无法确定PDF页数");
    if(raw==null || raw==='')return Array.from({length:total},(_,i)=>i+1);
    if(typeof raw!=="string" || raw.length>10000)throw new Error("PDF页码格式不正确");
    for(const part of raw.replace(/，|、/g,",").split(",")){
      const match=/^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
      if(!match)throw new Error("PDF页码格式不正确，例如1,3-4");
      const a=Number(match[1]),b=Number(match[2] || match[1]);
      if(!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a<1 || b<a || b>total)throw new Error("PDF页码超出范围或顺序不正确（共"+total+"页）");
      for(let n=a;n<=b;n++)pages.add(n);
    }
    return [...pages].sort((a,b)=>a-b);
  }
  // Only explicit page references narrow the document; question/chapter numbers do not.
  function pageSpec(question=''){
    if(/全文|全[部文]页面|全部页|所有页|整[份个本](?:PDF|pdf|文档|文件)|whole\s+(?:PDF|document)|all\s+pages/i.test(question))return '';
    const number='[0-9零〇一二两三四五六七八九十百千]+';
    const numeric=value=>{
      if(/^\d+$/.test(value))return value;
      const digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9},units={十:10,百:100,千:1000};let sum=0,current=0;
      for(const c of value){if(c in units){sum+=(current || 1)*units[c];current=0;}else current=digits[c];}return String(sum+current);
    };
    const normalized=question.replace(new RegExp(number,'g'),numeric),parts=[];
    const prefix='(?:第\\s*|(?:只看|只读|仅看|仅读|查看|阅读|分析|解释|参考|参照|看|读|页码[:：]?)\\s*第?\\s*)';
    const range=new RegExp(prefix+'(\\d+)\\s*页\\s*(?:到|至|[-–—~～])\\s*第?\\s*(\\d+)\\s*页','g');
    let remaining=normalized.replace(range,(_,a,b)=>{parts.push(a+'-'+b);return ' ';});
    for(const m of remaining.matchAll(new RegExp(prefix+'(\\d+(?:\\s*[-–—~～到至、,，和及]\\s*第?\\s*\\d+)*)\\s*页','g')))parts.push(m[1].replace(/第|\s/g,'').replace(/[–—~～到至]/g,'-').replace(/[、，和及]/g,','));
    for(const m of remaining.matchAll(/\bpages?\s+(\d+(?:\s*[-–,]\s*\d+)*)/gi))parts.push(m[1].replace(/\s/g,'').replace(/–/g,'-'));
    return parts.join(',');
  }
  function canvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
  function encode(c){
    for(const quality of [.9,.75,.55]){const value=c.toDataURL("image/jpeg",quality);if(value.length<=2*1024*1024)return value;}
    throw new Error("图片内容过大，请选择更小的图片或PDF页面");
  }
  async function prepare(media,signal,progress=()=>{}){
    if(!media)return null;
    signal.throwIfAborted();
    const url="/api/maps/"+encodeURIComponent(media.mapId)+"/media/"+encodeURIComponent(media.id)+"?draft=1";
    const r=await fetch(url,{signal});if(!r.ok)throw new Error("无法读取附件，请确认文件仍在当前导图中");
    const blob=await r.blob();signal.throwIfAborted();
    if(media.kind==="image"){
      if(blob.size>20*1024*1024)throw new Error("图片超过20MB");
      progress("正在准备图片…");let bitmap;
      try{
        bitmap=await createImageBitmap(blob);signal.throwIfAborted();
        const scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),c=canvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale))),ctx=c.getContext("2d");
        ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0,c.width,c.height);
        return {kind:"image",name:media.name,images:[{dataUrl:encode(c)}]};
      }catch(e){if(signal.aborted)throw signal.reason;if(e.message.includes("过大"))throw e;throw new Error("图片无法解码，请更换PNG、JPEG或WebP图片");}finally{bitmap?.close();}
    }
    if(blob.size>50*1024*1024)throw new Error("PDF超过50MB");
    progress("正在读取PDF…");
    const lib=await import("/vendor/pdfjs/build/pdf.mjs");signal.throwIfAborted();
    lib.GlobalWorkerOptions.workerSrc="/vendor/pdfjs/build/pdf.worker.mjs";
    const task=lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),cMapUrl:"/vendor/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/vendor/pdfjs/standard_fonts/",wasmUrl:"/vendor/pdfjs/wasm/",isEvalSupported:false,enableXfa:false});
    let renderTask;
    const abort=()=>{renderTask?.cancel();task.destroy().catch(()=>{});};
    task.onPassword=()=>task.destroy().catch(()=>{});
    signal.addEventListener("abort",abort,{once:true});
    try{
      signal.throwIfAborted();const doc=await task.promise,pages=parsePages(media.pages ?? pageSpec(media.question),doc.numPages),images=[],texts=[];
      for(const n of pages){
        signal.throwIfAborted();progress("正在准备PDF · "+(images.length+1)+"/"+pages.length+" 页…");
        const page=await doc.getPage(n),unit=page.getViewport({scale:1}),scale=Math.min(2,2000/Math.max(unit.width,unit.height)),viewport=page.getViewport({scale}),c=canvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        renderTask=page.render({canvas:c,canvasContext:c.getContext("2d"),viewport,background:"rgb(255,255,255)",annotationMode:0});await renderTask.promise;renderTask=null;signal.throwIfAborted();
        images.push({page:n,dataUrl:encode(c)});
        try{const content=await page.getTextContent();texts.push("第"+n+"页：\n"+content.items.map(t=>t.str+(t.hasEOL?"\n":" ")).join(""));}catch{signal.throwIfAborted();}
        page.cleanup();c.width=c.height=1;
      }
      return {kind:"pdf",name:media.name,images,text:texts.join("\n\n"),pageCount:doc.numPages,allPages:pages.length===doc.numPages};
    }catch(e){if(signal.aborted)throw signal.reason;if(/页码|最多|过大/.test(e.message))throw e;throw new Error("PDF无法读取或已加密，请使用可正常打开的PDF");}
    finally{signal.removeEventListener("abort",abort);await task.destroy().catch(()=>{});}
  }
  const api={parsePages,pageSpec,prepare};
  if(typeof module==="object" && module.exports)module.exports=api;else root.MMAIMedia=api;
})(typeof window==="object"?window:globalThis);
