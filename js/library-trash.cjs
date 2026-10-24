'use strict';
// Whole-map recovery keeps the original ID, draft and media together.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
exports.createStore=({root})=>{
 root=path.resolve(root);const trash=path.join(root,'.trash');
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
 const fail=(text,status=400)=>Object.assign(Error(text),{status});
 function location(key){if(typeof key!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(key))throw fail('回收记录无效');const dest=path.resolve(trash,key);if(path.dirname(dest)!==trash)throw fail('回收路径无效');return dest;}
 function entry(key){const dir=location(key);if(fs.lstatSync(dir).isSymbolicLink())throw fail('不能恢复链接目录');const map=JSON.parse(fs.readFileSync(path.join(dir,'map.json'),'utf8'));if(!valid(map.id))throw fail('回收导图编号无效');let info={};try{info=JSON.parse(fs.readFileSync(path.join(dir,'.trash-info.json'),'utf8'));}catch{}return{trashId:key,id:map.id,title:map.title||'未命名导图',deletedAt:info.deletedAt||fs.statSync(dir).mtimeMs,folderId:info.folderId||null};}
 function list(){return(fs.existsSync(trash)?fs.readdirSync(trash,{withFileTypes:true}):[]).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).flatMap(e=>{try{return[entry(e.name)];}catch{return[];}}).sort((a,b)=>b.deletedAt-a.deletedAt);}
 function remove(id){if(!valid(id))throw fail('导图编号无效');const source=path.resolve(root,id);if(path.dirname(source)!==root)throw fail('导图路径无效');if(!fs.existsSync(source))throw fail('导图已经移除，请刷新列表',404);if(fs.lstatSync(source).isSymbolicLink())throw fail('不能移动链接目录');
  let folderId=null;try{folderId=JSON.parse(fs.readFileSync(path.join(root,'.library.json'),'utf8')).placements?.[id]||null;}catch(e){if(e.code!=='ENOENT')throw fail('无法读取导图库归类，已取消删除');}
  const key=id+'-'+randomUUID(),destination=location(key);fs.mkdirSync(trash,{recursive:true});
  fs.writeFileSync(path.join(source,'.trash-info.json'),JSON.stringify({deletedAt:Date.now(),folderId}));fs.renameSync(source,destination);return entry(key);
 }
 function restore(key){const value=entry(key),source=location(key),destination=path.resolve(root,value.id);if(path.dirname(destination)!==root||fs.lstatSync(source).isSymbolicLink())throw fail('恢复路径无效');if(fs.existsSync(destination))throw fail('同编号导图已存在，恢复已取消，原记录仍在回收站',409);fs.renameSync(source,destination);try{fs.unlinkSync(path.join(destination,'.trash-info.json'));}catch{}return value;}
 return{list,remove,restore};
};
