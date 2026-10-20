export async function run({ev,send,sleep,clickSel,check}){
  const id='wheel-'+Date.now(),long=Array.from({length:60},(_,i)=>'第'+i+'行内容').join('\n');
  const point=(x,y)=>ev(`(()=>{const r=document.getElementById('mmView').getBoundingClientRect(),v=Mindmap.view();return {x:r.left+v.x+${x}*v.k,y:r.top+v.y+${y}*v.k};})()`);
  const wheel=async(p,dx,dy,modifiers=0)=>{await send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:dx,deltaY:dy,modifiers});await sleep(25);};
  const reset=async()=>{await ev(`Mindmap.refresh();Mindmap.zoom(1);Mindmap.revealBox({x:0,y:0,w:650,h:220});window.__v=Mindmap.view()`);await sleep(250);};
  await ev(`Mindmap.openDocument({id:'${id}',title:'连续滚动验证',v:3,flat:true,nodes:[{id:'a',text:${JSON.stringify(long)},children:[]},{id:'b',text:${JSON.stringify(long)},children:[]}],pos:{a:{x:0,y:0},b:{x:370,y:0}},size:{a:{w:240,h:140},b:{w:240,h:140}},sizing:{a:{w:true,h:true},b:{w:true,h:true}},edges:[]})`);
  await reset();await wheel(await point(100,220),0,40);await wheel(await point(100,70),0,40);
  check('从空白开始滚动，进入溢出节点后仍平移画布',await ev(`Mindmap.view().y===window.__v.y-80 && document.querySelector('[data-id="a"] .mm-rich').scrollTop===0`));
  await sleep(250);await ev(`window.__v=Mindmap.view()`);await wheel(await point(100,70),0,50);
  check('短暂停顿后可重新进入节点内部滚动',await ev(`Mindmap.view().y===window.__v.y && document.querySelector('[data-id="a"] .mm-rich').scrollTop>0`));
  await wheel(await point(450,70),0,50);
  check('同一连续手势跨过第二节点时仍滚动起始节点',await ev(`document.querySelector('[data-id="a"] .mm-rich').scrollTop>=100 && document.querySelector('[data-id="b"] .mm-rich').scrollTop===0 && Mindmap.view().y===window.__v.y`));
  await ev(`document.querySelector('[data-id="a"] .mm-rich').scrollTop=100000`);await wheel(await point(100,220),0,50);
  check('内部滚动到边界且指针移到空白时不接力平移画布',await ev(`Mindmap.view().y===window.__v.y`));
  await reset();await wheel(await point(100,220),0,40);await clickSel('.mm-node[data-id="a"]');await ev(`window.__v=Mindmap.view()`);await wheel(await point(100,70),0,50);
  check('点按可立即结束旧滚动手势并重新决定目标',await ev(`Mindmap.view().y===window.__v.y && document.querySelector('[data-id="a"] .mm-rich').scrollTop>0`));
  await reset();await wheel(await point(100,220),0,40);const k=await ev(`Mindmap.view().k`);await wheel(await point(100,70),0,-60,2);
  check('连续平移期间Ctrl滚轮立即切换为画布缩放',await ev(`Mindmap.view().k>${k}`));
  await reset();await wheel(await point(100,220),35,0);await wheel(await point(100,70),35,0);
  check('触摸板横向平移跨入节点也不会被内部滚动截断',await ev(`Mindmap.view().x===window.__v.x-70`));
}
