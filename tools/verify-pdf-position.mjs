import {createPDF} from './pdf-fixture.cjs';
export async function run({ev,send,sleep,mouse,check,writeFileSync}){
  const id='pdf-position-'+Date.now(),base64=createPDF().toString('base64'),wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return true;await sleep(60);}return false;};
  const hover=async()=>{const p=await ev(`(()=>{const r=document.querySelector('.mm-pdf-shell').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,120)};})()`);await mouse('mouseMoved',p.x,p.y,0,0);return wait(`document.querySelector('.mm-pdf-shell').dataset.ready==='true'`);};
  const leave=async()=>{await mouse('mouseMoved',10,15,0,0);await sleep(400);return wait(`document.querySelector('.mm-pdf-shell').dataset.reading==='false'`);};
  await ev(`window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));Mindmap.openDocument({id:'${id}',title:'PDF位置与连续页面',v:3,flat:true,nodes:[],pos:{},size:{},edges:[]})`);
  await ev(`MMFiles.insertFiles([new File([Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0))],'连续页面.pdf',{type:'application/pdf'})],{x:0,y:0})`);
  await ev(`window.__id=Mindmap.state().cur.nodes[0].id;Mindmap.editMap(()=>{const m=Mindmap.state().cur;m.size[window.__id]={w:420,h:1500};(m.sizing ||= {})[window.__id]={w:true,h:true};});Mindmap.selectNodes([]);Mindmap.zoom(.32);Mindmap.revealBox(Mindmap.state().L.nodes.get(window.__id));`);
  check('未进入阅读时，高节点预览连续多页而非仅一页',await wait(`document.querySelector('.mm-pdf-page-preview').dataset.pages?.split(',').length>=3`));
  check('预览只渲染节点可见范围，没有绘制整本文档',await ev(`document.querySelector('.mm-pdf-page-preview').dataset.pages.split(',').length<8 && document.querySelectorAll('.mm-pdf-page-preview canvas').length===1`));
  check('悬浮连续阅读可用',await hover());
  check('默认PDF页面适应节点宽度，并同时显示多页',await wait(`(()=>{const s=document.querySelector('.mm-pdf-scroll'),p=s.querySelector('.page');return p && Math.abs(p.clientWidth-s.clientWidth)<=2 && [...s.querySelectorAll('.page')].filter(p=>p.offsetTop<s.scrollTop+s.clientHeight&&p.offsetTop+p.clientHeight>s.scrollTop).length>=3;})()`));
  await ev(`const sc=document.querySelector('.mm-pdf-scroll');sc.scrollTop=sc.querySelector('.page').clientHeight*.63;`);await sleep(300);
  await wait(`[...document.querySelectorAll('.pdfViewer .page')].filter(p=>{const s=p.closest('.mm-pdf-scroll');return p.offsetTop<s.scrollTop+s.clientHeight&&p.offsetTop+p.clientHeight>s.scrollTop;}).every(p=>p.querySelector('canvas')&&p.dataset.loaded==='true')`);
  await ev(`window.__before=structuredClone(Mindmap.state().cur.pdfViews[window.__id]);window.__oldTop=document.querySelector('.mm-pdf-scroll').scrollTop;window.__oldWidth=document.querySelector('.mm-pdf-scroll').clientWidth;`);
  const clip=await ev(`(()=>{const r=document.querySelector('.mm-pdf-scroll').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width)-4,height:Math.floor(r.height),scale:1};})()`),before=(await send('Page.captureScreenshot',{format:'png',clip})).data;
  await leave();
  const after=(await send('Page.captureScreenshot',{format:'png',clip})).data;
  writeFileSync(new URL('./pdf-before-preview.png',import.meta.url),Buffer.from(before,'base64'));writeFileSync(new URL('./pdf-after-preview.png',import.meta.url),Buffer.from(after,'base64'));
  // Downsample both real screenshots to compare document position rather than
  // subpixel text antialiasing (the live text layer and raster preview differ).
  const difference=await ev(`(async()=>{const load=src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src='data:image/png;base64,'+src;}),a=await load(${JSON.stringify(before)}),b=await load(${JSON.stringify(after)}),c=document.createElement('canvas');c.width=Math.ceil(a.width/4);c.height=Math.ceil(a.height/4);const x=c.getContext('2d');x.drawImage(a,0,0,c.width,c.height);const p=x.getImageData(0,0,c.width,c.height).data;x.clearRect(0,0,c.width,c.height);x.drawImage(b,0,0,c.width,c.height);const q=x.getImageData(0,0,c.width,c.height).data;let difference=0;for(let i=0;i<p.length;i++)if(i%4!==3)difference+=Math.abs(p[i]-q[i]);return difference/(p.length*.75);})()`);
  check('实际PDF画面在离开前后保持相同文档区域，而非只保存页码',difference<2,'平均像素差='+difference);
  check('离开后保留页内偏移和跨页区域',await ev(`(()=>{const s=Mindmap.state().cur.pdfViews[window.__id],p=document.querySelector('.mm-pdf-page-preview');return Math.abs(s.offset-window.__before.offset)<.005&&s.top===window.__oldTop&&p.dataset.pages.split(',').length>=3&&!!p.querySelector('canvas');})()`));
  check('离开后释放完整阅览器，保留连续画面预览',await ev(`!document.querySelector('.pdfViewer .page') && !document.querySelector('.mm-pdf-cover').hidden`));
  const image=await ev(`(()=>{const c=document.querySelector('.mm-pdf-page-preview canvas');return {data:c.toDataURL(),w:c.width,h:c.height};})()`);
  check('预览按节点宽高填充，拉高后不会只留单页及大块空白',await ev(`(()=>{const c=document.querySelector('.mm-pdf-page-preview canvas'),r=c.getBoundingClientRect(),s=document.querySelector('.mm-pdf-scroll').getBoundingClientRect();return Math.abs(r.height-s.height)<1 && Math.abs(c.height/c.width-document.querySelector('.mm-pdf-scroll').clientHeight/window.__oldWidth)<.02;})()`));
  await hover();check('再次悬浮精确恢复滚动停止位置',await ev(`Math.abs(document.querySelector('.mm-pdf-scroll').scrollTop-window.__oldTop)<=2`));
  await leave();check('反复悬浮切换不累积滚动位置误差',await ev(`Math.abs(Mindmap.state().cur.pdfViews[window.__id].top-window.__oldTop)<=2`));
  await ev(`Mindmap.editMap(()=>{Mindmap.state().cur.size[window.__id].w=520;});Mindmap.revealBox(Mindmap.state().L.nodes.get(window.__id));`);await wait(`document.querySelector('.mm-pdf-page-preview canvas').width>${image.w}`);
  await hover();check('修改宽度后自适应新宽度，保留原页内比例',await ev(`(()=>{const s=document.querySelector('.mm-pdf-scroll'),p=s.querySelector('.page'),v=Mindmap.state().cur.pdfViews[window.__id];return Math.abs(p.clientWidth-s.clientWidth)<=2 && Math.abs(v.offset-window.__before.offset)<.01 && v.top>window.__oldTop;})()`));
  await ev(`Mindmap.editMap(()=>{Mindmap.state().cur.size[window.__id].w=460;});`);await sleep(150);check('阅读过程中调整节点宽度也会重新适宽',await ev(`(()=>{const s=document.querySelector('.mm-pdf-scroll');return Math.abs(s.querySelector('.page').clientWidth-s.clientWidth)<=2 && Math.abs(Mindmap.state().cur.pdfViews[window.__id].offset-window.__before.offset)<.01;})()`));
  await leave();await ev(`MMFiles.save();window.__saved=structuredClone(Mindmap.state().cur.pdfViews[window.__id]);`);await ev(`Mindmap.open('${id}')`);await ev(`Mindmap.zoom(.32);Mindmap.selectNodes([]);Mindmap.revealBox(Mindmap.state().L.nodes.get(window.__id));`);
  check('重新打开导图，未悬浮前仍显示保存位置和连续多页',await wait(`document.querySelector('.mm-pdf-page-preview').dataset.pages?.split(',').length>=3 && Math.abs(Mindmap.state().cur.pdfViews[window.__id].offset-window.__saved.offset)<.01`));
  await hover();check('重新打开后继续阅读，仍处于保存的页内位置',await ev(`Math.abs(document.querySelector('.mm-pdf-scroll').scrollTop-window.__saved.top)<=2`));
  await leave();
  const exported=await ev(`new Promise(resolve=>{const original=htmlToImage.toCanvas;htmlToImage.toCanvas=async wrapper=>{htmlToImage.toCanvas=original;const e=wrapper.querySelector('.mm-pdf-export'),c=document.createElement('canvas');c.toBlob=()=>resolve(!!e&&e.style.height==='100%'&&!wrapper.querySelector('.mm-pdf-reader'));return c;};document.querySelector('[data-mm="export"]').click();document.querySelector('[data-mm="ex-png"]').click();})`);
  check('PNG导出使用当前连续可见区域',exported);
  check('位置恢复、多页预览和尺寸变化无脚本异常',await ev(`window.__errors.length===0`),await ev(`JSON.stringify(window.__errors)`));
  writeFileSync(new URL('./pdf-position-preview.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
