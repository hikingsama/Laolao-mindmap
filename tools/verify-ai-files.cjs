'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const S=require('../js/ai-summary.cjs'),P=require('../js/ai-lecture-plan.js'),prompts=require('../js/ai-prompts.cjs');
const {partialGraph}=require('../js/ai-stream.cjs'),{bootAll,loadInto,fireDelegated}=require('./smoke.js');
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const docs=[{id:'doc-a',name:'同名讲义.pdf',pageCount:12},{id:'doc-b',name:'同名讲义.pdf',pageCount:5}];
const graph={nodes:[{id:'a',title:'导数',text:'变化率',origin:'source',citations:[{documentId:'doc-a',page:10}]},{id:'b',title:'前提',text:'可导则连续',origin:'source',citations:[{documentId:'doc-a',page:12}]}],edges:[{from:'a',to:'b',kind:'prerequisite'}]};
const task={stage:'extract',strategy:'branches',documents:docs.slice(0,1),pages:[{documentId:'doc-a',page:10,text:'变化率',part:1,parts:1},{documentId:'doc-a',page:12,text:'可导则连续',part:1,parts:1}]};
async function api(handler,url,method='GET',body){const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:8897','content-type':'application/json'}});const res=new EventEmitter();res.writeHead=s=>res.status=s;res.end=s=>{res.data=JSON.parse(s);res.writableEnded=true;};if(typeof handler==='function')await handler(req,res,8897);else await handler.handle(req,res);return{status:res.status,...res.data};}
async function done(handler,id){for(let i=0;i<100;i++){const r=await api(handler,'/api/ai/jobs/'+id);if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,2));}throw Error('timeout');}
(async()=>{
 const validation=P.task(task).normalization;
 check('Page-bound tasks preserve pages beyond six and distinguish identically named documents',()=>{assert.equal(validation.documents[0].pageCount,12);assert.equal(P.citations([{documentId:'doc-b',page:5}],{documents:docs})[0].documentId,'doc-b');});
 check('Citations cannot reference unknown, out-of-range or unsent pages',()=>{for(const c of [{documentId:'absent',page:1},{documentId:'doc-a',page:13},{documentId:'doc-a',page:1}])assert.throws(()=>S.normalizeSummary({...graph,nodes:[{...graph.nodes[0],citations:[c]}],edges:[]},validation));});
 check('Every original-content node needs a real supplied page, while approved supplements stay separate',()=>{assert.throws(()=>S.normalizeSummary({nodes:[{id:'a',title:'无出处',text:'内容'}],edges:[]},validation));assert.equal(S.normalizeSummary({nodes:[{id:'s',title:'解释',text:'补充',origin:'supplement'}],edges:[]},{...validation,allowSupplement:true}).nodes[0].origin,'supplement');});
 check('Stream parser validates citations before exposing complete nodes',()=>{assert.equal(partialGraph(JSON.stringify(graph),validation).nodes.length,2);assert.equal(partialGraph(JSON.stringify({nodes:[{id:'wrong',title:'错引',text:'内容',citations:[{documentId:'doc-a',page:1}]}],edges:[]}),validation).nodes.length,0);});
 const fragment=P.compact(S.normalizeSummary(graph,validation));
 check('Fusion can only cite pages already carried by chapter results',()=>{const normal=P.task({stage:'merge',documents:docs,fragments:[fragment]}).normalization;assert(normal.citationPages.has('doc-a:12'));assert.throws(()=>P.citations([{documentId:'doc-b',page:1}],normal));});
 check('Legacy fusion retains the complete body and its citations',()=>{const f=P.compact({nodes:[{title:'长说明',text:'x'.repeat(500),citations:[{documentId:'doc-a',page:10}]}]});assert.equal(f.nodes[0].text.length,500);assert.equal(f.nodes[0].excerpted,false);assert.equal(f.nodes[0].citations[0].page,10);});
 const calls=[],key='fake-private-key',chat=require('../js/ai-chat.cjs').createService({getConfig:()=>({baseURL:'https://example.invalid',model:'shared-file-model',apiKey:key}),fetchImpl:async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(graph)},finish_reason:'stop'}]}));}});
 try{
   await api(chat,'/api/ai/chat','POST',{requestId:'file-ok',mode:'lecture',messages:[{role:'user',content:'本批资料'}],fileTask:task});const result=await done(chat,'file-ok');
   check('Lecture uses the existing provider once and returns provenance with an inspectable effective prompt',()=>{assert.equal(result.status,'completed');assert.equal(calls.length,1);assert.equal(calls[0].stream,true);assert.equal(result.inspection.promptId,'lecture-extract');assert.equal(result.inspection.output.nodes[1].citations[0].page,12);assert(!JSON.stringify(result).includes(key));});
   const frozen=result.inspection.system;
   // Exercise template reload in an isolated registry; never write the project's live prompts.
   const isolated=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'mm-prompt-verify-'));
   try{
     fs.mkdirSync(path.join(isolated,'js'));fs.mkdirSync(path.join(isolated,'prompts'));
     fs.copyFileSync(path.join(__dirname,'../js/ai-prompts.cjs'),path.join(isolated,'js/ai-prompts.cjs'));
     for(const entry of prompts.catalog())fs.copyFileSync(path.join(__dirname,'..',entry.file),path.join(isolated,entry.file));
     fs.copyFileSync(path.join(__dirname,'../prompts/content-sections.md'),path.join(isolated,'prompts/content-sections.md'));
     const local=require(path.join(isolated,'js/ai-prompts.cjs')),file=path.join(isolated,'prompts/lecture-extract.md');
     const previous=local.snapshot('lecture-extract',[{role:'system',content:local.render('lecture-extract')}],'fake');
     fs.appendFileSync(file,'\n测试版本标记');assert(local.render('lecture-extract').includes('测试版本标记'));assert(!previous.system.includes('测试版本标记'));assert.equal(result.inspection.system,frozen);
   }finally{const resolved=path.resolve(isolated);if(path.dirname(resolved)===path.resolve(require('node:os').tmpdir()) && path.basename(resolved).startsWith('mm-prompt-verify-'))fs.rmSync(resolved,{recursive:true,force:true});}
   check('Manual prompt changes affect future requests while historical snapshots remain unchanged',()=>assert(!result.inspection.system.includes('测试版本标记')));
   const attempts=calls.length;const bad=await api(chat,'/api/ai/chat','POST',{requestId:'bad-file',mode:'lecture',messages:[{role:'user',content:'本批'}],fileTask:{...task,pages:[{...task.pages[0],page:99}]}});
   check('Invalid page tasks are rejected before contacting a paid model',()=>{assert.equal(bad.status,400);assert.equal(calls.length,attempts);});
 }finally{chat.dispose();}
 const snap=prompts.snapshot('lecture-extract',[{role:'system',content:'规则'},{role:'user',content:[{type:'text',text:key},{type:'image_url',image_url:{url:'data:image/png;base64,secret-image'}}]}],'fake',key);
 check('Investigation snapshots omit credentials, encoded images and reasoning',()=>{assert(!JSON.stringify(snap).includes(key));assert(!JSON.stringify(snap).includes('secret-image'));assert(snap.input[0].content[1].note);});
 const handler=require('../js/ai-server.cjs').createHandler({settings:{handle:async()=>false},chat:{handle:async()=>false}}),catalog=await api(handler,'/api/ai/prompts');
 check('Prompt catalog is read-only and available without an AI key',()=>{assert.equal(catalog.readOnly,true);assert.equal(catalog.prompts.length,16);assert(catalog.prompts.every(p=>p.file.startsWith('prompts/') && p.version && p.template));});
 const b=bootAll(),M=b.Mindmap;b.sandbox.window.MMPDF={element:()=>'<div>PDF</div>',sync(){},close(){}};for(const file of ['js/ai-note-format.js','js/ai-lecture-plan.js','js/ai-summary.js'])loadInto(b.sandbox,file,b.sandbox.window);
 const fixture={id:'file-canvas',title:'临时',v:3,flat:true,nodes:[{id:'old',text:'原节点',children:[]}],pos:{old:{x:0,y:0}},edges:[]};await M.openDocument(fixture);
 const before=JSON.stringify(M.state().cur),batch={kind:'outline',lecture:true,recordId:'file-record',documents:docs,pdfAssets:[{documentId:'doc-a',media:{id:'pdf-file',name:'讲义.pdf',mime:'application/pdf',sourceMap:'file-canvas'}}]};
 M.saveOutlineSource({id:'file-record',documents:docs,status:'running'});M.appendAIResult('file-canvas',null,S.normalizeSummary(graph,validation),'讲义',batch,false);
 check('Selected PDF and cited knowledge nodes enter one generation batch with separate map coordinates',()=>{const m=M.state().cur;assert.equal(m.nodes.length,4);assert(m.nodes.some(n=>n.pdf==='pdf-file'));assert(m.nodes.some(n=>n.citations?.[0].page===12));assert.equal(m.media[0].id,'pdf-file');});
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('One undo removes the new PDF node and generated knowledge but preserves old nodes and provenance archive',()=>{const m={...M.state().cur};delete m.outlineSources;assert.equal(JSON.stringify(m),before);assert.equal(M.state().cur.outlineSources[0].documents.length,2);});
 fireDelegated(b.doc.getElementById('mmRedo'),'click',{});check('Redo restores original PDF identity and exact page citations',()=>{assert.equal(M.state().cur.media[0].id,'pdf-file');assert(M.state().cur.nodes.some(n=>n.citations?.some(c=>c.page===12)));});
 console.log(count+' file, prompt and provenance checks passed; isolated fake models only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
