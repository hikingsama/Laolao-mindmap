"use strict";
// A committed document is immutable during editing. Media changes live in .draft.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const assets=require('./media-utils.cjs');
module.exports=h=>{
  const dir=id=>path.join(h.folder(id),'.draft'),file=(id,name)=>path.join(dir(id),name);
  const hash=m=>createHash('sha256').update(JSON.stringify(m)).digest('hex');
  const formal=id=>h.read(path.join(h.folder(id),'map.json'),null);
  const publicItem=(item,id)=>({id:item.id,name:item.name,mime:item.mime,bytes:item.bytes,sourceMap:id,...(item.width?{width:item.width,height:item.height}:{})});
  const safeName=name=>typeof name==='string' && name.length<=255 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.startsWith('.') && !/[. ]$/.test(name) && /\.(png|jpe?g|gif|webp|pdf)$/i.test(name);
  function child(id,relative){const root=path.resolve(h.folder(id)),p=path.resolve(root,relative);if(!p.startsWith(root+path.sep))throw new Error('文件路径无效');return p;}
  function clear(id){const p=path.resolve(dir(id));if(path.dirname(p)!==path.resolve(h.folder(id)))throw new Error('草稿路径无效');fs.rmSync(p,{recursive:true,force:true});}
  function recover(id){
    const journal=h.read(file(id,'journal.json'),null);if(!journal)return;
    if(journal.done){clear(id);return;}
    for(const relative of journal.outputs){const p=child(id,relative);if(fs.existsSync(p))fs.unlinkSync(p);}
    for(const entry of journal.originals){const dest=child(id,entry.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(child(id,entry.backup),dest);}
    h.write(path.join(h.folder(id),'map.json'),journal.map);h.write(path.join(h.folder(id),'.media.json'),journal.media);
    fs.unlinkSync(file(id,'journal.json'));
  }
  function metadata(id){recover(id);return h.read(file(id,'meta.json'),null);}
  function initialItems(id){return Object.fromEntries(Object.values(h.discoverMedia(id)).map(item=>[item.id,{...item,_file:path.relative(h.folder(id),h.assetPath(id,item)),_staged:false}]));}
  function ensure(id,base){
    let meta=metadata(id);if(meta)return meta;
    if(!formal(id)){if(!base)throw new Error('找不到正式导图');h.saveMap(id,base);}
    const map=formal(id);meta={token:randomUUID(),baseHash:hash(map),updated:Date.now()};
    h.write(file(id,'media.json'),initialItems(id));h.write(file(id,'meta.json'),meta);return meta;
  }
  function check(id,token){const meta=metadata(id);if(!meta || !token || token!==meta.token){const e=new Error('编辑草稿已变更，请重新打开导图后重试');e.status=409;throw e;}return meta;}
  function items(id){return h.read(file(id,'media.json'),{});}
  function physical(id,item){return child(id,item._staged?path.join('.draft','assets',item._file):item._file);}
  function source(id,mediaId){
    if(!h.validId(id))return null;metadata(id);const staged=items(id)[mediaId];if(staged && fs.existsSync(physical(id,staged)))return {item:publicItem(staged,id),path:physical(id,staged)};
    const item=h.manifest(id)[mediaId];return item && fs.existsSync(h.assetPath(id,item))?{item,path:h.assetPath(id,item)}:null;
  }
  function uniqueName(list,name,id){
    const used=new Set(Object.values(list).filter(f=>f.id!==id && !f.trashed).map(f=>f.name.toLowerCase()));let next=name,n=1;const ext=path.extname(name),base=name.slice(0,-ext.length);
    while(used.has(next.toLowerCase()))next=base+'_'+(n++)+ext;return next;
  }
  function save(id,map,token){
    const meta=check(id,token);if(map.id!==id || !Array.isArray(map.nodes))throw new Error('导图格式不正确');const list=items(id);
    for(const media of map.media || []){
      if(!h.validId(media.id))throw new Error('图片编号无效');let item=list[media.id];
      if(!item){const origin=source(media.sourceMap,media.id);if(!origin)throw new Error('找不到图片文件：'+(media.name || media.id));
        const ext=path.extname(origin.item.name),physicalName=media.id+ext;fs.mkdirSync(file(id,'assets'),{recursive:true});fs.copyFileSync(origin.path,file(id,path.join('assets',physicalName)));
        item=list[media.id]={...origin.item,name:uniqueName(list,origin.item.name,media.id),_file:physicalName,_staged:true,trashed:false};
      }
      if(safeName(media.name))item.name=uniqueName(list,media.name,item.id);
      item.trashed=false;Object.assign(media,publicItem(item,id));
    }
    h.write(file(id,'media.json'),list);h.write(file(id,'map.json'),map);meta.updated=Date.now();h.write(file(id,'meta.json'),meta);
  }
  function mediaChanged(id,list){const original=h.manifest(id);return Object.values(list).some(item=>{const old=original[item.id];return item._staged || !old || old.name!==item.name || !!old.trashed!==!!item.trashed;});}
  function info(id){
    const meta=metadata(id),base=formal(id),draft=h.read(file(id,'map.json'),null),list=items(id);
    return {base,draft,token:meta?.token,updated:meta?.updated,recoverable:!!draft && (hash(draft)!==hash(base) || mediaChanged(id,list))};
  }
  function discard(id,token){check(id,token);clear(id);return formal(id);}
  function commit(id,token){
    const meta=check(id,token),base=formal(id),draft=h.read(file(id,'map.json'),null),list=items(id);
    if(hash(base)!==meta.baseHash){const e=new Error('正式导图已被其他编辑修改，草稿已保留；请重新打开核对后保存');e.status=409;throw e;}
    if(!mediaChanged(id,list) && (!draft || hash(draft)===hash(base)))return {map:base,token:meta.token,unchanged:true};
    const map=draft || base,old=h.manifest(id),originals=[],outputs=[],names=new Set(),ready=[];
    for(const item of Object.values(old)){
      const src=h.assetPath(id,item);if(!fs.existsSync(src))continue;const relative=path.relative(h.folder(id),src),backup=path.join('.draft','backup',randomUUID());
      fs.mkdirSync(file(id,'backup'),{recursive:true});fs.copyFileSync(src,child(id,backup));originals.push({relative,backup});
    }
    for(const item of Object.values(list)){
      if(!safeName(item.name))throw new Error('图片名称无效');
      const relative=item.trashed?path.join('.trash',item.id+'-'+item.name):item.name;if(names.has(relative.toLowerCase()))throw new Error('存在同名图片，请先修改名称');names.add(relative.toLowerCase());
      const dest=child(id,relative);if(fs.existsSync(dest)&&!originals.some(o=>o.relative===relative))throw new Error('文件夹已有同名文件，未覆盖：'+item.name);
      const staged=file(id,path.join('ready',item.id));fs.mkdirSync(path.dirname(staged),{recursive:true});fs.copyFileSync(physical(id,item),staged);ready.push({relative,staged});outputs.push(relative);
    }
    const journal={map:formal(id),media:old,originals,outputs,done:false};h.write(file(id,'journal.json'),journal);
    try{
      for(const entry of originals)fs.unlinkSync(child(id,entry.relative));
      for(const entry of ready){const dest=child(id,entry.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(entry.staged,dest);}
      const result=Object.fromEntries(Object.values(list).map(item=>[item.id,{...publicItem(item,id),...(item.trashed?{trashed:true}:{})}]));
      map.media=Object.values(list).filter(item=>!item.trashed).map(item=>publicItem(item,id));
      h.write(path.join(h.folder(id),'.media.json'),result);h.write(path.join(h.folder(id),'map.json'),map);
      journal.done=true;h.write(file(id,'journal.json'),journal);
    }catch(e){recover(id);throw e;}
    clear(id);const next=ensure(id);return {map,token:next.token};
  }
  async function handle(req,res,id,parts){
    const token=req.headers['x-mm-draft-token'];
    if(parts[3]==='draft'){
      if(req.method==='POST'){const data=JSON.parse((await h.body(req,8*1024*1024)).toString());ensure(id,data.base);return h.json(res,200,info(id));}
      if(req.method==='GET')return h.json(res,200,info(id));
      if(req.method==='PUT'){save(id,JSON.parse((await h.body(req,8*1024*1024)).toString()),token);return h.json(res,200,{saved:true});}
      if(req.method==='DELETE')return h.json(res,200,{map:discard(id,token)});
    }
    if(parts[3]==='commit' && req.method==='POST')return h.json(res,200,commit(id,token));
    return h.json(res,405,{error:'不支持此草稿操作'});
  }
  async function media(req,res,id,mediaId){
    ensure(id);if(req.method!=='GET')check(id,req.headers['x-mm-draft-token']);const list=items(id);
    if(!mediaId){
      if(req.method==='GET'){
        for(const item of Object.values(h.discoverMedia(id)))if(!list[item.id])list[item.id]={...item,_file:path.relative(h.folder(id),h.assetPath(id,item)),_staged:false};
        h.write(file(id,'media.json'),list);return h.json(res,200,{files:Object.values(list).filter(i=>!i.trashed).map(i=>publicItem(i,id))});
      }
      if(req.method==='POST'){
        const bytes=await h.body(req,assets.limit),[ext,mime]=h.sniff(bytes),d=new Date(),stamp=[d.getFullYear()%100,d.getMonth()+1,d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join('');assets.validate(bytes.length,mime);
        const name=ext==='pdf'?assets.pdfName(req,'文档'+stamp+'.pdf'):'图片'+stamp+'.'+ext;
        const item={id:randomUUID(),name:uniqueName(list,name),mime,bytes:bytes.length,sourceMap:id,_staged:true};item._file=item.id+'.'+ext;
        fs.mkdirSync(file(id,'assets'),{recursive:true});fs.writeFileSync(file(id,path.join('assets',item._file)),bytes,{flag:'wx'});list[item.id]=item;h.write(file(id,'media.json'),list);return h.json(res,201,publicItem(item,id));
      }
    }
    if(!h.validId(mediaId))throw new Error('图片编号无效');const item=list[mediaId];if(!item)return h.json(res,404,{error:'图片不存在'});
    if(req.method==='GET')return assets.serve(req,res,physical(id,item),item);
    if(req.method==='DELETE'){item.trashed=true;h.write(file(id,'media.json'),list);return h.json(res,200,{removed:true});}
    if(req.method==='PATCH'){
      const data=JSON.parse((await h.body(req,4096)).toString()),ext=path.extname(item.name),name=String(data.name || '').trim(),next=name.toLowerCase().endsWith(ext.toLowerCase())?name:name+ext;
      if(!safeName(next))throw new Error('图片名称无效');if(Object.values(list).some(i=>i.id!==item.id&&!i.trashed&&i.name.toLowerCase()===next.toLowerCase()))throw new Error('已有同名图片');
      item.name=next;h.write(file(id,'media.json'),list);return h.json(res,200,publicItem(item,id));
    }
    return h.json(res,405,{error:'不支持此文件操作'});
  }
  function rename(id,title,expected){
    const data=info(id);
    if(!data.base){const e=new Error('找不到本地导图');e.status=404;throw e;}
    if(!expected || hash(data.base)!==expected){const e=new Error('导图文件已更新，请刷新列表后重试');e.status=409;throw e;}
    if(data.recoverable){const e=new Error('此导图有未保存草稿，请先打开并保存或放弃草稿，再改名');e.status=409;throw e;}
    const map={...data.base,title};h.write(path.join(h.folder(id),'map.json'),map);
    clear(id);return map;
  }
  return {handle,media,source,recover,info,rename,hash};
};
