'use strict';
// Map directories move intact. Folder records retain the full tree and placements.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const fail=(text,status=400)=>Object.assign(Error(text),{status});
exports.createStore=({root})=>{
 root=path.resolve(root);const trash=path.join(root,'.trash'),journal=path.join(root,'.library-transaction.json'),folders=require('./library-folders.cjs').createStore({root});
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const exists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 function safe(file){file=path.resolve(file);if(file===root||!file.startsWith(root+path.sep))throw fail('回收路径越界');for(let at=file;at!==path.dirname(root);at=path.dirname(at)){if(exists(at)&&fs.lstatSync(at).isSymbolicLink())throw fail('回收操作不能处理链接目录或文件');if(at===root)break;}return file;}
 function location(key){if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(key))throw fail('回收记录无效');const dest=safe(path.resolve(trash,key));if(path.dirname(dest)!==trash)throw fail('回收路径无效');return dest;}
 function purgeFile(key){location(key);return safe(path.join(trash,'.purge-'+key+'.json'));}
 function mapPath(id){if(!valid(id))throw fail('导图编号无效');return safe(path.join(root,id));}
 function treeSafe(dir){safe(dir);for(const item of fs.readdirSync(dir,{withFileTypes:true})){const next=safe(path.join(dir,item.name));if(item.isSymbolicLink())throw fail('回收记录含链接，已取消彻底删除');if(item.isDirectory())treeSafe(next);}}
 function erase(key){const dir=location(key);if(!exists(dir))return;treeSafe(dir);fs.rmSync(dir,{recursive:true});}
 const clean=value=>folders.validate(value);
 function writeJSON(file,value){safe(file);const temp=safe(file+'.'+randomUUID()+'.tmp');try{fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}finally{if(exists(temp))fs.unlinkSync(temp);}}
 function journalPath(relative){if(typeof relative!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/.test(relative)||/^\.trash\/[A-Za-z0-9_-]{1,160}(?:\/maps\/[A-Za-z0-9_-]{1,100})?$/.test(relative)))throw fail('回收事务路径无效',500);return safe(path.join(root,...relative.split('/')));}
 function recover(){
  if(!exists(journal))return;safe(journal);let value;try{value=JSON.parse(fs.readFileSync(journal,'utf8'));}catch{throw fail('回收事务记录无法读取，请保留本地文件后检查',500);}
  if(value.version!==1||!Array.isArray(value.moves)||!Array.isArray(value.rollback)||!Array.isArray(value.commit)||!['pending','committed'].includes(value.status))throw fail('回收事务记录无效',500);
  const before=clean(value.before),after=clean(value.after),current=folders.read();if(![folders.revision(before),folders.revision(after)].includes(current.revision))throw fail('回收事务与当前归类冲突，已保留全部文件，请检查',409);
  for(const move of value.moves){journalPath(move.from);journalPath(move.to);}
  for(const key of [...value.rollback,...value.commit])location(key);
  if(value.status==='pending'){
   for(const move of [...value.moves].reverse()){const from=journalPath(move.from),to=journalPath(move.to);if(exists(to)){if(exists(from))throw fail('回收事务恢复遇到同编号文件，已保留双方文件',409);fs.mkdirSync(path.dirname(from),{recursive:true});fs.renameSync(to,from);}else if(!exists(from))throw fail('回收事务缺少文件，已保留记录等待检查',500);}
   if(current.revision!==folders.revision(before))folders.replace(before,current.revision);
   for(const key of value.rollback)erase(key);
  }else for(const key of value.commit)erase(key);
  fs.unlinkSync(journal);
 }
 function transact(before,after,moves,{rollback=[],commit=[]}={}){
  before=clean(before);after=clean(after);for(const move of moves){if(!exists(journalPath(move.from))||exists(journalPath(move.to)))throw fail('待处理文件已变化，操作已取消',409);}const value={version:1,status:'pending',before,after,moves,rollback,commit};writeJSON(journal,value);
  try{for(const move of moves){const source=journalPath(move.from),destination=journalPath(move.to);if(!exists(source)||exists(destination))throw fail('待处理文件已变化，操作已取消',409);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(source,destination);}folders.replace(after,folders.revision(before));value.status='committed';writeJSON(journal,value);recover();}
  catch(e){try{recover();}catch(recovery){throw fail(e.message+'；'+recovery.message,recovery.status||500);}throw e;}
 }
 function pathName(value,id){const parts=[];for(let f=value.folders.find(f=>f.id===id),i=0;f&&i<17;i++,f=value.folders.find(p=>p.id===f.parentId))parts.unshift(f.name);return parts.join(' / ')||'未分类';}
 function entry(key){
  const pending=purgeFile(key);if(exists(pending)){const saved=JSON.parse(fs.readFileSync(pending,'utf8')),record=saved.record;if(saved.version!==1||record?.trashId!==key||!valid(record.id)||typeof record.token!=='string')throw fail('彻底删除收尾记录无效');return{...record,purgeIncomplete:true};}
  const dir=location(key);if(!exists(dir))throw fail('回收记录已不存在，请刷新后重试',404);let info={},raw='';try{raw=fs.readFileSync(safe(path.join(dir,'.trash-info.json')),'utf8');info=JSON.parse(raw);}catch(e){if(e.code!=='ENOENT')throw fail('回收记录无法读取');}
  if(info.version===2){
   if(!['map','folder'].includes(info.kind)||!valid(info.id)||!Array.isArray(info.maps)||!Array.isArray(info.folders)||info.maps.some(m=>!valid(m.id))||new Set(info.maps.map(m=>m.id)).size!==info.maps.length)throw fail('回收记录格式无效');
   clean({version:1,folders:info.folders.map(f=>({...f,parentId:info.folders.some(c=>c.id===f.parentId)?f.parentId:null})),placements:info.placements||{}});
   for(const m of info.maps){const file=safe(path.join(dir,'maps',m.id,'map.json'));if(!exists(file))throw fail('回收记录缺少导图文件，请检查');}
   return{trashId:key,kind:info.kind,id:info.id,title:info.title,deletedAt:info.deletedAt,folderId:info.folderId||null,originalPath:info.originalPath||'未分类',mapCount:info.maps.length,folderCount:info.folders.length,contents:[...info.folders.map(f=>f.name),...info.maps.map(m=>m.title)],token:hash(raw),info};
  }
  const map=JSON.parse(fs.readFileSync(safe(path.join(dir,'map.json')),'utf8'));if(!valid(map.id))throw fail('回收导图编号无效');const value=folders.read();
  return{trashId:key,kind:'map',id:map.id,title:map.title||'未命名导图',deletedAt:info.deletedAt||fs.statSync(dir).mtimeMs,folderId:info.folderId||null,originalPath:info.originalPath||pathName(value,info.folderId),mapCount:1,folderCount:0,contents:[],token:hash(raw+JSON.stringify(map)),legacy:true,info};
 }
 const publicEntry=({info,legacy,...value})=>value;
 function list(){recover();if(exists(trash))safe(trash);const keys=new Set();for(const e of exists(trash)?fs.readdirSync(trash,{withFileTypes:true}):[]){if(e.isDirectory()&&!e.isSymbolicLink())keys.add(e.name);if(e.isFile()&&/^\.purge-[A-Za-z0-9_-]+\.json$/.test(e.name))keys.add(e.name.slice(7,-5));}return[...keys].flatMap(key=>{try{return[publicEntry(entry(key))];}catch{return[];}}).sort((a,b)=>b.deletedAt-a.deletedAt);}
 function remove(id){
  recover();const source=mapPath(id);if(!exists(source))throw fail('导图已经移除，请刷新列表',404);const value=folders.read(),map=JSON.parse(fs.readFileSync(safe(path.join(source,'map.json')),'utf8'));if(map.id!==id)throw fail('导图编号与文件夹不一致');const key=id+'-'+randomUUID();fs.mkdirSync(safe(trash),{recursive:true});
  writeJSON(path.join(source,'.trash-info.json'),{deletedAt:Date.now(),folderId:value.placements[id]||null,originalPath:pathName(value,value.placements[id])});fs.renameSync(source,location(key));return publicEntry(entry(key));
 }
 function removeSelection(input,catalog){
  recover();const all=new Map(catalog.map(m=>[m.id,m])),picked=folders.selection(input.selection,new Set(all.keys())),before=picked.value;
  if(input.revision!==before.revision)throw fail('导图库已被其他窗口修改，请刷新后重试',409);
  if(!picked.folderIds.length&&!picked.mapIds.length)throw fail('请选择要删除的内容');
  for(const id of picked.mapIds){const m=all.get(id);if(m.unavailable||typeof input.revisions?.[id]!=='string'||input.revisions[id]!==m.revision)throw fail('导图文件已更新或不可用，已取消删除，请刷新后重试',409);treeSafe(mapPath(id));}
  const chosen=new Set(picked.folderIds),after=clean({version:1,folders:before.folders.filter(f=>!chosen.has(f.id)),placements:Object.fromEntries(Object.entries(before.placements).filter(([id])=>!picked.mapIds.includes(id)))}),groups=[],covered=new Set();
  for(const top of picked.roots){const scope=new Set([top.id]);for(let i=0;i<16;i++)for(const f of before.folders)if(scope.has(f.parentId))scope.add(f.id);const maps=picked.mapIds.filter(id=>scope.has(before.placements[id]));for(const id of maps)covered.add(id);groups.push({kind:'folder',id:top.id,title:top.name,folderId:top.parentId,folders:before.folders.filter(f=>scope.has(f.id)),mapIds:maps});}
  for(const id of picked.mapIds)if(!covered.has(id))groups.push({kind:'map',id,title:all.get(id).title,folderId:before.placements[id]||null,folders:[],mapIds:[id]});
  const keys=[],moves=[];let started=false;fs.mkdirSync(safe(trash),{recursive:true});
  try{for(const group of groups){const key=group.id+'-'+randomUUID(),dir=location(key);keys.push(key);fs.mkdirSync(path.join(dir,'maps'),{recursive:true});const info={version:2,...group,deletedAt:Date.now(),originalPath:pathName(before,group.folderId),placements:Object.fromEntries(group.mapIds.filter(id=>before.placements[id]).map(id=>[id,before.placements[id]])),maps:group.mapIds.map(id=>({id,title:all.get(id).title}))};delete info.mapIds;writeJSON(path.join(dir,'.trash-info.json'),info);for(const id of group.mapIds)moves.push({from:id,to:'.trash/'+key+'/maps/'+id});}
   started=true;transact(before,after,moves,{rollback:keys});
  }catch(e){if(!started)for(const key of keys)if(exists(location(key)))erase(key);throw e;}
  return{records:keys.map(key=>publicEntry(entry(key))),mapIds:picked.mapIds,folderIds:picked.folderIds};
 }
 function restore(key,token){
  recover();const value=entry(key);if(value.purgeIncomplete)throw fail('这条记录已开始彻底删除，无法恢复；请重试彻底删除以完成文件清理');if(token&&token!==value.token)throw fail('回收记录已变化，请刷新后重试',409);const before=folders.read(),after=clean(before),moves=[];let fallback=false;
  if(value.legacy){const destination=mapPath(value.id);if(exists(destination))throw fail('同编号导图已存在，恢复已取消，原记录仍在回收站',409);moves.push({from:'.trash/'+key,to:value.id});if(value.folderId&&after.folders.some(f=>f.id===value.folderId))after.placements[value.id]=value.folderId;else{delete after.placements[value.id];fallback=!!value.folderId;}}
  else{
   const info=value.info,known=new Set(after.folders.map(f=>f.id)),restoredIds=new Set(info.folders.map(f=>f.id));if(info.folders.some(f=>known.has(f.id)))throw fail('同编号文件夹已存在，整组恢复已取消',409);
   const names=new Set(after.folders.map(f=>(f.parentId||'root')+'::'+f.name.toLowerCase()));
   for(const original of info.folders){const f={...original};if(f.parentId&&!known.has(f.parentId)&&!restoredIds.has(f.parentId)){f.parentId=null;fallback=true;}let name=f.name,index=1;while(names.has((f.parentId||'root')+'::'+name.toLowerCase()))name=f.name.slice(0,60)+'（恢复 '+index+++'）';f.name=name;names.add((f.parentId||'root')+'::'+name.toLowerCase());after.folders.push(f);}
   for(const m of info.maps){if(exists(mapPath(m.id)))throw fail('同编号导图已存在，整组恢复已取消，原记录仍在回收站',409);moves.push({from:'.trash/'+key+'/maps/'+m.id,to:m.id});const folder=info.placements[m.id];if(folder&&after.folders.some(f=>f.id===folder))after.placements[m.id]=folder;else{delete after.placements[m.id];if(folder)fallback=true;}}
  }
  const validated=clean(after);transact(before,validated,moves,{commit:value.legacy?[]:[key]});if(value.legacy){const info=safe(path.join(mapPath(value.id),'.trash-info.json'));if(exists(info))fs.unlinkSync(info);}return{...publicEntry(value),fallback};
 }
 function purge(key,token){recover();const value=entry(key);if(!token||token!==value.token)throw fail('回收记录已变化，请刷新并重新确认',409);const dir=location(key);if(exists(dir))treeSafe(dir);const pending=purgeFile(key);writeJSON(pending,{version:1,record:publicEntry(value)});try{erase(key);fs.unlinkSync(pending);}catch(e){throw fail('彻底删除的文件清理未完成，请重试彻底删除：'+e.message,500);}return publicEntry(value);}
 function batch(input){
  recover();if(!['restore','purge'].includes(input.action)||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>12000||new Set(input.entries.map(e=>e.trashId)).size!==input.entries.length)throw fail('回收站操作参数无效');const succeeded=[],failed=[];
  for(const item of input.entries){try{if(!item.token)throw fail('缺少回收记录版本，请刷新');const record=input.action==='restore'?restore(item.trashId,item.token):purge(item.trashId,item.token);succeeded.push(record);}catch(e){failed.push({trashId:item.trashId,error:e.message});}}
  return{succeeded,failed};
 }
 return{list,remove,restore,purge,batch,removeSelection,recover};
};
