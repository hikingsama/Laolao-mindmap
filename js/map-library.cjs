'use strict';
const fs=require('node:fs'),path=require('node:path'),files=require('./map-files.cjs'),model=require('./map-library-model.js');
const root=path.resolve(process.env.MM_STORAGE_DIR||path.join(__dirname,'../storage/maps'));
const folders=require('./library-folders.cjs').createStore({root}),trash=require('./library-trash.cjs').createStore({root});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
function catalog(){return (fs.existsSync(root)?fs.readdirSync(root,{withFileTypes:true}):[]).filter(d=>d.isDirectory()&&model.validId(d.name)).map(d=>{try{const s=files.snapshot(d.name);return{id:d.name,title:s.map.title,revision:s.revision,updated:s.updated,nodeCount:model.nodes(s.map).length,hasDraft:s.hasDraft,preview:model.preview(s.map)};}catch{return{id:d.name,title:d.name,unavailable:true};}}).sort((a,b)=>(b.updated||0)-(a.updated||0));}
exports.catalog=catalog;
exports.handle=async(req,res,port)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)||req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin)){req.resume();return json(res,403,{error:'仅允许本机页面访问'});}
 try{if(req.url!=='/api/library')return json(res,404,{error:'导图库接口不存在'});
  if(req.method==='GET')return json(res,200,{version:1,maps:catalog(),library:folders.read(),trash:trash.list()});
  if(req.method==='PATCH'){if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw Object.assign(Error('请使用JSON提交归类操作'),{status:415});let length=0,parts=[];for await(const part of req){length+=part.length;if(length>128000)throw Object.assign(Error('归类操作过大'),{status:413});parts.push(part);}let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('归类操作不是有效JSON');}if(input.op==='restoreMap'){const restored=trash.restore(input.trashId);return json(res,200,{restored,library:folders.read()});}const library=folders.update(input,new Set(catalog().filter(m=>!m.unavailable).map(m=>m.id)));return json(res,200,{library});}
  req.resume();return json(res,405,{error:'请求方法不支持'});
 }catch(e){req.resume();json(res,e.status||400,{error:e.message});}
};
