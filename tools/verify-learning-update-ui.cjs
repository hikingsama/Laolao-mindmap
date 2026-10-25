'use strict';
// Run with the bundled Playwright on NODE_PATH. Only isolated maps and a local fake model are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),http=require('node:http'),net=require('node:net');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),testRoot=path.join(root,'tmp');fs.mkdirSync(testRoot,{recursive:true});
const temp=fs.mkdtempSync(path.join(testRoot,'learning-ui-')),captured=[],errors=[];let browser,child,mock,count=0;
const check=(name,ok)=>{assert(ok,name);count++;console.log('PASS '+name);};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function freePort(){const s=net.createServer(),p=await listen(s);await new Promise(r=>s.close(r));return p;}
(async()=>{
 mock=http.createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks).toString());captured.push(value);
   const planner=value.messages[0].content.includes('关联员');let output;
   if(value.messages[0].content.includes('整图结构复核员')){const input=JSON.parse(value.messages[1].content);output={root:{nodeId:input.nodes[0].id,nodeIds:[input.nodes[0].id],title:'总览',summary:'总体结构'},modules:[{id:'m',title:'模块',summary:'知识模块',nodeId:input.nodes[1].id,nodeIds:input.nodes.slice(1).map(n=>n.id),children:[]}],reason:'合并并整理现有内容',orderReason:'先基础后应用'};}
   else if(planner){const sources=JSON.parse(value.messages[1].content).sources;output={direction:'回答当前卡点，采用短链',sourceIds:sources.slice(0,1).map(s=>s.id),relation:'continue',note:'测试资料'};}
   else output={edges:[{from:'n1',to:'n2',kind:'inference',label:'根据定义'},{from:'n1',to:'n3',kind:'relation',label:'关联'}],nodes:[
     {id:'n1',title:'导数的意义',text:'导数描述函数在某一点附近的瞬时变化率。先理解变化率，再考虑计算方法。',brief:'从变化率理解导数。',topic:'导数'},
     {id:'n2',title:'从平均到瞬时',text:'平均变化率描述一段区间上的变化；缩小区间，可以进一步讨论某一点的瞬时变化。',brief:'用逐渐缩小的区间理解瞬时变化。',topic:'导数'},
     {id:'n3',title:'继续学习的方向',text:'先用一个具体例子理解上述区别。下一轮可以继续问：怎样从平均变化率计算导数？',brief:'完成当前理解后，再追问计算方法。',topic:'导数'}
   ]};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));
 });
 const modelPort=await listen(mock),port=await freePort(),url='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MM_PORT:String(port),MM_STORAGE_DIR:path.join(temp,'storage'),MM_AI_CONFIG_FILE:path.join(temp,'ai.json'),MM_STUDENT_PROFILE_FILE:path.join(temp,'student.json')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',b=>logs+=b);child.stdout.on('data',()=>{});
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:980}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.Mindmap && window.MMAI);
 check('Home has a global learning-background entry without a mandatory setup prompt',await page.locator('#mmStudentSettingsButton').isVisible() && await page.locator('dialog[open]').count()===0);
 await page.waitForFunction(()=>document.querySelector('[data-student-state]')?.textContent.includes('全模块共用'));
 check('First-screen learning-background card has an explicit fill action',await page.locator('.mm-home-student').isVisible() && await page.locator('[data-student-settings]').textContent()==='填写学习背景');
 await page.setViewportSize({width:2032,height:1177});await page.screenshot({path:path.join(testRoot,'home-background-empty-wide.png'),fullPage:true});
 await page.locator('.mm-home-hero').screenshot({path:path.join(testRoot,'home-background-hero.png')});
 check('Wide homepage places the background card beside the welcome copy',await page.evaluate(()=>{const a=document.querySelector('.mm-home-copy').getBoundingClientRect(),b=document.querySelector('.mm-home-student').getBoundingClientRect();return b.left>a.right && b.top<a.bottom && b.bottom<innerHeight;}));
 await page.setViewportSize({width:1440,height:980});await page.locator('[data-student-settings]').click();await page.waitForFunction(()=>!document.querySelector('#mmStudentSave').disabled);
 check('Background can be opened before any model key is configured',await page.locator('#mmStudentGrade').inputValue()==='');
 await page.locator('#mmStudentGrade').fill('本科一年级');await page.locator('#mmStudentMajor').fill('机械工程');await page.locator('#mmStudentCourses').fill('高中数学\n微积分上册');
 await page.locator('#mmStudentSave').click();await page.waitForFunction(()=>document.querySelector('#mmStudentResult').dataset.kind==='success');
 check('Global form saves grade, major and multiline prior courses',JSON.parse(fs.readFileSync(path.join(temp,'student.json'),'utf8')).profile.courses==='高中数学\n微积分上册');
 await page.locator('#mmStudentClose').click();
 check('Saved background updates the homepage summary and changes the action to modify',await page.locator('[data-student-major]').textContent()==='机械工程' && await page.locator('[data-student-settings]').textContent()==='修改学习背景');
 check('Closing settings returns focus to the homepage card action',await page.evaluate(()=>document.activeElement===document.querySelector('[data-student-settings]')));
 await page.setViewportSize({width:2032,height:1177});await page.screenshot({path:path.join(testRoot,'home-background-saved-wide.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:980});await page.screenshot({path:path.join(testRoot,'home-background-saved-desktop.png'),fullPage:true});
 await page.locator('#mmListQ').fill('测试搜索');await page.waitForFunction(()=>document.querySelector('[data-student-major]')?.textContent==='机械工程');
 check('Homepage redraw retains the cached background and only one card',await page.locator('.mm-home-student').count()===1);
 await page.locator('#mmListQ').fill('');await page.waitForFunction(()=>document.querySelector('[data-student-major]')?.textContent==='机械工程');
 await page.setViewportSize({width:390,height:844});await page.locator('#mmLibrarySidebar [data-workspace="collapse"]').click();await page.locator('.mm-home-student').scrollIntoViewIfNeeded();
 check('Mobile background card remains visible without horizontal overflow',await page.evaluate(()=>{const r=document.querySelector('.mm-home-student').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth;}));
 await page.screenshot({path:path.join(testRoot,'home-background-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:980});await page.locator('.mm-library-reopen').click();
 await page.locator('#mmStudentSettingsButton').click();await page.waitForFunction(()=>!document.querySelector('#mmStudentSave').disabled);
 check('Reopening the settings restores all three saved fields',await page.locator('#mmStudentGrade').inputValue()==='本科一年级' && await page.locator('#mmStudentMajor').inputValue()==='机械工程');
 await page.locator('#mmStudentGrade').fill('未保存');await page.locator('#mmStudentCancel').click();await page.locator('#mmStudentSettingsButton').click();await page.waitForFunction(()=>!document.querySelector('#mmStudentSave').disabled);
 check('Cancel discards unsaved background changes',await page.locator('#mmStudentGrade').inputValue()==='本科一年级');
 await page.screenshot({path:path.join(testRoot,'learning-settings-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check('Mobile settings fit the viewport without horizontal overflow',await page.evaluate(()=>{const r=document.querySelector('#mmStudentSettingsDialog').getBoundingClientRect();return r.x>=0 && r.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth;}));
 await page.screenshot({path:path.join(testRoot,'learning-settings-mobile.png'),fullPage:true});await page.keyboard.press('Escape');
 check('Escape closes the dialog without starting a map operation',await page.locator('#mmStudentSettingsDialog').isVisible()===false);
 await page.setViewportSize({width:1440,height:980});
 const cfg=await (await fetch(url+'/api/ai/config')).json();cfg.activeProvider='custom';cfg.profiles.custom={...cfg.profiles.custom,baseURL:'http://127.0.0.1:'+modelPort,model:'fake-local',apiKey:'fake-test-only'};
 const configured=await fetch(url+'/api/ai/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});assert(configured.ok);
 await page.evaluate(async()=>{
   await window.Mindmap.openDocument({id:'learning-ui-map',title:'测试导图',v:3,flat:true,nodes:[{id:'source',text:'我想理解导数',children:[]}],edges:[],pos:{source:{x:0,y:0}}});
   window.MMAI.open('source');
 });
 check('Question UI describes the 1–3 knowledge-node short-chain default',await page.locator('#mmAIInput').getAttribute('placeholder').then(t=>t.includes('1–3')));
 await page.locator('#mmAIInput').fill('导数是什么意思？');await page.locator('#mmAISend').click();await page.waitForFunction(()=>document.querySelector('#mmAIStatus').textContent.includes('已在主导图生成 3 个'),{},{timeout:15000});
 const state=await page.evaluate(()=>{const m=Mindmap.state().cur;return{nodes:m.nodes,edges:m.edges,pos:m.pos};});
 const knowledge=state.nodes.filter(n=>n.aiTurnId && !n.aiEntry),entry=state.nodes.find(n=>n.aiEntry);
 check('A question creates exactly three knowledge nodes and one question entry',knowledge.length===3 && !!entry && state.nodes.length===5);
 check('The generated nodes form a single consecutive chain',state.edges.length===4 && state.edges.some(e=>e.from.node===knowledge[0].id && e.to.node===knowledge[1].id) && state.edges.some(e=>e.from.node===knowledge[1].id && e.to.node===knowledge[2].id));
 check('Short-chain generation preserves the previous source text',state.nodes.find(n=>n.id==='source').text==='我想理解导数');
 check('Both actual model-role requests receive the global background',captured.length===2 && captured.every(p=>p.messages[0].content.includes('机械工程')));
 await page.evaluate(()=>MMAI.close());await page.waitForTimeout(300);await page.evaluate(()=>Mindmap.fitView());await page.waitForTimeout(300);
 await page.screenshot({path:path.join(testRoot,'learning-short-chain.png'),fullPage:true});
 // Exercise the real pointer path: a second connection between the same nodes using different sides.
 await page.evaluate(async()=>{await Mindmap.openDocument({id:'magnet-test',title:'连接测试',v:3,flat:true,nodes:[{id:'a',text:'节点 A',children:[]},{id:'b',text:'节点 B',children:[]}],edges:[{id:'ab',from:{node:'a',side:'e'},to:{node:'b',side:'w'},dir:'fwd',kind:'inference',label:'由此推出'}],pos:{a:{x:0,y:0},b:{x:350,y:0}}});Mindmap.fitView();});await page.waitForTimeout(300);
 const from=page.locator('.mm-magwrap[data-id="a"] .mm-mag.s'),to=page.locator('.mm-magwrap[data-id="b"] .mm-mag.n');
 await page.evaluate(()=>document.querySelectorAll('.mm-magwrap').forEach(e=>e.classList.add('mag-on')));
 const a=await from.boundingBox(),b=await to.boundingBox();assert(a && b);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();
 check('Dragging between another pair of magnets cannot add a duplicate node connection',await page.evaluate(()=>Mindmap.state().cur.edges.length)===1);
 check('Duplicate connection gives an explicit visible explanation',await page.locator('#banner').textContent().then(t=>t.includes('这两个节点')));
 await page.locator('#mmStructureReviewButton').click();await page.locator('#mmStructureStart').click();await page.locator('#mmStructureApply').waitFor({timeout:15000});
 check('Actual structure review receives the same global student background',captured.at(-1).messages[0].content.includes('机械工程'));
 await page.locator('#mmStructureApply').click();
 check('Adopting the reviewed structure reuses the existing connection instead of stacking a new hierarchy arrow',await page.evaluate(()=>{const m=Mindmap.state().cur;return m.edges.length===1 && m.edges[0].id==='ab' && m.edges[0].label==='由此推出' && m.nodes.map(n=>n.text).join(',')==='节点 A,节点 B';}));
 await page.locator('#mmUndo').click();
 check('Undo restores the pre-review structure with its original connection',await page.evaluate(()=>!Mindmap.state().cur.structures && Mindmap.state().cur.edges.length===1 && Mindmap.state().cur.edges[0].id==='ab'));
 const second=await context.newPage();await second.goto(url);await second.locator('#mmStudentSettingsButton').click();await second.waitForFunction(()=>!document.querySelector('#mmStudentSave').disabled);
 check('A separate page shares the same module-wide background',await second.locator('#mmStudentMajor').inputValue()==='机械工程');
 check('Browser reports no JavaScript runtime errors',errors.length===0);
 console.log(count+' browser checks passed; fake model only. Screenshots: '+testRoot);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();if(child){child.kill();await new Promise(r=>{if(child.exitCode!==null)r();else{child.once('exit',r);setTimeout(r,2000).unref();}});}if(mock)await new Promise(r=>mock.close(r));
 if(path.dirname(temp)===testRoot && path.basename(temp).startsWith('learning-ui-'))fs.rmSync(temp,{recursive:true,force:true});
});

