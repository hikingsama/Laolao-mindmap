"use strict";
// Local documents and their image files share one directory. No runtime dependencies.
const fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
const assets=require('./media-utils.cjs');
const ROOT = path.resolve(process.env.MM_STORAGE_DIR || path.join(__dirname,"../storage/maps"));
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const folder = id => { if(!validId(id)) throw new Error("导图或媒体编号无效"); return path.join(ROOT,id); };
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch(error) { if(error.code === "ENOENT") return fallback; throw error; } }
function write(file, data) { fs.mkdirSync(path.dirname(file),{recursive:true}); const temp=file+"."+randomUUID()+".tmp"; fs.writeFileSync(temp,JSON.stringify(data,null,2)); fs.renameSync(temp,file); }
function manifest(id) {
  const dir=folder(id), stored=read(path.join(dir,".media.json"),null);if(stored)return stored;
  const out={}, map=read(path.join(dir,"map.json"),{});
  // map.json + image files alone remain portable; the private index can be rebuilt.
  for(const media of map.media || []) {
    if(!validId(media.id) || typeof media.name!=="string" || !/^[^/\\:\x00-\x1f]+\.(png|jpe?g|gif|webp|pdf)$/i.test(media.name) || media.name.startsWith("."))continue;
    const file=path.join(dir,media.name);if(!fs.existsSync(file))continue;
    const ext=path.extname(file).toLowerCase(),mime=ext==='.pdf'?'application/pdf':ext===".jpg" || ext===".jpeg"?"image/jpeg":"image/"+ext.slice(1);
    out[media.id]={...media,mime,sourceMap:id,bytes:fs.statSync(file).size};
  }
  return out;
}
const assetPath = (id,item) => path.join(folder(id),item.trashed ? ".trash" : "", item.trashed ? item.id+"-"+item.name : item.name);
function sniff(data) {
  if(data.subarray(0,5).toString()==='%PDF-')return ['pdf','application/pdf'];
  if(data.length>=8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ["png","image/png"];
  if(data.length>=3 && data[0]===255 && data[1]===216 && data[2]===255) return ["jpg","image/jpeg"];
  if(/^GIF8[79]a/.test(data.subarray(0,6).toString())) return ["gif","image/gif"];
  if(data.subarray(0,4).toString()==="RIFF" && data.subarray(8,12).toString()==="WEBP") return ["webp","image/webp"];
  throw new Error("支持 PNG、JPEG、GIF、WebP 图片和 PDF");
}
// Discover images copied into this map's folder outside the app as unused assets.
function discoverMedia(id) {
  const dir=folder(id),items=manifest(id);if(!fs.existsSync(dir))return items;
  const known=new Set(Object.values(items).filter(item=>!item.trashed).map(item=>item.name));let changed=false;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const name=entry.name;
    if(!entry.isFile() || name.startsWith('.') || known.has(name) || !/\.(png|jpe?g|gif|webp|pdf)$/i.test(name))continue;
    const file=path.join(dir,name),bytes=fs.statSync(file).size;if(bytes>assets.limit)continue;
    let fd;try {
      fd=fs.openSync(file,'r');const header=Buffer.alloc(12),length=fs.readSync(fd,header,0,12,0),[,mime]=sniff(header.subarray(0,length));
      assets.validate(bytes,mime);
      const media={id:randomUUID(),name,mime,bytes,sourceMap:id};items[media.id]=media;known.add(name);changed=true;
    }catch{}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  if(changed)write(path.join(dir,'.media.json'),items);return items;
}
async function body(req,max) { const parts=[]; let size=0; for await(const part of req) {size+=part.length;if(size>max)throw new Error("文件过大：图片最多20MB、PDF最多50MB、导图最多8MB");parts.push(part);} return Buffer.concat(parts); }
function json(res,code,data) { res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data)); }
function restore(id,item) { if(!item.trashed) return; const old=assetPath(id,item); item.trashed=false; const dest=assetPath(id,item); if(fs.existsSync(dest)) throw new Error("同名图片已存在，请先重命名"); fs.renameSync(old,dest); }
function saveMap(id,map) {
  if(map.id!==id || !Array.isArray(map.nodes)) throw new Error("导图格式不正确");
  const dest=folder(id); fs.mkdirSync(dest,{recursive:true}); const items=manifest(id);
  for(const media of map.media || []) {
    if(!validId(media.id)) throw new Error("图片编号无效");
    let item=items[media.id];
    if(!item && validId(media.sourceMap) && media.sourceMap!==id) {
      const original=drafts.source(media.sourceMap,media.id);
      if(original) { item={...original.item,sourceMap:id,trashed:false}; if(fs.existsSync(path.join(dest,item.name))) item.name=media.id+"-"+item.name; fs.copyFileSync(original.path,path.join(dest,item.name));items[item.id]=item; }
    }
    if(item) { restore(id,item); media.name=item.name;media.mime=item.mime;media.sourceMap=id; }
  }
  write(path.join(dest,".media.json"),items);write(path.join(dest,"map.json"),map);
}
const drafts=require('./draft-files.cjs')({validId,folder,read,write,sniff,manifest,discoverMedia,assetPath,json,body,saveMap});
exports.handle = async (req,res,port) => {
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host) || (req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))) return json(res,403,{error:"仅允许本机页面访问"});
  try {
    const url = new URL(req.url,"http://local"), parts=url.pathname.split("/").filter(Boolean).map(decodeURIComponent), id=parts[2];
    if(parts.length===2 && req.method==="GET") {
      const maps=fs.existsSync(ROOT)?fs.readdirSync(ROOT,{withFileTypes:true}).filter(e=>e.isDirectory() && validId(e.name)).flatMap(e=>{drafts.recover(e.name);const file=path.join(folder(e.name),"map.json"),m=read(file,null);if(m && m.id!==e.name)throw new Error('导图编号与文件夹不一致：'+e.name);return m?[{id:m.id,title:m.title,updated:fs.statSync(file).mtimeMs}]:[];}):[];
      return json(res,200,{maps});
    }
    if(!validId(id)) return json(res,400,{error:"导图编号无效"});
    if(parts.length===4 && ['draft','commit'].includes(parts[3]))return await drafts.handle(req,res,id,parts);
    drafts.recover(id);
    if(parts.length===3) {
      if(req.method==="PATCH") {
        const data=JSON.parse((await body(req,4096)).toString()),title=typeof data.title==='string'?data.title.trim():'';
        if(!title || title.length>80)throw new Error('请输入 1–80 字的导图名称');
        const map=drafts.rename(id,title,req.headers['if-match']);return json(res,200,{map});
      }
      if(req.method==="DELETE") {
        const map=read(path.join(folder(id),'map.json'),null);
        if(map && (!req.headers['if-match'] || drafts.hash(map)!==req.headers['if-match']))return json(res,409,{error:'导图文件已更新，请刷新列表后重试'});
        const source=path.resolve(folder(id)),trash=path.resolve(ROOT,'.trash'),destination=path.resolve(trash,id+'-'+randomUUID());
        if(path.dirname(source)!==ROOT || path.dirname(destination)!==trash)throw new Error('导图路径无效');
        if(fs.existsSync(source)){fs.mkdirSync(trash,{recursive:true});fs.renameSync(source,destination);}
        return json(res,200,{removed:true});
      }
      if(req.method==="PUT") {saveMap(id,JSON.parse((await body(req,8*1024*1024)).toString()));return json(res,200,{saved:true,folder:`storage/maps/${id}/`});}
      if(req.method==="GET") {const m=read(path.join(folder(id),"map.json"),null);return json(res,m?200:404,m||{error:"找不到本地导图"});}
    }
    if(parts[3]!=="media") return json(res,404,{error:"文件接口不存在"});
    const mediaId=parts[4];
    if(url.searchParams.get('draft')==='1')return await drafts.media(req,res,id,mediaId);
    if(parts.length===4) {
      if(req.method==="GET") return json(res,200,{files:Object.values(discoverMedia(id)).filter(m=>!m.trashed).map(m=>({...m,sourceMap:id}))});
      if(req.method==="POST") {
        const data=await body(req,assets.limit), [ext,mime]=sniff(data), date=new Date();assets.validate(data.length,mime);
        const stamp=[date.getFullYear()%100,date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,"0")).join("");
        const dir=folder(id);fs.mkdirSync(dir,{recursive:true});const initial=ext==='pdf'?assets.pdfName(req,`文档${stamp}.pdf`):`图片${stamp}.${ext}`;let name=initial, serial=1;
        while(fs.existsSync(path.join(dir,name))) name=initial.slice(0,-ext.length-1)+`_${serial++}.${ext}`;
        fs.writeFileSync(path.join(dir,name),data,{flag:"wx"});
        const item={id:randomUUID(),name,mime,bytes:data.length,sourceMap:id}, items=manifest(id);items[item.id]=item;write(path.join(dir,".media.json"),items);return json(res,201,item);
      }
    }
    if(!validId(mediaId)) return json(res,400,{error:"图片编号无效"});
    const items=manifest(id), item=items[mediaId];if(!item)return json(res,404,{error:"图片不存在"});
    if(req.method==="GET")return assets.serve(req,res,assetPath(id,item),item);
    if(req.method==="PATCH") {
      const data=JSON.parse((await body(req,4096)).toString()), ext=path.extname(item.name), base=String(data.name||"").trim().replace(new RegExp(ext.replace(".","\\.")+"$","i"),"");
      if(!base || base.length>100 || /[<>:"/\\|?*\x00-\x1f]/.test(base) || base.startsWith(".") || /[. ]$/.test(base)) throw new Error("名称不能为空，也不能含路径符号或末尾句点");
      const next=base+ext;if(next!==item.name) {const old=assetPath(id,item), dest=path.join(folder(id),next);if(fs.existsSync(dest))throw new Error("已有同名图片");fs.renameSync(old,dest);item.name=next;item.trashed=false;}
      write(path.join(folder(id),".media.json"),items);return json(res,200,item);
    }
    if(req.method==="DELETE") {if(!item.trashed) {const old=assetPath(id,item);item.trashed=true;fs.mkdirSync(path.join(folder(id),".trash"),{recursive:true});fs.renameSync(old,assetPath(id,item));write(path.join(folder(id),".media.json"),items);}return json(res,200,{removed:true});}
    return json(res,405,{error:"不支持此文件操作"});
  } catch(error) { if(!res.headersSent) json(res,error.status || 400,{error:error.code==="ENOENT"?"文件不存在":error.message});else res.destroy(); }
};
