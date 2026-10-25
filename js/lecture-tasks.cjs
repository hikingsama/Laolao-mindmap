'use strict';
const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto'),{create,valid}=require('./lecture-task-store.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{status}),json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const terminal=new Set(['completed','failed','stopped','interrupted']);
async function body(req,limit=1024*1024){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>limit)throw fail('后台任务请求过大',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw fail('后台任务数据不是有效JSON');}}
function runtime(){try{const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<13)throw Error();require.resolve('@napi-rs/canvas');require.resolve('pdfjs-dist/legacy/build/pdf.mjs');return{available:true};}catch{return{available:false,message:'本地后台PDF需要Node.js 22.13以上及项目依赖，请在项目目录执行 npm ci 后重启服务'};}}
function publicTask(t){return{id:t.id,kind:t.kind||'lecture',sourceKind:t.source?.kind,assets:t.assets?.map(a=>({id:a.id,name:a.name,mime:a.mime,uploaded:a.uploaded})),title:t.title,status:t.status,stage:t.stage,error:t.error,createdAt:t.createdAt,updatedAt:t.updatedAt,completedAt:t.completedAt,target:t.target,model:t.model,applied:t.applied,uncertain:!!t.inFlight,documents:t.record.documents.map(d=>({id:d.id,name:d.name,embedded:d.embedded,pageCount:d.pageCount,uploaded:!!d.uploaded,surveyedPages:d.surveyedPages,processedPages:d.processedPages})),progress:{units:t.record.semanticPlan?.units.length||0,completedUnits:t.record.semanticPlan?.units.filter(u=>u.status==='completed').length||0},claim:t.claim?{expiresAt:t.claim.expiresAt}:undefined};}
exports.createService=({getConfig,getStudentProfile=()=>({}),root}={})=>{
 const store=create(root),workers=new Map(),instance=randomUUID(),lock=path.join(store.root,'.owner.json');let ready=false,closed=false,dispatching=false,owned=false;
 const get=id=>{const t=store.read(id);if(!t)throw fail('后台任务不存在',404);return t;},save=t=>{t.updatedAt=Date.now();store.write(t.id,t);};
 function recover(){if(ready)return;fs.mkdirSync(store.root,{recursive:true,mode:0o700});
  if(fs.existsSync(lock)){let old;try{old=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw fail('后台任务锁文件无法读取，请先备份检查',503);}let alive=false;try{process.kill(old.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')alive=true;}if(alive)throw fail('后台任务由另一个本地服务持有，请使用已启动的服务窗口',423);fs.unlinkSync(lock);}
  try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,instance,createdAt:Date.now()}),{flag:'wx',mode:0o600});}catch{throw fail('另一个本地服务正在接管后台任务，请稍后刷新',423);}owned=true;ready=true;
  for(const t of store.list())if(['running','queued','cancelling'].includes(t.status)){t.status='interrupted';t.record.status='interrupted';t.stage='服务重启，已完成阶段保留，请手动继续';save(t);}}
 async function dispatch(){if(closed||dispatching||workers.size)return;dispatching=true;
  try{const task=store.list().filter(t=>t.status==='queued').sort((a,b)=>a.createdAt-b.createdAt)[0];if(!task)return;let config;try{config=getConfig();if(config.model!==task.model||config.baseURL!==task.baseURL)throw Error('模型配置已变化，请恢复提交时的配置或重新创建任务');}catch(e){task.status='failed';task.error=e.message;save(task);return;}
   task.status='running';task.record.status='running';task.stage='本地后台处理中';save(task);
   const worker=fork(path.join(__dirname,task.kind==='text'?'text-worker.cjs':'lecture-worker.cjs'),[],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],execArgv:['--max-old-space-size=1536']});workers.set(task.id,worker);worker.stdout.resume();worker.stderr.resume();
   worker.once('error',()=>{const current=get(task.id);current.status='interrupted';current.error='后台处理进程无法启动';save(current);});
   worker.once('exit',()=>{workers.delete(task.id);const current=get(task.id);if(['running','cancelling'].includes(current.status)){current.status=current.status==='cancelling'?'stopped':'interrupted';current.record.status=current.status;current.error='处理进程中断，已完成阶段保留';save(current);}void dispatch();});
   worker.send({type:'start',root:store.root,id:task.id,config,instance});
  }finally{dispatching=false;if(!closed&&!workers.size&&store.list().some(t=>t.status==='queued'))setImmediate(()=>void dispatch());}
 }
 return{runtime,recover,async handle(req,res){
  const url=new URL(req.url,'http://local'),parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='ai'||parts[2]!=='lecture-tasks')return false;
  try{recover();const id=parts[3],action=parts[4];
   if(!id){
    if(req.method==='GET'){json(res,200,{tasks:store.list().map(publicTask),runtime:runtime()});return true;}
    if(req.method!=='POST')throw fail('后台任务操作不支持',405);const input=await body(req),config=getConfig();
    if(input.kind==='text'){
     const task=require('./text-tasks.cjs').create(input,{config,studentProfile:getStudentProfile()}),old=store.read(task.id);if(old){if(old.fingerprint!==task.fingerprint)throw fail('同一任务编号对应了不同资料',409);json(res,200,publicTask(old));return true;}if(store.list().filter(t=>!terminal.has(t.status)).length>=8)throw fail('后台任务较多，请先完成或取消已有任务',429);save(task);json(res,201,publicTask(task));return true;
    }
    if(!runtime().available)throw fail(runtime().message,503);
    if(!valid(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||!['branches','fusion'].includes(input.options?.strategy)||!['auto','visual','text'].includes(input.options?.reading)||typeof input.options?.allowSupplement!=='boolean'||!Array.isArray(input.documents)||!input.documents.length||input.documents.length>32)throw fail('后台任务参数无效');
    if(!valid(input.target?.mapId)||input.target.sourceId!=null&&!valid(input.target.sourceId))throw fail('目标导图或来源节点无效');
    const seen=new Set();let bytes=0;const documents=input.documents.map(d=>{if(!valid(d.id)||seen.has(d.id)||typeof d.name!=='string'||!d.name.trim()||d.name.length>255||!Number.isSafeInteger(d.bytes)||d.bytes<5||d.bytes>50*1024*1024||typeof d.embedded!=='boolean')throw fail('后台PDF文档参数无效');seen.add(d.id);bytes+=d.bytes;return{id:d.id,name:d.name,bytes:d.bytes,embedded:d.embedded,pageCount:0,surveyedPages:[],processedPages:[],status:'queued'};});if(bytes>512*1024*1024)throw fail('本次PDF合计超过512 MiB，请减少材料');
    const fingerprint=createHash('sha256').update(JSON.stringify({title:input.title,options:input.options,target:input.target,documents})).digest('hex'),old=store.read(input.id);if(old){if(old.fingerprint!==fingerprint)throw fail('同一任务编号对应了不同资料',409);json(res,200,publicTask(old));return true;}
    if(store.list().filter(t=>!terminal.has(t.status)).length>=8)throw fail('后台任务较多，请先完成或取消已有任务',429);
    const task={id:input.id,title:input.title.trim(),options:{strategy:input.options.strategy,reading:input.options.reading,allowSupplement:input.options.allowSupplement},target:{mapId:input.target.mapId,sourceId:input.target.sourceId||null},fingerprint,model:config.model,baseURL:config.baseURL,studentProfile:getStudentProfile(),status:'uploading',stage:'等待完整上传PDF',createdAt:Date.now(),record:{id:input.id,title:input.title,mode:'lecture',workflow:'local-task-v1',backgroundTaskId:input.id,strategy:input.options.strategy,reading:input.options.reading,allowSupplement:input.options.allowSupplement,status:'running',createdAt:Date.now(),documents,runs:[],sections:[],generatedIds:[]}};save(task);json(res,201,publicTask(task));return true;
   }
   if(!valid(id))throw fail('任务编号无效');const task=get(id);
   if(!action&&req.method==='GET'){json(res,200,publicTask(task));return true;}
   if(!action&&req.method==='DELETE'){if(!terminal.has(task.status)||workers.has(id)||task.claim?.expiresAt>Date.now())throw fail('请先停止任务，并等待结果领取结束后再清理',409);store.remove(id);json(res,200,{removed:true});return true;}
   if(action==='record'&&req.method==='GET'){json(res,200,{record:task.record});return true;}
   if(task.kind==='text'&&action==='asset'&&valid(parts[5])){
    const helper=require('./text-tasks.cjs'),asset=task.assets.find(a=>a.id===parts[5]);if(!asset)throw fail('识别原图不存在',404);if(req.method==='PUT'){await helper.upload(req,task,asset.id,store,get,save);json(res,200,{uploaded:true});return true;}if(req.method==='GET'){if(!asset.uploaded)throw fail('原图未上传完成',404);const file=helper.file(store,task,asset.id);res.writeHead(200,{'Content-Type':asset.mime,'Content-Length':fs.statSync(file).size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);return true;}throw fail('原图操作不支持',405);
   }
   if(task.kind==='text'&&action==='draft'&&req.method==='GET'){json(res,200,{revision:task.record.draftRevision,status:task.status,text:task.record.text,originalText:task.source.text,paragraphs:task.record.paragraphs,plan:task.record.semanticPlan,aiAuthored:task.record.aiAuthored,uncertainties:(task.record.originalSources||[]).flatMap(s=>s.uncertainties||[])});return true;}
   if(task.kind==='text'&&action==='review'&&req.method==='POST'){const result=require('./text-tasks.cjs').revise(task,await body(req));save(task);json(res,202,{...publicTask(task),...result});void dispatch();return true;}
   if(action==='pdf'&&valid(parts[5])){
    const d=task.record.documents.find(d=>d.id===parts[5]);if(!d)throw fail('PDF不存在',404);const file=store.file(id,d.id);
    if(req.method==='GET'){if(!d.uploaded)throw fail('PDF未上传完成',404);res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':fs.statSync(file).size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);return true;}
    if(req.method!=='PUT'||task.status!=='uploading')throw fail('任务已提交，不能改动原PDF',409);
    const tmp=file+'.'+randomUUID()+'.upload',fd=fs.openSync(tmp,'wx',0o600),hash=createHash('sha256');let size=0,header=Buffer.alloc(0);try{for await(const chunk of req){size+=chunk.length;if(size>d.bytes||size>50*1024*1024)throw fail('PDF大小超出声明范围',413);if(header.length<5)header=Buffer.concat([header,chunk]).subarray(0,5);hash.update(chunk);fs.writeSync(fd,chunk);}if(size!==d.bytes||header.toString()!=='%PDF-')throw fail('PDF上传不完整或格式无效');if(get(id).status!=='uploading')throw fail('上传已被取消',409);fs.closeSync(fd);fs.renameSync(tmp,file);d.uploaded=true;d.sha256=hash.digest('hex');save(task);json(res,200,{uploaded:true});}catch(e){try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw e;}return true;
   }
   if(action==='result'&&req.method==='GET'){if(task.status!=='completed')throw fail('任务尚未完成',409);const result=store.read(id,'result.json');if(!result)throw fail('任务结果不存在',404);result.record.status='completed';json(res,200,result);return true;}
   if(action==='start'&&req.method==='POST'){
    if(['queued','running','completed'].includes(task.status)){json(res,200,publicTask(task));return true;}if(task.status!=='uploading'||task.record.documents.some(d=>!d.uploaded)||task.assets?.some(a=>!a.uploaded))throw fail('请完整上传全部资料再提交',409);if(task.kind!=='text'&&!runtime().available)throw fail(runtime().message,503);getConfig();task.status='queued';task.stage='排队等待本地后台处理';save(task);json(res,202,publicTask(task));void dispatch();return true;
   }
   if(action==='resume'&&req.method==='POST'){
    if(!['interrupted','failed','stopped'].includes(task.status))throw fail('当前任务无需继续',409);const input=await body(req);if(task.inFlight&&input.retryUncertain!==true)throw fail('上次请求完成状态不明，重试可能再次计费；请明确确认',409);if(task.record.documents.some(d=>!d.uploaded)||task.assets?.some(a=>!a.uploaded))throw fail('原资料未完整上传，请重新创建任务');getConfig();task.status='queued';task.record.status='running';task.stage='继续处理，复用已完成阶段';save(task);json(res,202,publicTask(task));void dispatch();return true;
   }
   if(action==='cancel'&&req.method==='POST'){
    if(terminal.has(task.status)){json(res,200,publicTask(task));return true;}const worker=workers.get(id);task.status=worker?'cancelling':'stopped';task.record.status=task.status;task.stage='已请求停止，完成阶段将保留';save(task);if(worker){worker.send({type:'cancel'});const timer=setTimeout(()=>{if(workers.get(id)===worker)worker.kill();},10000);timer.unref();}json(res,200,publicTask(task));return true;
   }
   if(action==='claim'&&req.method==='POST'){
    if(task.status!=='completed')throw fail('任务未完成',409);const input=await body(req);if(!valid(input.owner))throw fail('领取身份无效');if(task.applied)throw fail('结果已加入导图，请从生成记录定位',409);if(task.claim&&task.claim.expiresAt>Date.now()&&task.claim.owner!==input.owner)throw fail('另一个页面正在领取此结果，请稍后查看',409);task.claim={owner:input.owner,expiresAt:Date.now()+120000};save(task);json(res,200,{claimed:true});return true;
   }
   if(action==='applied'&&req.method==='POST'){
    const input=await body(req);if(task.claim?.owner!==input.owner||!valid(input.mapId))throw fail('结果领取身份已变化',409);task.applied={mapId:input.mapId,at:Date.now()};delete task.claim;save(task);json(res,200,{applied:true});return true;
   }
   throw fail('后台任务操作不支持',405);
  }catch(e){if(!res.destroyed&&!res.headersSent)json(res,e.status||400,{error:e.message});}return true;
 },dispose(){closed=true;for(const worker of workers.values())if(worker.connected)worker.disconnect();if(owned)try{if(JSON.parse(fs.readFileSync(lock,'utf8')).instance===instance)fs.unlinkSync(lock);}catch{}}};
};
