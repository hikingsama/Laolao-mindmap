(() => {
 'use strict';
 const M=window.Mindmap,K=window.MMNodeKinds,E=s=>window.MMContent.escape(String(s??''));
 function render(nodes,{marks=[]}={}){const n=nodes[0],C=window.MMContextMenus,all=action=>K.shared(nodes,action),single=nodes.length===1,id=n.id;
  let html='';const action=(name,label)=>`<button type="button" data-node-action="${name}" data-id="${E(id)}">${label}</button>`;
  if(single&&K.kind(n)==='reference')html+=action('reference-open','打开目标导图')+action('reference-split','分屏打开')+action('reference-change','更换关联导图')+action('reference-locate','定位到左侧导图库');
  if(single&&K.kind(n)==='image')html+=action('image-view','查看图片');if(single&&K.kind(n)==='pdf')html+=action('pdf-view','打开PDF阅读');
  html+=C.branch('颜色',`<button data-mm="color" data-v="">默认颜色</button>`+C.palette('data-node-color',n.color)+`<label class="mm-ctx-custom">自选颜色 <input type="color" id="mmNodeColorPick" value="${/^#[0-9a-f]{6}$/i.test(n.color||'')?n.color:'#77885e'}" aria-label="节点自选颜色"></label>`,'node-color');
  if(all('marks'))html+=C.branch('标记',`<div class="mm-ctx-marks">${marks.map(([key,icon,name])=>`<button data-mm="mark" data-v="${E(key)}">${E(icon)} ${E(name)}</button>`).join('')}</div><button data-mm="clear-marks">删除所有标记</button>`,'node-marks');
  if(all('progress'))html+=C.branch('进度',[0,25,50,75,100].map(v=>`<button data-mm="prog" data-v="${v}">${v?v+'%':'无进度'}</button>`).join(''),'node-progress');
  html+=(window.MMAlign?.menu()||'');if(all('format'))html+=(window.MMFormat?.menu()||'');if(single&&all('mediaRename'))html+=`<button data-mm="media-rename" data-id="${E(id)}">重命名文件</button>`;
  if(single&&all('math'))html+=`<button data-mm="node-math-review" data-id="${E(id)}">检查数学排版</button>`;
  if(all('autoSize'))html+='<button data-mm="auto-size">恢复内容自适应</button>';if(all('originalRatio'))html+=action('image-size','恢复图片原始比例');
  html+='<button data-mm="new-group">添加到新组</button>';if(single&&all('ask'))html+=`<button data-mm="node-ask" data-id="${E(id)}">✦ 提问</button>`;
  const label=single?({reference:'删除引用卡片',pdf:'删除PDF节点',image:'删除图片节点',text:'删除文字节点'})[K.kind(n)]:`删除选中的 ${nodes.length} 个节点`;
  return html+`<button class="danger" data-mm="del">${label}</button>`;
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-node-action]');if(!b)return;const n=M.findNode(b.dataset.id)?.n;if(!n)return;window.MMContextMenus.hideAll();const action=b.dataset.nodeAction;
  try{
   if(action==='reference-open')await window.MMLibrary.navigate(n.mapLink.mapId);
   if(action==='reference-split')await window.MMLibrary.navigate(n.mapLink.mapId,null,false,true);
   if(action==='reference-change')await window.MMLibrary.chooseReference(n.id);
   if(action==='reference-locate'){const host=window.MMWorkspaceEmbedded?parent.MMWorkspace:window.MMWorkspace;host?.reveal(n.mapLink.mapId);}
   if(action==='pdf-view'&&n.pdf)window.MMPDF.activate(n.id);
   if(action==='image-view'&&n.image){const dlg=document.getElementById('mmDlg');document.getElementById('mmDlgBody').innerHTML=`<h3>查看图片</h3><img src="/api/maps/${encodeURIComponent(M.state().cur.id)}/media/${encodeURIComponent(n.image)}?draft=1" alt="图片原图" style="display:block;max-width:100%;max-height:70vh;object-fit:contain"><button class="mm-b" data-mm="dclose">关闭</button>`;dlg.showModal();}
   if(action==='image-size'){const ids=M.state().selected.filter(id=>M.findNode(id)?.n.image);M.editMap(()=>{const map=M.state().cur;for(const id of ids){const node=M.findNode(id).n,media=(map.media||[]).find(m=>m.id===node.image);if(media?.width>0&&media?.height>0){const ratio=media.height/media.width,k=Math.min(1,7980/(280*ratio));(map.size||={})[id]={w:Math.max(60,Math.round(20+280*k)),h:Math.max(40,Math.round(20+280*ratio*k))};(map.sizing||={})[id]={w:true,h:true};}else{if(map.size)delete map.size[id];if(map.sizing)delete map.sizing[id];}}});}
  }catch(error){window.showBanner(error.message);}
 });
 window.MMNodeMenu={render};
})();
