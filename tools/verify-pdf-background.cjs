'use strict';
// Current local-worker architecture has its own browser lifecycle checks.
if(!process.argv.includes('--legacy-browser-flow') && !process.argv.includes('--expect-stall')){
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const result=spawnSync(process.execPath,[path.join(__dirname,'verify-local-lecture-ui.cjs'),...process.argv.slice(2)],{env:process.env,windowsHide:true,stdio:'inherit'});
 if(result.error)throw result.error;process.exit(result.status??1);
}
// Freeze animation callbacks deterministically. No browser throttling flags, real API, or personal data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),{createPDF,createScanPDF}=require('./pdf-fixture.cjs'),{makePlan}=require('./structure-review-fixture.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'tmp');fs.mkdirSync(base,{recursive:true});const temp=fs.mkdtempSync(path.join(base,'background-ui-'));
const expectStall=process.argv.includes('--expect-stall'),calls=[],errors=[],sockets=new Set();let browser,child,mock,page,count=0;
const check=(name,value)=>{assert(value,name);count++;console.log('PASS '+name);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function port(){const s=net.createServer(),p=await listen(s);await new Promise(r=>s.close(r));return p;}
(async()=>{
 mock=http.createServer(async(req,res)=>{
  const parts=[];for await(const b of req)parts.push(b);const payload=JSON.parse(Buffer.concat(parts).toString()),content=payload.messages.at(-1).content,text=Array.isArray(content)?content[0].text:content;
  const input=JSON.parse(text.split('\n\n附带')[0]);let output;
  if(payload.messages[0].content.includes('你是整图结构复核员'))output=makePlan(input);
  else{
   calls.push({payload,input});
   if(input.stage==='survey')output={units:[{title:'定积分题目与解析',topic:'定积分',key:'同一道完整题目',scope:'整合题干、条件、解答和结论。',continuesBefore:false,continuesAfter:false,citations:input.pages.map(p=>({documentId:p.documentId,page:p.page}))}]};
   else if(input.stage==='plan')output={units:[{id:'u1',title:'完整题目与解析',topic:'定积分',goal:'完整整理跨文件的题干与解析。',sourceIds:input.index.map(u=>u.id),dependsOn:[]}]};
   else if(input.stage==='extract')output={edges:[],nodes:[{id:'n1',title:'完整题目与解析',brief:'保留题目条件与解答。',origin:'source',citations:input.pages.map(p=>({documentId:p.documentId,page:p.page})),blocks:[{type:'text',text:'### 题目与条件\n\n保留完整的原文条件。\n\n### 解答与结论\n\n完整回读之后整理得到的内容。'}]}]};
   else throw Error('Unexpected stage '+input.stage);
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));
 });mock.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});const modelPort=await listen(mock),servicePort=await port(),url='http://127.0.0.1:'+servicePort;
 child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MM_PORT:String(servicePort),MM_STORAGE_DIR:path.join(temp,'maps'),MM_AI_CONFIG_FILE:path.join(temp,'ai.json'),MM_STUDENT_PROFILE_FILE:path.join(temp,'student.json')},windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);child.stdout.on('data',()=>{});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(logs);await sleep(50);}assert(ready,'server ready');
 const config=await(await fetch(url+'/api/ai/config')).json();config.activeProvider='custom';config.profiles.custom={...config.profiles.custom,baseURL:'http://127.0.0.1:'+modelPort,model:'fake-background',apiKey:'fake-background-only'};assert((await fetch(url+'/api/ai/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)})).ok);
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1400,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.MMPDFSource && window.MMAILecture);
 const bytes=Array.from(createScanPDF(3));
 await page.evaluate(async bytes=>{
  const lib=await import('/vendor/pdfjs/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
  const loadingTask=lib.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:'/vendor/pdfjs/standard_fonts/'}),doc=await loadingTask.promise,page=await doc.getPage(1),viewport=page.getViewport({scale:1});
  window.__renderFixture={loadingTask,doc,page,viewport};window.__realRAF=requestAnimationFrame;window.__realCancelRAF=cancelAnimationFrame;
  window.__freezeFrames=()=>{window.__frameCalls=0;window.requestAnimationFrame=()=>++window.__frameCalls;window.cancelAnimationFrame=()=>{};};
  window.__restoreFrames=()=>{window.requestAnimationFrame=window.__realRAF;window.cancelAnimationFrame=window.__realCancelRAF;};
  __freezeFrames();const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
  const task=page.render({canvas,viewport,background:'rgb(255,255,255)',annotationMode:0});window.__controlTask=task;window.__controlSettled=false;task.promise.then(()=>window.__controlSettled=true,()=>window.__controlSettled=true);
 },bytes);
 await sleep(400);
 check('Ordinary display rendering reproduces the stall while animation callbacks never run',await page.evaluate(()=>__frameCalls>0 && !__controlSettled));
 await page.evaluate(async()=>{__controlTask.cancel();try{await __controlTask.promise;}catch{}__restoreFrames();});
 if(!expectStall){
  const images=await page.evaluate(async()=>{
   const {page,viewport}=__renderFixture,paint=async opts=>{const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvas,viewport,background:'rgb(255,255,255)',annotationMode:0,...opts}).promise;return canvas.toDataURL();};
   const display=await paint({});__freezeFrames();const offline=await paint({useRequestAnimationFrame:false});const frameCalls=__frameCalls;__restoreFrames();await __renderFixture.loadingTask.destroy();return{equal:display===offline,frameCalls,hasContent:offline.length>4000};
  });
  check('Offscreen rendering preserves display pixels and uses no animation frame',images.equal && images.frameCalls===0 && images.hasContent);
  const scan=await page.evaluate(async bytes=>{__freezeFrames();const entry={id:'scan',file:new File([new Uint8Array(bytes)],'scan.pdf',{type:'application/pdf'})},controller=new AbortController(),batches=[];for await(const batch of MMPDFSource.batches(entry,{reading:'auto',signal:controller.signal}))batches.push(batch);const result={images:batches.reduce((n,b)=>n+b.images.length,0),noText:batches.every(b=>b.pages.every(p=>!p.text.trim())),frames:__frameCalls};__restoreFrames();return result;},bytes);
  check('Automatic reading of image-only scanned pages works without animation frames',scan.images===3 && scan.noText && scan.frames===0);
 }else await page.evaluate(async()=>{await __renderFixture.loadingTask.destroy();});
 await page.evaluate(()=>{MMAIOutline.open(false);const input=document.getElementById('mmOutlineInputSource');input.value='files';input.dispatchEvent(new Event('change'));});
 await page.locator('#mmLecturePicker').setInputFiles([{name:'question.pdf',mimeType:'application/pdf',buffer:createPDF(3)},{name:'answer.pdf',mimeType:'application/pdf',buffer:createScanPDF(3)}]);await page.waitForFunction(()=>document.querySelectorAll('.mm-lecture-file').length===2 && ![...document.querySelectorAll('.mm-lecture-file small')].some(e=>e.textContent.includes('读取页数')));
 await page.locator('[data-lecture-all="0"]').click();await page.locator('#mmLectureStrategy').selectOption('fusion');await page.locator('#mmLectureReading').selectOption('visual');await page.locator('#mmOutlineTitle').fill('暂停动画帧验证');
 await page.evaluate(()=>{__freezeFrames();document.getElementById('mmOutlineForm').requestSubmit();});
 let state;const until=Date.now()+(expectStall?1200:12000);
 while(Date.now()<until){state=await page.evaluate(()=>({running:MMAILecture.running,status:Mindmap.state().cur?.outlineSources?.at(-1)?.status,phases:Mindmap.state().cur?.outlineSources?.at(-1)?.runs.length||0,frames:__frameCalls,error:Mindmap.state().cur?.outlineSources?.at(-1)?.error}));if(!state.running&&state.status)break;await sleep(50);}
 if(expectStall){check('Before the fix, actual lecture generation stalls before sending its first model request',state.running && calls.length===0 && state.frames>0);await page.evaluate(()=>{MMAILecture.stop();__restoreFrames();});}
 else{
  check('The complete survey, global plan and source reread finish with animation frames paused',state.status==='completed' && !state.running);
  check('All six pages are surveyed and processed with no missing content unit',await page.evaluate(()=>Mindmap.state().cur.outlineSources.at(-1).documents.every(d=>d.surveyedPages.length===3&&d.processedPages.length===3)));
  check('Both initial survey and semantic reread send actual source images',calls.filter(c=>c.input.stage==='survey').length===2 && calls.filter(c=>c.input.stage==='extract').length===1 && calls.filter(c=>['survey','extract'].includes(c.input.stage)).every(c=>c.payload.messages.at(-1).content.some(p=>p.type==='image_url')));
  check('Generated Markdown sections and source identities survive without visual animation callbacks',await page.evaluate(()=>Mindmap.state().cur.nodes.some(n=>n.text.includes('### 解答与结论')&&n.citations.length===6)));
  await page.evaluate(()=>__restoreFrames());await page.locator('#mmUndo').click();check('Background-capable generation still undoes as one operation',await page.evaluate(()=>Mindmap.state().cur.nodes.length===0));
 }
 check('No uncaught errors in the frozen-frame browser scenario',errors.length===0);
 console.log(count+' frozen-animation-frame checks passed; '+(expectStall?'original bug reproduced.':'fake models and isolated data only.'));
})().catch(async e=>{console.error(e);process.exitCode=1;if(page)try{console.error(await page.evaluate(()=>({status:Mindmap.state().cur?.outlineSources?.at(-1)?.status,error:Mindmap.state().cur?.outlineSources?.at(-1)?.error,frames:window.__frameCalls})));}catch{}}).finally(async()=>{
 if(browser)await browser.close();if(child){child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else{child.once('exit',r);setTimeout(r,2000).unref();}});}for(const s of sockets)s.destroy();if(mock)await new Promise(r=>mock.close(r));
 if(path.dirname(temp)===base&&path.basename(temp).startsWith('background-ui-'))fs.rmSync(temp,{recursive:true,force:true});
});
