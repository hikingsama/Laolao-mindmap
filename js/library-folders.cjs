'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
exports.createStore=({root=process.env.MM_STORAGE_DIR||path.join(__dirname,'../storage/maps')}={})=>{
 const file=path.join(root,'.library.json'),valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
 const title=name=>{if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f<>:"/\\|?*]/.test(name))throw fail('文件夹名称应为1–80字，不含路径或特殊字符');return name.trim();};
 function load(){let value={version:1,folders:[],placements:{}};try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw fail('导图库归类文件无法读取，请先保留并检查原文件',500);}
  if(value.version!==1||!Array.isArray(value.folders)||value.folders.length>2000||!value.placements||typeof value.placements!=='object'||Array.isArray(value.placements))throw fail('导图库归类格式无效',500);
  const seen=new Set();for(const f of value.folders){if(!valid(f.id)||seen.has(f.id)||f.parentId!==null&&!valid(f.parentId))throw fail('文件夹编号无效',500);title(f.name);seen.add(f.id);}
  for(const f of value.folders){let at=f,visited=new Set();while(at){if(visited.has(at.id)||visited.size>16)throw fail('文件夹层级无效',500);visited.add(at.id);if(at.parentId&&!seen.has(at.parentId))throw fail('文件夹父级不存在',500);at=value.folders.find(p=>p.id===at.parentId);}}
  const placements=Object.fromEntries(Object.entries(value.placements).filter(([id,folder])=>valid(id)&&seen.has(folder)));return{version:1,folders:value.folders.map(f=>({id:f.id,name:f.name,parentId:f.parentId})),placements};
 }
 const revision=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 function read(){const value=load();return{...value,revision:revision(value)};}
 function update(input,mapIds){const value=load();if(input?.revision!==revision(value))throw fail('导图库已被其他窗口修改，请刷新后重试',409);
  const folder=id=>{const found=value.folders.find(f=>f.id===id);if(!found)throw fail('文件夹不存在');return found;},parent=id=>{if(id!==null)folder(id);return id;};
  let created=null;
  if(input.op==='createFolder'){if(value.folders.length>=2000)throw fail('文件夹数量已达到上限');created={id:randomUUID(),name:title(input.name),parentId:parent(input.parentId??null)};value.folders.push(created);}
  else if(input.op==='renameFolder')folder(input.id).name=title(input.name);
  else if(input.op==='moveFolder'){const f=folder(input.id);f.parentId=parent(input.parentId??null);}
  else if(input.op==='deleteFolder'){const f=folder(input.id);for(const c of value.folders)if(c.parentId===f.id)c.parentId=f.parentId;value.folders=value.folders.filter(c=>c.id!==f.id);value.placements=Object.fromEntries(Object.entries(value.placements).flatMap(([id,p])=>p===f.id?f.parentId?[[id,f.parentId]]:[]:[[id,p]]));}
  else if(input.op==='moveMaps'){if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>1000||input.ids.some(id=>!valid(id)||!mapIds.has(id)))throw fail('待移动的导图不存在或数量无效');const destination=parent(input.folderId??null);const placement=new Map(Object.entries(value.placements));for(const id of input.ids)if(destination)placement.set(id,destination);else placement.delete(id);value.placements=Object.fromEntries(placement);}
  else throw fail('未知的导图库操作');
  for(const f of value.folders){let at=f,seen=new Set();while(at){if(seen.has(at.id)||seen.size>=16)throw fail('不能把文件夹移到自己或自己的子文件夹中，层级最多16级');seen.add(at.id);at=value.folders.find(p=>p.id===at.parentId);}}
  const siblingNames=new Set();for(const f of value.folders){const key=(f.parentId||'root')+'::'+f.name.toLowerCase();if(siblingNames.has(key))throw fail('同一层级已有同名文件夹');siblingNames.add(key);}
  fs.mkdirSync(root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2),'utf8');fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw fail('导图库归类保存失败，原文件已保留',500);}
  return{...value,revision:revision(value),...(created?{created}:{})};
 }
 return{read,update};
};
