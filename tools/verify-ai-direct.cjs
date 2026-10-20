'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const {partialGraph}=require('../js/ai-stream.cjs'),{bootAll,loadInto,fireDelegated}=require('./smoke.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const plan={edges:[{from:'a',to:'b',kind:'progression'},{from:'a',to:'c',kind:'parallel'}],nodes:[{id:'a',title:'定义',blocks:[{type:'text',text:'从定义开始'},{type:'math',latex:'x=1'}]},{id:'b',title:'推导',text:'代入 $y=x+1$ 得到结果。'},{id:'c',title:'几何解释',text:'观察图形。'}]};
async function api(service,url,method='GET',value){
 const req=Readable.from(value===undefined?[]:[Buffer.from(JSON.stringify(value))]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:8894','content-type':'application/json'}});
 const res=new EventEmitter();res.writeHead=status=>res.status=status;res.end=raw=>{res.raw=raw;res.writableEnded=true;};
 if(typeof service==='function')await service(req,res,8894);else await service.handle(req,res,8894);
 return {status:res.status,data:res.raw?JSON.parse(res.raw):null};
}
(async()=>{
 const raw=JSON.stringify(plan),cut=raw.indexOf('{"id":"b"');
 const partial=partialGraph(raw.slice(0,cut)+'{"id":"b","title":"未完成');
 check('Only fully received nodes enter a partial graph, with stable IDs and display math',()=>{assert.equal(partial.nodes.length,1);assert.equal(partial.nodes[0].id,'a');assert(partial.nodes[0].text.includes('$$\nx=1\n$$'));assert.equal(partial.edges.length,0);});
 const full=partialGraph(raw);
 check('Edges sent before nodes become available once both endpoints are complete',()=>{assert.equal(full.nodes.length,3);assert.equal(full.edges.length,2);assert.equal(full.edges[0].from,'a');});
 check('Streamed nodes reject reserved IDs and duplicate IDs',()=>{assert.equal(partialGraph(JSON.stringify({nodes:[{id:'__entry',title:'bad',text:'bad'},...plan.nodes,plan.nodes[0]]})).nodes.length,3);});
 const b=bootAll(),M=b.Mindmap;loadInto(b.sandbox,'js/ai-note-format.js',b.sandbox.window);loadInto(b.sandbox,'js/ai-summary.js',b.sandbox.window);
 const fixture=()=>({id:'direct-test',title:'临时图',flat:true,v:3,nodes:[{id:'q',text:'原问题',children:[]},{id:'old',text:'原节点',children:[]}],pos:{q:{x:0,y:0},old:{x:350,y:0}},size:{q:{w:160,h:80},old:{w:180,h:80}},edges:[]});
 await M.openDocument(fixture());let before=JSON.stringify(M.state().cur),batch={};
 const first=M.appendAIResult('direct-test','q',partial,'第1次提问：解释',batch),positions=JSON.stringify(M.state().cur.pos);
 check('First streamed knowledge point creates one question entry on the main map',()=>{assert.equal(first.ids.length,2);assert.equal(M.state().cur.nodes.length,4);assert.equal(M.state().cur.nodes.filter(n=>n.text.startsWith('# 第1次提问')).length,1);});
 M.appendAIResult('direct-test','q',full,'第1次提问：解释',batch,true);const after=JSON.stringify(M.state().cur);
 check('Later nodes reuse the entry and preserve existing and earlier streamed positions',()=>{const p=JSON.parse(positions);for(const [id,pos] of Object.entries(p))assert.deepEqual(M.state().cur.pos[id],pos);assert.equal(M.state().cur.nodes.length,6);assert(M.state().cur.edges.some(e=>e.label==='递进'));assert(M.state().cur.edges.some(e=>e.label==='并列'));});
 M.appendAIResult('direct-test','q',full,'第1次提问：解释',batch,true);
 check('Repeated progress and completion cannot duplicate nodes or edges',()=>assert.equal(JSON.stringify(M.state().cur),after));
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('All streamed chunks undo in a single operation',()=>assert.equal(JSON.stringify(M.state().cur),before));
 fireDelegated(b.doc.getElementById('mmRedo'),'click',{});
 check('Redo restores the complete batch with identical IDs and links',()=>assert.equal(JSON.stringify(M.state().cur),after));
 await M.openDocument(fixture());before=JSON.stringify(M.state().cur);batch={};M.appendAIResult('direct-test','q',partial,'第2次提问',batch);
 M.editMap(()=>M.state().cur.nodes.find(n=>n.id==='old').text='期间编辑');M.appendAIResult('direct-test','q',full,'第2次提问',batch,true);
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('Undoing an intervening user edit preserves the complete generated batch',()=>{assert.equal(M.state().cur.nodes.length,6);assert.equal(M.state().cur.nodes.find(n=>n.id==='old').text,'原节点');assert.equal(M.state().cur.edges.filter(e=>['递进','并列'].includes(e.label)).length,2);});
 fireDelegated(b.doc.getElementById('mmUndo'),'click',{});
 check('The next undo removes the batch without resurrecting intermediate chunks',()=>assert.equal(JSON.stringify(M.state().cur),before));
 await M.openDocument(fixture());batch={};M.appendAIResult('direct-test','q',partial,'第3次提问',batch);const deleted=batch.mapping.a;
 M.editMap(()=>{const m=M.state().cur;m.nodes=m.nodes.filter(n=>n.id!==deleted);delete m.pos[deleted];delete m.size[deleted];m.edges=m.edges.filter(e=>e.from.node!==deleted && e.to.node!==deleted);});
 M.appendAIResult('direct-test','q',full,'第3次提问',batch,true);
 check('Deleting a generated node while generation runs does not resurrect it or leave dangling edges',()=>{const m=M.state().cur;assert(!m.nodes.some(n=>n.id===deleted));const ids=new Set(m.nodes.map(n=>n.id));assert(m.edges.every(e=>ids.has(e.from.node)&&ids.has(e.to.node)));});
 const tmpBase=path.resolve(__dirname,'../tmp');fs.mkdirSync(tmpBase,{recursive:true});const temp=fs.mkdtempSync(path.join(tmpBase,'direct-config-'));
 try{
  const cfgFile=path.join(temp,'ai.json'),profiles=Object.fromEntries(['deepseek','glm','kimi','custom'].map(id=>[id,{baseURL:'https://api.example/v1',model:'fake',apiKey:'fake-'+id}]));
  const old={version:1,activeProvider:'glm',profiles,drawing:{enabled:true,model:'glm-image',size:'1280x1280'}};fs.writeFileSync(cfgFile,JSON.stringify(old));
  const settings=require('../js/ai-config.cjs').createService({configFile:cfgFile});let cfg=(await api(settings,'/api/ai/config')).data;
  check('Old enabled drawing configuration is inert and absent from public settings/status',()=>{assert(!('drawing' in cfg));assert(!('drawingAvailable' in settings.status()));assert.equal(typeof settings.drawing,'undefined');});
  await api(settings,'/api/ai/config','PUT',{...cfg,profiles:Object.fromEntries(Object.entries(cfg.profiles).map(([id,v])=>[id,{...v,apiKey:''}]))});
  check('Saving chat settings preserves saved provider keys and legacy private configuration',()=>{const stored=JSON.parse(fs.readFileSync(cfgFile,'utf8'));assert.deepEqual(stored.profiles,profiles);assert.deepEqual(stored.drawing,old.drawing);});
  let imageCalls=0;const handler=require('../js/ai-server.cjs').createHandler({settings,chat:{handle:async()=>false},images:{handle:async()=>{imageCalls++;return true;}}});
  const removed=await api(handler,'/api/ai/images','POST',{prompt:'test'});
  check('Retired image endpoint cannot invoke an image service',()=>{assert.equal(removed.status,404);assert.equal(imageCalls,0);});
  const sent=[],chat=require('../js/ai-chat.cjs').createService({getConfig:()=>settings.active(),fetchImpl:async(url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)},finish_reason:'stop'}]}));}});
  const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
  const start=await api(chat,'/api/ai/chat','POST',{requestId:'direct-graph',mode:'graph',messages:[{role:'user',content:'先前问题'},{role:'assistant',content:'先前回答'},{role:'user',content:'本次问题'}],media:{kind:'image',name:'input.png',images:[{dataUrl:png}]}});
  assert.equal(start.status,202);let done;for(let i=0;i<100;i++){done=await api(chat,'/api/ai/jobs/direct-graph');if(done.data.status!=='running')break;await new Promise(r=>setTimeout(r,2));}
  check('Direct graph uses one streaming request, retains attachment input and scopes output to the latest turn',()=>{assert.equal(done.data.status,'completed');assert.equal(done.data.summary.nodes.length,3);assert.equal(sent.length,1);assert.equal(sent[0].stream,true);assert(sent[0].messages[0].content.includes('不得将此前回答重新总结'));assert(!sent[0].messages[0].content.includes('imagePrompt'));assert(Array.isArray(sent[0].messages.at(-1).content));assert.equal(sent[0].messages.at(-1).content[1].image_url.url,png);});chat.dispose();
 }finally{if(path.dirname(path.resolve(temp))===tmpBase && path.basename(temp).startsWith('direct-config-'))fs.rmSync(temp,{recursive:true,force:true});}
 console.log(count+' direct generation checks passed; fake providers and isolated data only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
