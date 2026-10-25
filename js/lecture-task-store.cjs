'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),capacity=require('./capacity.js');
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const defaultRoot=()=>path.resolve(process.env.MM_LECTURE_TASK_DIR || (process.env.MM_STORAGE_DIR?path.join(path.dirname(path.resolve(process.env.MM_STORAGE_DIR)),'lecture-tasks'):path.join(__dirname,'../.local/lecture-tasks')));
function create(root=defaultRoot()){
 root=path.resolve(root);const dir=id=>{if(!valid(id))throw Error('后台任务编号无效');return path.join(root,id);};
 const read=(id,name='task.json')=>{try{return JSON.parse(fs.readFileSync(path.join(dir(id),name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const write=(id,value,name='task.json')=>{const text=JSON.stringify(value);if(Buffer.byteLength(text)>capacity.documentWarnBytes)throw Error('后台生成记录过大，请拆分材料');const target=path.join(dir(id),name),temp=target+'.'+crypto.randomUUID()+'.tmp';fs.mkdirSync(dir(id),{recursive:true,mode:0o700});fs.writeFileSync(temp,text,{mode:0o600,flag:'wx'});
  try{for(let attempt=0;;attempt++){try{fs.renameSync(temp,target);break;}catch(e){if(attempt>=12||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15);}}}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}};
 const list=()=>fs.existsSync(root)?fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&valid(e.name)).flatMap(e=>{try{const v=read(e.name);return v?[v]:[];}catch{return[];}}).sort((a,b)=>b.createdAt-a.createdAt):[];
 const remove=id=>{const target=fs.realpathSync(dir(id)),parent=fs.realpathSync(root);if(path.resolve(target)!==path.resolve(dir(id))||path.dirname(target)!==parent)throw Error('拒绝清理越界任务目录');fs.rmSync(target,{recursive:true,force:false});};
 return{root,dir,read,write,list,remove,file:(id,documentId)=>{if(!valid(documentId))throw Error('文档编号无效');return path.join(dir(id),documentId+'.pdf');}};
}
module.exports={create,valid,defaultRoot};
