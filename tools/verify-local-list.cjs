"use strict";
// Standalone regression check: synthetic documents, temporary browser/storage,
// and automatically allocated ports. Never connects to a daily-use server.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-local-list-')),storage=path.join(root,'maps');
process.env.MM_AI_CONFIG_FILE=path.join(root,'fake-ai-config.json');
const project=path.resolve(__dirname,'..'),children=[],pending=new Map();let ws,seq=0,checks=0,dialogHandler;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const check=(name,value)=>{assert(value,name);checks++;console.log('PASS '+name);};
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<120;i++){if(await ev(expression))return;await sleep(50);}throw new Error('Condition timed out: '+expression);}
async function ready(url){for(let i=0;i<100;i++){try{const r=await fetch(url);if(r.ok)return r.json();}catch{}await sleep(100);}throw new Error('Not ready: '+url);}
function fixture(id,title=id){return {id,title,v:3,flat:true,theme:'fresh',nodes:[{id:'a',text:'Saved body',children:[]},{id:'b',text:'',image:'pic',children:[]}],pos:{a:{x:0,y:0},b:{x:320,y:0}},size:{b:{w:150,h:110}},sizing:{b:{w:true,h:true}},edges:[{id:'edge',from:{node:'a',side:'e'},to:{node:'b',side:'w'},dir:'fwd'}],groups:[{id:'group',title:'Group',x:-30,y:-50,w:550,h:240}],media:[{id:'pic',name:'sample.png',mime:'image/png',sourceMap:id}],annotations:[]};}
const mapFile=id=>path.join(storage,id,'map.json');
const read=id=>JSON.parse(fs.readFileSync(mapFile(id),'utf8'));
function write(map){fs.mkdirSync(path.dirname(mapFile(map.id)),{recursive:true});fs.writeFileSync(mapFile(map.id),JSON.stringify(map));fs.writeFileSync(path.join(storage,map.id,'sample.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=','base64'));}
function moveOut(id){const source=path.resolve(storage,id),destination=path.resolve(root,'removed-'+id);assert.equal(path.dirname(source),storage);assert.equal(path.dirname(destination),root);fs.renameSync(source,destination);}
async function refresh(){await ev('window.renderMindmap()');}
async function dialogAction(expression,promptText,beforeAccept){let onDialog;const opened=new Promise(resolve=>onDialog=resolve);dialogHandler=onDialog;const clicked=ev(expression);await Promise.race([opened,sleep(8000).then(()=>{throw new Error('Dialog did not open');})]);if(beforeAccept)beforeAccept();await send('Page.handleJavaScriptDialog',{accept:true,...(promptText===undefined?{}:{promptText})});dialogHandler=null;await clicked;}
async function menu(id){await ev(`document.querySelector('[data-mm="menu"][data-id="${id}"]').click()`);}
async function sessionExit(save){const exiting=ev(`MMFiles.exit(${save})`);await until(`!!document.querySelector('[data-session-choice="confirm"]')`);await ev(`document.querySelector('[data-session-choice="confirm"]').click()`);await exiting;await until('!Mindmap.state().cur');}
(async()=>{try{
  const browser=[process.env.MM_BROWSER,path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')].find(p=>p && fs.existsSync(p));assert(browser,'Edge/Chrome not found');
  write(fixture('a','Saved A'));write(fixture('b','Saved B'));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  children.push(spawn(process.execPath,[path.join(project,'server.js')],{cwd:project,env:{...process.env,MM_PORT:String(port),MM_STORAGE_DIR:storage},windowsHide:true,stdio:'ignore'}));await ready(base+'/api/maps');
  const debugPort=await freePort();children.push(spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--window-size=1280,800','--user-data-dir='+path.join(root,'browser'),'--remote-debugging-port='+debugPort,'about:blank'],{windowsHide:true,stdio:'ignore'}));
  const pages=await ready(`http://127.0.0.1:${debugPort}/json/list`);ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.method==='Page.javascriptDialogOpening')dialogHandler?.(r.params);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);}};
  await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('mm_disk_bootstrap_v1','true')`});await send('Page.navigate',{url:base+'/'});
  await until(`!!window.MMFiles && Mindmap.state().index.length===2 && Mindmap.state().index.every(e=>e.fileBaseHash)`);
  check('fresh home discovers saved files even with the old one-time marker',await ev(`document.querySelectorAll('.mm-card').length===2`));
  const homeScreenshot=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(project,'tmp'),{recursive:true});fs.writeFileSync(path.join(project,'tmp','merged-home-preview.png'),Buffer.from(homeScreenshot.data,'base64'));
  check('home scan creates no edit session',!fs.existsSync(path.join(storage,'a','.draft')));
  write(fixture('c','Added C'));await refresh();await until(`Mindmap.state().index.some(e=>e.id==='c')`);check('external addition appears on the next home visit',true);
  const updated=read('a');updated.title='Externally renamed';updated.nodes[0].text='Externally updated body';write(updated);await refresh();await until(`Mindmap.state().index.find(e=>e.id==='a')?.title==='Externally renamed'`);
  check('external rename and content replace a clean browser cache',await ev(`JSON.parse(localStorage.getItem('mm_map_a')).nodes[0].text==='Externally updated body'`));
  moveOut('b');await refresh();await until(`!Mindmap.state().index.some(e=>e.id==='b')`);check('external removal clears the stale card and clean cache',await ev(`localStorage.getItem('mm_map_b')===null`));
  await ev(`(()=>{const m=JSON.parse(localStorage.getItem('mm_map_a'));m.nodes[0].text='Browser draft';localStorage.setItem('mm_map_a',JSON.stringify(m));localStorage.setItem('mm_recovery_v1_a',JSON.stringify({map:m,token:'browser-token',updated:Date.now()}));})()`);
  await refresh();await until(`Mindmap.state().index.find(e=>e.id==='a')?.hasDraft`);
  check('browser edits and recovery survive a home scan',await ev(`JSON.parse(localStorage.getItem('mm_map_a')).nodes[0].text==='Browser draft' && JSON.parse(localStorage.getItem('mm_recovery_v1_a')).token==='browser-token'`));
  moveOut('a');await refresh();await until(`Mindmap.state().index.find(e=>e.id==='a')?.fileMissing`);check('removed file with browser edits retains a labelled draft',await ev(`document.querySelector('.mm-card[data-id="a"]').textContent.includes('文件已移除')`));
  const begin=await (await fetch(base+'/api/maps/c/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:read('c')})})).json();const draft={...read('c'),title:'Server draft'};
  await fetch(base+'/api/maps/c/draft',{method:'PUT',headers:{'Content-Type':'application/json','X-MM-Draft-Token':begin.token},body:JSON.stringify(draft)});await refresh();await until(`Mindmap.state().index.find(e=>e.id==='c')?.hasDraft`);
  check('server recovery is retained in browser storage',await ev(`JSON.parse(localStorage.getItem('mm_recovery_v1_c')).map.title==='Server draft'`));
  await menu('c');await dialogAction(`document.querySelector('[data-mm="ren"][data-id="c"]').click()`,'Must not replace draft');await until(`document.getElementById('banner').textContent.includes('草稿')`);check('home rename cannot discard an existing draft',read('c').title==='Added C');
  moveOut('c');await refresh();await until(`Mindmap.state().index.find(e=>e.id==='c')?.fileMissing`);check('server draft survives later removal of the entire file folder',await ev(`!!localStorage.getItem('mm_recovery_v1_c')`));
  const local=fixture('browser-only','Browser only');await ev(`localStorage.setItem('mm_map_browser-only',${JSON.stringify(JSON.stringify(local))});localStorage.setItem('mm_index_v1',JSON.stringify([...Mindmap.state().index,{id:'browser-only',title:'Browser only',updated:Date.now()}]))`);await send('Page.reload');await until(`!!window.MMFiles && Mindmap.state().index.some(e=>e.id==='browser-only')`);await sleep(150);
  check('browser-only legacy documents are retained',await ev(`!!localStorage.getItem('mm_map_browser-only')`));
  const previous=await ev(`JSON.stringify(Mindmap.state().index)`);await ev(`window.__fetch=fetch;window.fetch=(u,o)=>u==='/api/maps'?Promise.resolve(new Response(JSON.stringify({error:'offline'}),{status:503})):window.__fetch(u,o);window.renderMindmap()`);await until(`document.getElementById('banner').textContent.includes('更新本地导图列表失败')`);
  check('failed scan preserves the existing list and drafts',await ev(`JSON.stringify(Mindmap.state().index)===${JSON.stringify(previous)} && !!localStorage.getItem('mm_recovery_v1_a')`));await ev('window.fetch=window.__fetch');
  fs.mkdirSync(path.join(storage,'broken'));fs.writeFileSync(mapFile('broken'),'{bad json');await refresh();await sleep(200);check('invalid file does not empty the list',await ev(`JSON.stringify(Mindmap.state().index)===${JSON.stringify(previous)}`));moveOut('broken');
  write(fixture('d','Menu D'));write(fixture('e','Menu E'));await ev(`window.dispatchEvent(new Event('focus'))`);await until(`Mindmap.state().index.some(e=>e.id==='e')`);check('returning focus to home scans for additions',true);
  await menu('d');await dialogAction(`document.querySelector('[data-mm="ren"][data-id="d"]').click()`,'Renamed from home');await until(`Mindmap.state().index.find(e=>e.id==='d')?.title==='Renamed from home'`);
  check('home rename updates the saved title without changing node text',read('d').title==='Renamed from home' && read('d').nodes[0].text==='Saved body');
  await refresh();await sleep(200);check('home rename survives rescan',await ev(`Mindmap.state().index.find(e=>e.id==='d').title==='Renamed from home'`));
  await menu('e');await dialogAction(`document.querySelector('[data-mm="delmap"][data-id="e"]').click()`);await until(`!Mindmap.state().index.some(e=>e.id==='e')`);check('home deletion removes the saved folder from active storage',!fs.existsSync(path.join(storage,'e')));
  check('deleted documents and media remain together in the archive',fs.readdirSync(path.join(storage,'.trash')).some(n=>n.startsWith('e-') && fs.existsSync(path.join(storage,'.trash',n,'sample.png'))));
  await refresh();await sleep(200);check('deleted home card does not reappear',await ev(`!Mindmap.state().index.some(e=>e.id==='e')`));
  await menu('d');await dialogAction(`document.querySelector('[data-mm="delmap"][data-id="d"]').click()`,undefined,()=>{const m=read('d');m.title='Changed during confirmation';write(m);});await until(`document.getElementById('banner').textContent.includes('文件已更新')`);check('concurrent external edit prevents deleting the wrong version',fs.existsSync(mapFile('d')));
  await ev(`document.querySelector('.mm-card[data-id="d"]').click()`);await until(`Mindmap.state().cur?.id==='d' && !!document.querySelector('.mm-node-image')?.naturalWidth`);
  check('discovered map opens nodes, media, edges and groups',await ev(`Mindmap.state().cur.nodes.length===2 && Mindmap.state().cur.edges.length===1 && Mindmap.state().cur.groups.length===1`));
  write(fixture('while-editing','Added while editing'));await ev(`Mindmap.editMap(()=>{Mindmap.state().cur.title='Saved editor title'});window.dispatchEvent(new Event('focus'))`);check('focus while editing does not replace the current document',await ev(`Mindmap.state().cur.title==='Saved editor title'`));
  assert(await ev(`MMFiles.save()`));await sessionExit(true);await until(`Mindmap.state().index.some(e=>e.id==='while-editing')`);check('save and exit rescan the folder',read('d').title==='Saved editor title');
  await ev(`Mindmap.open('d')`);await ev(`Mindmap.editMap(()=>{Mindmap.state().cur.title='Discard this title'})`);await sessionExit(false);await until(`Mindmap.state().index.find(e=>e.id==='d')?.title==='Saved editor title'`);check('discard and exit preserve the latest committed title',read('d').title==='Saved editor title');
  write(fixture('real-recovery','Recovery base'));await refresh();await until(`Mindmap.state().index.some(e=>e.id==='real-recovery')`);await ev(`Mindmap.open('real-recovery')`);await ev(`Mindmap.editMap(()=>{Mindmap.findNode('a').n.text='Recover after home scan'});MMFiles.flush()`);await send('Page.reload');await until(`!!window.MMFiles && Mindmap.state().index.find(e=>e.id==='real-recovery')?.hasDraft`);
  const opening=ev(`Mindmap.open('real-recovery')`);await until(`!!document.querySelector('[data-session-choice="recover"]')`);await ev(`document.querySelector('[data-session-choice="recover"]').click()`);await opening;check('real edit session recovers after reload and automatic scan',await ev(`Mindmap.findNode('a').n.text==='Recover after home scan'`));
  check('recovery does not commit the draft during a scan',read('real-recovery').nodes[0].text==='Saved body');await sessionExit(false);await until(`Mindmap.state().index.find(e=>e.id==='real-recovery')?.hasDraft===false`);check('discarded draft is not restored by the next scan',true);
  check('personal storage was never used',storage.startsWith(root+path.sep));console.log(`RESULT ${checks} checks passed`);
}finally{if(ws)ws.close();await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();})));}})().catch(error=>{console.error(error);process.exitCode=1;});
