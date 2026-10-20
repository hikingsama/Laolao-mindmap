const fs=require('node:fs');
exports.limit=50*1024*1024;
exports.validate=(bytes,mime)=>{if(bytes>(mime==='application/pdf'?exports.limit:20*1024*1024))throw Error(mime==='application/pdf'?'PDF最多50MB':'图片最多20MB');};
exports.pdfName=(req,fallback)=>{let name;try{name=decodeURIComponent(req.headers['x-mm-file-name'] || '');}catch{}return typeof name==='string' && name.length<=120 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.startsWith('.') && /\.pdf$/i.test(name)?name:fallback;};
exports.serve=(req,res,file,item)=>{
  const total=fs.statSync(file).size,headers={'Content-Type':item.mime,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(item.name)};
  let start=0,end=total-1,code=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(match && (match[1]||match[2])){
    if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}else start=Math.max(0,total-Number(match[2]));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=total){res.writeHead(416,{...headers,'Content-Range':'bytes */'+total});return res.end();}
    code=206;headers['Content-Range']=`bytes ${start}-${end}/${total}`;
  }else{res.writeHead(416,{...headers,'Content-Range':'bytes */'+total});return res.end();}}
  res.writeHead(code,{...headers,'Content-Length':end-start+1});const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
};
