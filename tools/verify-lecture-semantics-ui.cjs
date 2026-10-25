'use strict';
// Current local-worker architecture has its own browser lifecycle checks.
if(!process.argv.includes('--legacy-browser-flow') && !process.argv.includes('--expect-stall')){
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const result=spawnSync(process.execPath,[path.join(__dirname,'verify-local-lecture-ui.cjs'),...process.argv.slice(2)],{env:process.env,windowsHide:true,stdio:'inherit'});
 if(result.error)throw result.error;process.exit(result.status??1);
}
// Real PDF.js, DOM, local jobs and map persistence; isolated storage and a local fake provider only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),{createPDF}=require('./pdf-fixture.cjs'),{makePlan}=require('./structure-review-fixture.cjs');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);};
const root=path.resolve(__dirname,'..'),testRoot=path.resolve(option('artifacts') || path.join(root,'tmp'));fs.mkdirSync(testRoot,{recursive:true});const temp=fs.mkdtempSync(path.join(testRoot,'semantic-ui-'));
const received=[],errors=[],sockets=new Set();let count=0,browser,child,mock,page,slowStage='',slowUnit='',badPlan=false,largeUnit=false;
const check=(name,condition)=>{assert(condition,name);count++;console.log('PASS '+name);};
const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s.address().port));});
async function freePort(){const s=net.createServer(),port=await listen(s);await new Promise(r=>s.close(r));return port;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function planning(input){
 const unused=new Map(input.index.map(u=>[u.id,u])),out=[];
 const add=rows=>{if(!rows.length)return;rows.forEach(u=>unused.delete(u.id));out.push({id:'unit'+(out.length+1),title:rows.length>1?'选择题第3题：跨页题目与解析':rows[0].title,topic:rows.length>1?'定积分':'课程概览',goal:rows.length>1?'完整保留题干、四个选项、逐项理由与结论；核对试题与解析。':'整理本页对应的独立概念与前提。',sourceIds:rows.map(u=>u.id),dependsOn:out.length?[out.at(-1).id]:[]});};
 if(largeUnit)add([...unused.values()]);
 else if(input.strategy==='fusion')add([...unused.values()].filter(u=>u.key==='Q3'));
 else for(const d of input.documents)add([...unused.values()].filter(u=>u.key==='Q3'&&u.citations[0].documentId===d.id));
 for(const u of unused.values())add([u]);if(badPlan)out.pop();return{units:out};
}
const questionBlocks=[{type:'text',text:'### 题目与选项\n\n判断定积分的值，并逐项核对条件。\n\n- A：条件一。\n- B：条件二。\n- C：条件三。\n- D：条件四。\n\n### 第一步：利用定义\n\n'+ '保留原题的完整条件和必要解释。'.repeat(18)},{type:'math',latex:'F(b)-F(a)'},{type:'text',text:'### 第二步：核对结论\n\n逐项分析后回到题目检查条件。\n\n### 原文待核对\n\n若题目与答案不同，分别保留来源，不能猜补。\n\n最终结果保留在完整正文末尾。'}];
(async()=>{
 mock=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const b of req)chunks.push(b);const data=JSON.parse(Buffer.concat(chunks).toString()),system=data.messages[0].content;
   const content=data.messages.at(-1).content,text=Array.isArray(content)?content[0].text:content,input=JSON.parse(text.split('\n\n附带')[0]);
   let output;
   if(system.includes('你是整图结构复核员'))output=makePlan(input);
   else if(system.includes('你是数学排版复核员'))throw Error('Unexpected math repair in the fixture');
   else{
    received.push({data,input});
    if(input.stage==='survey'){
     output={units:[...new Map(input.pages.map(p=>[p.documentId+':'+p.page,p])).values()].flatMap(p=>{const u={title:'内容 '+p.page,topic:'课程概览',key:(input.documents[0].name==='question.pdf'&&[3,4].includes(p.page)||input.documents[0].name==='answer.pdf'&&p.page===3)?'Q3':'topic-'+p.page,scope:'页面上的独立内容；第3、4页及对应答案构成一道题。',continuesBefore:p.page===4,continuesAfter:p.page===3,citations:[{documentId:p.documentId,page:p.page}]};return input.documents[0].name==='question.pdf'&&p.page===1?[u,{...u,title:'同页的第二个独立概念',key:'second-concept'}]:[u];})};
    }
    else if(input.stage==='plan')output=planning(input);
    else if(input.stage==='extract')output={edges:[],nodes:[{id:'n1',title:input.unit.title,topic:input.unit.topic,brief:'本单元包含完整题目、适用条件与解答。',origin:'source',citations:[...new Map(input.pages.map(p=>[p.documentId+':'+p.page,{documentId:p.documentId,page:p.page}])).values()],blocks:input.unit.title.includes('跨页')?questionBlocks:[{type:'text',text:'完整保留本单元的概念、条件和解释。'}]}]};
    else throw Error('Unexpected stage '+input.stage);
    if(input.stage===slowStage && (!slowUnit || input.unit?.id===slowUnit))await sleep(2500);
   }
   if(res.destroyed)return;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));
  }catch(e){errors.push('fake provider: '+e.message);if(!res.destroyed){res.writeHead(500);res.end('{}');}}
 });mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 const modelPort=await listen(mock),port=await freePort(),url='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MM_PORT:String(port),MM_STORAGE_DIR:path.join(temp,'storage'),MM_AI_CONFIG_FILE:path.join(temp,'ai.json'),MM_STUDENT_PROFILE_FILE:path.join(temp,'student.json')},windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);child.stdout.on('data',()=>{});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(logs);await sleep(50);}assert(ready,'isolated server ready');
 const config=await (await fetch(url+'/api/ai/config')).json();config.activeProvider='custom';config.profiles.custom={...config.profiles.custom,baseURL:'http://127.0.0.1:'+modelPort,model:'semantic-fake',apiKey:'semantic-fake-secret'};
 assert((await fetch(url+'/api/ai/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)})).ok);
 const executable=option('edge') || option('chrome');browser=await chromium.launch({...(executable?{executablePath:executable}:{channel:'msedge'}),headless:true});page=await browser.newPage({viewport:{width:1450,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.MMAILecture && window.MMAIInspector);
 const open=async(strategy='fusion',reading='visual',pdfs=[{name:'question.pdf',mimeType:'application/pdf',buffer:createPDF(6)},{name:'answer.pdf',mimeType:'application/pdf',buffer:createPDF(3)}])=>{
  await page.evaluate(()=>{MMAIOutline.open(!!Mindmap.state().cur);const e=document.getElementById('mmOutlineInputSource');e.value='files';e.dispatchEvent(new Event('change'));});
  await page.locator('#mmLecturePicker').setInputFiles(pdfs);await page.waitForFunction(()=>document.querySelectorAll('.mm-lecture-file').length && ![...document.querySelectorAll('.mm-lecture-file small')].some(e=>e.textContent.includes('读取页数')));
  await page.locator('#mmLectureStrategy').selectOption(strategy);await page.locator('#mmLectureReading').selectOption(reading);if(pdfs.length>1)await page.locator('[data-lecture-all="0"]').click();else await page.locator('[data-lecture-embed]').uncheck();await page.locator('#mmOutlineTitle').fill('全文主题与分步测试');
 };
 const submit=async()=>{await page.locator('#mmOutlineGenerate').click();await page.waitForFunction(()=>Mindmap.state().cur?.outlineSources?.at(-1)?.workflow==='semantic-v2');};
 const finished=async()=>{await page.waitForFunction(()=>!MMAILecture.running && ['completed','failed','partial','stopped'].includes(Mindmap.state().cur?.outlineSources?.at(-1)?.status),{},{timeout:90000});};
 const record=()=>page.evaluate(()=>Mindmap.state().cur.outlineSources.at(-1));
 await open();await page.locator('[data-lecture-embed]').nth(1).check();await submit();await finished();let r=await record();assert.equal(r.status,'completed',r.error);
 const planAt=received.findIndex(c=>c.input.stage==='plan'),extractAt=received.findIndex(c=>c.input.stage==='extract');
 check('All PDF survey windows finish before global planning and any knowledge generation',planAt===3 && extractAt===4 && received.slice(0,planAt).every(c=>c.input.stage==='survey') && r.contentIndex.length===10);
 const extraction=received.find(c=>c.input.stage==='extract'&&c.input.unit.title.includes('跨页')),qDoc=r.documents.find(d=>d.name==='question.pdf'),aDoc=r.documents.find(d=>d.name==='answer.pdf');
 check('A planned semantic request rereads pages across the old page-window boundary and answer file',extraction.input.pages.some(p=>p.documentId===qDoc.id&&p.page===3) && extraction.input.pages.some(p=>p.documentId===qDoc.id&&p.page===4) && extraction.input.pages.some(p=>p.documentId===aDoc.id&&p.page===3));
 check('Semantic extraction receives complete PDF text and separately identified source images',extraction.input.pages.every(p=>p.text.includes('Calculus curvature lesson, line 31.')) && extraction.data.messages.at(-1).content.filter(p=>p.type==='image_url').length===3 && extraction.data.messages.at(-1).content.some(p=>p.text?.includes('文档 '+aDoc.id+' 的第3页')));
 check('Only semantic-unit extraction creates detailed nodes, without repeated summary fusion',!received.some(c=>c.input.stage==='merge') && r.runs.filter(x=>x.stage==='extract').length===r.semanticPlan.units.length && r.sections.length===r.semanticPlan.units.length);
 check('Surveyed pages and fully processed pages are recorded separately and completely',r.documents.every(d=>d.surveyedPages.length===d.pageCount && d.processedPages.length===d.pageCount));
 check('The last part of long bodies survives generation and structural organization',await page.evaluate(()=>Mindmap.state().cur.nodes.some(n=>n.text.length>300 && n.text.includes('最终结果保留在完整正文末尾'))));
 const target=await page.evaluate(()=>{const n=Mindmap.state().cur.nodes.find(n=>n.text.includes('最终结果保留'));Mindmap.zoom(1);Mindmap.selectNodes([n.id]);Mindmap.revealBox(Mindmap.state().L.nodes.get(n.id));return n.id;});await sleep(250);
 check('Markdown subsections, separate options and math render inside the same actual node',await page.locator('.mm-node[data-id="'+target+'"] h3').count()===4 && await page.locator('.mm-node[data-id="'+target+'"] li').count()===4 && await page.locator('.mm-node[data-id="'+target+'"] .katex-display').count()===1);
 check('Source images and credentials are absent from the persisted investigation record',!JSON.stringify(r).includes('data:image/') && !JSON.stringify(r).includes('semantic-fake-secret'));
 const mapId=await page.evaluate(()=>Mindmap.state().cur.id),nodeCount=await page.evaluate(()=>Mindmap.state().cur.nodes.length);
 await page.locator('#mmUndo').click();check('The full generation including embedded PDF can be undone once',await page.evaluate(()=>Mindmap.state().cur.nodes.length===0 && Mindmap.state().cur.outlineSources.length===1));await page.locator('#mmRedo').click();check('Redo restores the long node and its exact sources',await page.evaluate(()=>Mindmap.state().cur.nodes.some(n=>n.text.includes('最终结果保留'))&&Mindmap.state().cur.nodes.filter(n=>n.pdf).length===1));
 await page.evaluate(async()=>{await MMFiles.save();});await page.evaluate(id=>Mindmap.open(id),mapId);await page.evaluate(()=>MMAIInspector.openRecord(Mindmap.state().cur.outlineSources.at(-1).id));
 check('Saved records show global steps and retain every original extraction body',await page.locator('[data-semantic-plan]').count()===1 && (await record()).runs.some(x=>x.inspection?.output?.nodes?.some(n=>n.text.includes('最终结果保留'))));
 await page.locator('[data-semantic-plan]').evaluate(el=>el.open=true);await page.screenshot({path:path.join(testRoot,'semantic-plan-record.png'),fullPage:true});await page.locator('[data-mm="dclose"]').last().click();await page.evaluate(()=>Mindmap.leaveDocument());
 // Same pipeline with branch strategy: a global plan still precedes all extraction, with file boundaries preserved.
 const branchStart=received.length;await open('branches','text');await submit();await finished();r=await record();assert.equal(r.status,'completed',r.error);
 check('Branch mode also plans globally but never mixes source-page identities in a knowledge unit',received.slice(branchStart).some(c=>c.input.stage==='plan') && received.slice(branchStart).filter(c=>c.input.stage==='extract').every(c=>new Set(c.input.pages.map(p=>p.documentId)).size===1));await page.evaluate(()=>Mindmap.leaveDocument());
 // An invalid plan must not silently discard a source unit or start generation.
 badPlan=true;const badStart=received.length;await open('fusion','text');await submit();await finished();r=await record();
 check('An incomplete global plan stops before extraction, retaining the survey for investigation',r.status==='failed' && r.error.includes('遗漏') && r.contentIndex.length===10 && !received.slice(badStart).some(c=>c.input.stage==='extract'));badPlan=false;await page.evaluate(()=>Mindmap.leaveDocument());
 // A large semantic unit is not silently cut into page batches.
 largeUnit=true;const largeStart=received.length;await open('fusion','visual',[{name:'question.pdf',mimeType:'application/pdf',buffer:createPDF(25)},{name:'answer.pdf',mimeType:'application/pdf',buffer:createPDF(1)}]);await submit();await finished();r=await record();
 check('Oversized semantic units fail explicitly without truncation or an extraction request',r.status==='failed' && r.error.includes('完整知识单元') && r.semanticPlan.units.length===1 && !received.slice(largeStart).some(c=>c.input.stage==='extract'));largeUnit=false;await page.evaluate(()=>Mindmap.leaveDocument());
 largeUnit=true;const longStart=received.length;await open('fusion','visual',[{name:'long-page.pdf',mimeType:'application/pdf',buffer:createPDF(1,{lineCount:450,lineSpacing:1.3,fontSize:1.2})}]);await submit();await finished();r=await record();assert.equal(r.status,'completed',r.error);
 const longRequest=received.slice(longStart).find(c=>c.input.stage==='extract');check('A long single page keeps every text part with exactly one page image',longRequest.input.pages.length>1 && longRequest.data.messages.at(-1).content.filter(p=>p.type==='image_url').length===1);largeUnit=false;await page.evaluate(()=>Mindmap.leaveDocument());
 // Cancelling a survey and a planned extraction must prevent late responses from creating nodes.
 for(const stage of ['survey','extract']){
  slowStage=stage;slowUnit=stage==='extract'?'unit3':'';const begin=received.length;await open('fusion','text');await submit();await page.waitForFunction(({s,u})=>Mindmap.state().cur?.outlineSources?.at(-1)?.runs.some(r=>r.stage===s && (!u || r.unitId===u) && r.status==='running'),{s:stage,u:slowUnit});
  if(stage==='extract')check('A page is not marked processed while another planned unit on that page is still running',await page.evaluate(()=>{const r=Mindmap.state().cur.outlineSources.at(-1),d=r.documents.find(d=>d.name==='question.pdf');return d.surveyedPages.includes(1) && !d.processedPages.includes(1) && r.semanticPlan.units[1].status==='completed';}));
  await page.locator('[data-lecture-stop]').click();await finished();const before=await page.evaluate(()=>JSON.stringify(Mindmap.state().cur.nodes));await sleep(2700);
  check('Stopping '+stage+' prevents late output and retains unfinished scope',await page.evaluate(saved=>JSON.stringify(Mindmap.state().cur.nodes)===saved && Mindmap.state().cur.outlineSources.at(-1).status==='stopped',before) && received.slice(begin).some(c=>c.input.stage===stage));slowStage='';slowUnit='';await page.evaluate(()=>Mindmap.leaveDocument());
 }
 // Navigate away during an extraction; destination must remain exactly as saved.
 slowStage='extract';await open('fusion','text');await submit();await page.waitForFunction(()=>Mindmap.state().cur?.outlineSources?.at(-1)?.runs.some(r=>r.stage==='extract'&&r.status==='running'));await page.evaluate(id=>Mindmap.open(id),mapId);await sleep(2800);
 check('Switching maps cancels semantic generation without writing into the destination',await page.evaluate(({mapId,nodeCount})=>Mindmap.state().cur.id===mapId && Mindmap.state().cur.nodes.length===nodeCount && !MMAILecture.running,{mapId,nodeCount}));slowStage='';
 check('Later dependent steps retain the complete preceding body instead of a short excerpt',received.some(c=>c.input.stage==='extract' && c.input.contextFragments?.some(f=>f.nodes.some(n=>n.text.includes('最终结果保留在完整正文末尾')))));
 await page.setViewportSize({width:1400,height:1550});await page.evaluate(async()=>{const original=Mindmap.state().cur.nodes.find(n=>n.text.includes('最终结果保留'));await Mindmap.openDocument({id:'sections-preview',title:'分节显示验证',v:3,flat:true,nodes:[{...original,id:'preview',children:[]}],edges:[],pos:{preview:{x:450,y:180}}});Mindmap.selectNodes([]);Mindmap.zoom(1);});await sleep(300);await page.locator('.mm-node[data-id="preview"]').screenshot({path:path.join(testRoot,'semantic-node-sections.png')});
 check('Browser and provider fixtures have no unhandled errors',errors.length===0);
 console.log(count+' semantic PDF browser checks passed; isolated fake models only. Screenshots: '+testRoot);
})().catch(async e=>{console.error(e);process.exitCode=1;if(page){try{console.error(await page.evaluate(()=>({status:document.querySelector('.mm-lecture-progress p')?.textContent,record:Mindmap.state().cur?.outlineSources?.at(-1)?.status,formError:document.querySelector('#mmOutlineError')?.textContent,errors:[]})));await page.screenshot({path:path.join(testRoot,'semantic-ui-error.png'),fullPage:true});}catch{}}}).finally(async()=>{
 if(browser)await browser.close();if(child){child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else{child.once('exit',r);setTimeout(r,2000).unref();}});}for(const s of sockets)s.destroy();if(mock)await new Promise(r=>mock.close(r));
 if(path.dirname(temp)===testRoot && path.basename(temp).startsWith('semantic-ui-'))fs.rmSync(temp,{recursive:true,force:true});
});
