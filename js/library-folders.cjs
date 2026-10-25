'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
exports.createStore=({root=process.env.MM_STORAGE_DIR||path.join(__dirname,'../storage/maps')}={})=>{
 const file=path.join(root,'.library.json'),valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
 const title=name=>{if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f<>:"/\\|?*]/.test(name))throw fail('文件夹名称应为1–80字，不含路径或特殊字符');return name.trim();};
 const revision=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 function validate(value){
  if(value.version!==1||!Array.isArray(value.folders)||value.folders.length>2000||!value.placements||typeof value.placements!=='object'||Array.isArray(value.placements))throw fail('导图库归类格式无效',500);
  const seen=new Set();for(const f of value.folders){if(!valid(f.id)||seen.has(f.id)||f.parentId!==null&&!valid(f.parentId))throw fail('文件夹编号无效',500);title(f.name);seen.add(f.id);}
  const names=new Set();for(const f of value.folders){let at=f,visited=new Set();while(at){if(visited.has(at.id)||visited.size>=16)throw fail('不能把文件夹移到自己或自己的子文件夹中，层级最多16级');visited.add(at.id);if(at.parentId&&!seen.has(at.parentId))throw fail('文件夹父级不存在',500);at=value.folders.find(p=>p.id===at.parentId);}const key=(f.parentId||'root')+'::'+f.name.toLowerCase();if(names.has(key))throw fail('同一层级已有同名文件夹');names.add(key);}
  return{version:1,folders:value.folders.map(f=>({id:f.id,name:f.name,parentId:f.parentId})),placements:Object.fromEntries(Object.entries(value.placements).filter(([id,f])=>valid(id)&&seen.has(f)))};
 }
 function load(){let value={version:1,folders:[],placements:{}};try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw fail('导图库归类文件无法读取，请先保留并检查原文件',500);}return validate(value);}
 function read(){const value=load();return{...value,revision:revision(value)};}
 function replace(value,expected){const before=read();if(expected!==before.revision)throw fail('导图库已被其他窗口修改，请刷新后重试',409);value=validate(value);fs.mkdirSync(root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2),'utf8');fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw fail('导图库归类保存失败，原文件已保留',500);}return{...value,revision:revision(value)};}
 function selection(input,mapIds){
  if(!input||!Array.isArray(input.mapIds)||!Array.isArray(input.folderIds)||input.mapIds.length>10000||input.folderIds.length>2000||input.mapIds.some(id=>!valid(id)||!mapIds.has(id))||input.folderIds.some(id=>!valid(id)))throw fail('所选导图或文件夹不存在，请刷新后重试');
  const value=read(),chosen=new Set(input.folderIds),all=new Set(value.folders.map(f=>f.id));if([...chosen].some(id=>!all.has(id)))throw fail('所选文件夹不存在');
  for(let i=0;i<16;i++)for(const f of value.folders)if(chosen.has(f.parentId))chosen.add(f.id);
  const maps=new Set(input.mapIds);for(const id of mapIds)if(chosen.has(value.placements[id]))maps.add(id);
  const roots=value.folders.filter(f=>chosen.has(f.id)&&!chosen.has(f.parentId));
  return{value,folderIds:[...chosen],mapIds:[...maps],roots};
 }
 function update(input,mapIds){const value=load();if(input?.revision!==revision(value))throw fail('导图库已被其他窗口修改，请刷新后重试',409);
  const folder=id=>{const found=value.folders.find(f=>f.id===id);if(!found)throw fail('文件夹不存在');return found;},parent=id=>{if(id!==null)folder(id);return id;};let created=null;
  if(input.op==='createFolder'){if(value.folders.length>=2000)throw fail('文件夹数量已达到上限');created={id:randomUUID(),name:title(input.name),parentId:parent(input.parentId??null)};value.folders.push(created);}
  else if(input.op==='renameFolder')folder(input.id).name=title(input.name);
  else if(input.op==='moveFolder')folder(input.id).parentId=parent(input.parentId??null);
  else if(input.op==='deleteFolder')throw fail('删除文件夹须连同内容移入回收站，请刷新页面后重试');
  else if(input.op==='moveMaps'){if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>10000||input.ids.some(id=>!valid(id)||!mapIds.has(id)))throw fail('待移动的导图不存在或数量无效');const destination=parent(input.folderId??null);for(const id of input.ids)if(destination)value.placements[id]=destination;else delete value.placements[id];}
  else if(input.op==='moveSelection'){
   const picked=selection(input.selection,mapIds),destination=parent(input.folderId??null),covered=new Set(picked.folderIds);if(!picked.mapIds.length&&!covered.size)throw fail('请选择要移动的内容');if(covered.has(destination))throw fail('不能把文件夹移到自己或自己的子文件夹中');
   for(const f of picked.roots)folder(f.id).parentId=destination;
   for(const id of picked.mapIds)if(!covered.has(value.placements[id])){if(destination)value.placements[id]=destination;else delete value.placements[id];}
  }else throw fail('未知的导图库操作');
  const result=replace(value,input.revision);return{...result,...(created?{created}:{})};
 }
 return{read,update,replace,validate,revision,selection};
};
