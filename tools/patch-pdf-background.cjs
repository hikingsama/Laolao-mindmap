'use strict';
// Local PDF.js extension. Preserve display intent/layers and opt out of frame scheduling only for offscreen work.
function patch(source){
 const nl=source.includes('\r\n')?'\r\n':'\n';
 const before=['    recordOperations = false,','    operationsFilter = null','  }) {'].join(nl);
 const after=['    recordOperations = false,','    operationsFilter = null,','    // Local extension for offscreen generation; ordinary readers retain frame scheduling.','    useRequestAnimationFrame = true','  }) {'].join(nl);
 const scheduling='      useRequestAnimationFrame: !intentPrint,',offscreen='      useRequestAnimationFrame: useRequestAnimationFrame && !intentPrint,';
 if(source.includes(after) && source.includes(offscreen))return source;
 const once=(text,old,value)=>{if(text.split(old).length!==2)throw Error('PDF.js offscreen patch does not match this version; review before updating assets');return text.replace(old,value);};
 return once(once(source,before,after),scheduling,offscreen);
}
function apply(project){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),root=path.join(project,'vendor/pdfjs'),file=path.join(root,'build/pdf.mjs'),bytes=Buffer.from(patch(fs.readFileSync(file,'utf8')),'utf8');
 fs.writeFileSync(file,bytes);
 const manifestPath=path.join(root,'assets.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),entry=manifest.files.find(f=>f.path==='build/pdf.mjs');if(!entry)throw Error('PDF.js asset manifest is missing build/pdf.mjs');
 entry.bytes=bytes.length;entry.sha256=crypto.createHash('sha256').update(bytes).digest('hex');manifest.bytes=manifest.files.reduce((n,f)=>n+f.bytes,0);manifest.patches=[...new Set([...(manifest.patches || []),'offscreen-render-scheduling-v1'])];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
module.exports={patch,apply};
if(require.main===module){apply(require('node:path').resolve(__dirname,'..'));console.log('Applied offscreen PDF.js scheduling extension and refreshed asset integrity.');}
