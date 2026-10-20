(() => {
  "use strict";
  const $=id=>document.getElementById(id), M=()=>window.Mindmap, esc=s=>window.MMContent.escape(String(s));
  let tool="select", color="#b17a63", width=3, selected=null, gesture=null, activeMap=null;
  function current() {return M()?.state().cur;}
  function labelBox(edge,nodes) {
    if(!edge.label) return null;
    const a=nodes.get(edge.from.node),b=nodes.get(edge.to.node);if(!a || !b)return null;
    const points=window.MMEdgeRouter.route(a,b,edge).points, lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
    let left=lengths.reduce((a,b)=>a+b,0)/2, p=points[0];
    for(let i=0;i<lengths.length;i++) {if(left<=lengths[i]){const t=lengths[i]?left/lengths[i]:0;p={x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t};break;}left-=lengths[i];}
    const lines=String(edge.label).split("\n"),w=Math.max(44,Math.min(220,Math.max(...lines.map(s=>Array.from(s).length))*13+20)),h=lines.reduce((n,s)=>n+Math.max(1,Math.ceil(Array.from(s).length/Math.max(1,Math.floor((w-16)/13)))),0)*18+12;
    return {x:p.x-w/2,y:p.y-h/2,w,h};
  }
  const valid=a=>a && ["line","rect","ellipse"].includes(a.type) && [a.x1,a.y1,a.x2,a.y2].every(Number.isFinite);
  function hitTest(cx,cy) {
    if(!current() || !$("mmView"))return null;const p=M().clientPoint(cx,cy),k=M().view().k;
    const distance=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);};
    for(const a of [...(current().annotations || [])].reverse()) {
      if(!valid(a))continue;let points;
      if(a.type==="line")points=[{x:a.x1,y:a.y1},{x:a.x2,y:a.y2}];
      else if(a.type==="rect")points=[{x:a.x1,y:a.y1},{x:a.x2,y:a.y1},{x:a.x2,y:a.y2},{x:a.x1,y:a.y2},{x:a.x1,y:a.y1}];
      else {const x=(a.x1+a.x2)/2,y=(a.y1+a.y2)/2,rx=Math.abs(a.x2-a.x1)/2,ry=Math.abs(a.y2-a.y1)/2;points=Array.from({length:97},(_,i)=>({x:x+rx*Math.cos(i*Math.PI/48),y:y+ry*Math.sin(i*Math.PI/48)}));}
      const radius=Math.max(12,Math.min(40,Number(a.width)||3)*k/2+8);
      if(points.slice(1).some((b,i)=>distance(points[i],b)*k<=radius))return a;
    }
    return null;
  }
  function shape(a,extra="",hit=false) {
    if(!valid(a)) return "";
    const c=/^#[0-9a-f]{6}$/i.test(a.color)?a.color:color,sw=Math.max(1,Math.min(40,Number(a.width)||3)),x=Math.min(a.x1,a.x2),y=Math.min(a.y1,a.y2),w=Math.abs(a.x2-a.x1),h=Math.abs(a.y2-a.y1);
    const attrs=`data-annotation="${esc(a.id)}" class="${hit?"mm-mark-hit":"mm-mark"}${!hit && a.id===selected?" selected":""}" fill="none" stroke="${hit?"transparent":c}" stroke-width="${hit?Math.max(24,sw*M().view().k+16):sw}" ${hit?'vector-effect="non-scaling-stroke"':''} ${extra}`;
    if(a.type==="line")return `<line ${attrs} x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}"/>`;
    if(a.type==="rect")return `<rect ${attrs} x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    return `<ellipse ${attrs} cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}"/>`;
  }
  function extendBounds(lay) {
    const boxes=(current()?.annotations || []).filter(valid).map(a=>{const width=Math.max(1,Math.min(40,Number(a.width)||3));return {x:Math.min(a.x1,a.x2)-width,y:Math.min(a.y1,a.y2)-width,w:Math.abs(a.x2-a.x1)+width*2,h:Math.abs(a.y2-a.y1)+width*2};});
    for(const edge of current()?.edges || []) {const box=labelBox(edge,lay.nodes);if(box)boxes.push(box);}
    for(const b of boxes) {lay.bounds.x0=Math.min(lay.bounds.x0,b.x);lay.bounds.y0=Math.min(lay.bounds.y0,b.y);lay.bounds.x1=Math.max(lay.bounds.x1,b.x+b.w);lay.bounds.y1=Math.max(lay.bounds.y1,b.y+b.h);}
  }
  function toolbar() {
    const tools=document.querySelector(".mm-tools");if(!tools || $("mmMarkTools"))return;
    const group=document.createElement("div");group.id="mmMarkTools";group.className="mm-tg mm-mark-tools";
    group.innerHTML=`<span class="mm-tool-caption">线标</span><button class="mm-b" data-mark-tool="select" title="选择线标 / Esc">选择</button><button class="mm-b" data-mark-tool="line">直线</button><button class="mm-b" data-mark-tool="rect">方框</button><button class="mm-b" data-mark-tool="ellipse">圆框</button><input id="mmMarkColor" type="color" value="${color}" aria-label="线标颜色"><label>粗细 <select id="mmMarkWidth" aria-label="线标粗细">${[1,2,3,4,6,8,12,20].map(n=>`<option value="${n}" ${n===width?"selected":""}>${n}</option>`).join("")}</select></label>`;
    tools.appendChild(group);
    group.addEventListener("click",e=>{const b=e.target.closest("[data-mark-tool]");if(b){tool=b.dataset.markTool;selected=null;gesture=null;render();}else if(e.target.closest("#mmMarkDelete"))remove();});
    group.addEventListener("change",e=>{color=$("mmMarkColor").value;width=Number($("mmMarkWidth").value);if(selected)M().editMap(()=>{const a=(current().annotations||[]).find(a=>a.id===selected);if(a){a.color=color;a.width=width;}});});
  }
  function render() {
    const st=$("mmStage"),map=current();if(!st || !map)return;toolbar();
    if(activeMap!==map.id) {activeMap=map.id;tool="select";gesture=null;selected=null;$("mmMarkMenu")?.classList.add("hidden");}
    st.querySelectorAll(".mm-edge-label,.mm-annotations").forEach(el=>el.remove());
    for(const edge of map.edges || []) {const b=labelBox(edge,M().state().L.nodes);if(!b)continue;const label=document.createElement("button");label.type="button";label.className="mm-edge-label";label.dataset.edgeLabel=edge.id;label.textContent=edge.label;label.title="双击修改文字标记";label.style.cssText=`left:${b.x}px;top:${b.y}px;width:${b.w}px;min-height:${b.h}px`;st.appendChild(label);}
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.classList.add("mm-annotations");svg.setAttribute("width","1");svg.setAttribute("height","1");
    svg.innerHTML=(map.annotations || []).map(a=>shape(a,"",true)+shape(a)).join("")+(gesture?shape(gesture.preview,'data-preview="true"'):"");st.appendChild(svg);
    $("mmView").classList.toggle("mm-drawing",tool!=="select");
    document.querySelectorAll("[data-mark-tool]").forEach(b=>b.classList.toggle("active",b.dataset.markTool===tool));
    if(!$("mmView").dataset.markBound)bind();
  }
  function bind() {
    const view=$("mmView");view.dataset.markBound="true";
    view.addEventListener("pointerdown",e=>{
      if(e.button!==0 || e.target.closest(".mm-zoom,.mm-edit,.mm-edit-preview,.mm-edit-help,.mm-hint,.mm-task,.mm-formatbar"))return;
      const label=e.target.closest("[data-edge-label]");if(label){e.stopImmediatePropagation();e.preventDefault();return;}
      const hit=hitTest(e.clientX,e.clientY),point=M().clientPoint(e.clientX,e.clientY);
      if(tool!=="select" || hit) {
        e.stopImmediatePropagation();e.preventDefault();view.focus();
        M().selectNodes([]);
        const original=hit;
        if(tool==="select" && original) {selected=original.id;color=original.color;width=original.width;syncStyleControls();gesture={start:point,original:{...original},preview:{...original},map:current().id,pointer:e.pointerId};}
        else {selected=null;gesture={start:point,preview:{id:crypto.randomUUID(),type:tool,x1:point.x,y1:point.y,x2:point.x,y2:point.y,color,width},map:current().id,pointer:e.pointerId};}
        view.setPointerCapture(e.pointerId);render();
      } else if(selected){selected=null;render();}
    },true);
    view.addEventListener("pointermove",e=>{
      if(!gesture || gesture.pointer!==e.pointerId){view.classList.toggle("mm-mark-hover",tool==="select" && !e.target.closest(".mm-zoom,.mm-edit,.mm-edit-preview,.mm-edit-help") && !!hitTest(e.clientX,e.clientY));return;}e.stopImmediatePropagation();
      const p=M().clientPoint(e.clientX,e.clientY),g=gesture;
      if(g.original) {const dx=p.x-g.start.x,dy=p.y-g.start.y;g.preview={...g.original,x1:g.original.x1+dx,y1:g.original.y1+dy,x2:g.original.x2+dx,y2:g.original.y2+dy};}
      else {g.preview.x2=p.x;g.preview.y2=p.y;}
      render();
    },true);
    const up=e=>{if(!gesture || gesture.pointer!==e.pointerId)return;e.stopImmediatePropagation();const g=gesture;gesture=null;
      if(e.type!=="pointercancel" && current()?.id===g.map && Math.hypot(g.preview.x2-g.preview.x1,g.preview.y2-g.preview.y1)>4) {
        selected=g.preview.id;M().editMap(()=>{const list=(current().annotations ||= []),i=list.findIndex(a=>a.id===g.preview.id);if(i>=0)list[i]=g.preview;else list.push(g.preview);});
      } else render();
      if(view.hasPointerCapture(e.pointerId))view.releasePointerCapture(e.pointerId);
    };
    view.addEventListener("pointerup",up,true);view.addEventListener("pointercancel",up,true);
    view.addEventListener("dblclick",e=>{const label=e.target.closest("[data-edge-label]");if(label){e.stopImmediatePropagation();e.preventDefault();editEdgeLabel(label.dataset.edgeLabel);}else if(tool!=="select" || hitTest(e.clientX,e.clientY)){e.stopImmediatePropagation();e.preventDefault();}},true);
    view.addEventListener("contextmenu",e=>{if(e.target.closest(".mm-zoom,.mm-edit,.mm-edit-preview,.mm-edit-help"))return;const a=hitTest(e.clientX,e.clientY);if(a){e.preventDefault();e.stopImmediatePropagation();showMarkMenu(a,e.clientX,e.clientY);}},true);
    view.addEventListener("wheel",()=>$("mmMarkMenu")?.classList.add("hidden"),true);
    view.addEventListener("pointerleave",()=>view.classList.remove("mm-mark-hover"));
  }
  function syncStyleControls() {
    $("mmMarkColor").value=color;const el=$("mmMarkWidth");
    if(![...el.options].some(o=>Number(o.value)===width)){const option=document.createElement("option");option.value=String(width);option.textContent=String(width);el.appendChild(option);}el.value=String(width);
  }
  function showMarkMenu(a,cx,cy) {
    window.MMContextMenus.hideAll();M().selectNodes([]);selected=a.id;color=a.color;width=a.width;syncStyleControls();render();
    let menu=$("mmMarkMenu");if(!menu){menu=document.createElement("div");menu.id="mmMarkMenu";menu.className="mm-ctx";$("mmBox").appendChild(menu);}
    const C=window.MMContextMenus;
    menu.innerHTML=C.branch("颜色",C.palette('data-mark-color',a.color)+`<label class="mm-ctx-custom">自选颜色 <input id="mmMarkMenuColor" type="color" value="${a.color}" aria-label="线标自选颜色"></label>`,"mark-color")+
      `<label class="mm-ctx-width">粗细 <input id="mmMarkMenuWidth" type="number" min="1" max="40" step="1" value="${a.width}" aria-label="线标粗细输入"> px</label><button class="danger" data-mark-delete>删除线标</button>`;
    const apply=(field,value)=>{const mark=(current()?.annotations || []).find(m=>m.id===selected);if(!mark)return;M().editMap(()=>{mark[field]=value;});color=mark.color;width=mark.width;syncStyleControls();};
    menu.onclick=e=>{const b=e.target.closest("[data-mark-color]");if(b){apply("color",b.dataset.markColor);C.hideAll();}if(e.target.closest("[data-mark-delete]")){remove();C.hideAll();}};
    menu.onchange=e=>{if(e.target.id==="mmMarkMenuColor") {apply("color",e.target.value);C.hideAll();}if(e.target.id==="mmMarkMenuWidth") {const n=Number(e.target.value);if(!Number.isFinite(n) || !e.target.value){e.target.value=String(width);return;}const value=Math.max(1,Math.min(40,Math.round(n)));e.target.value=String(value);apply("width",value);}};
    menu.onkeydown=e=>{if(e.key==="Enter" && e.target.id==="mmMarkMenuWidth"){e.preventDefault();e.target.blur();C.hideAll();}};
    C.place(menu,cx,cy);
  }
  function remove(){if(!selected || !current())return;const id=selected;selected=null;M().editMap(()=>{current().annotations=(current().annotations||[]).filter(a=>a.id!==id);});}
  function editEdgeLabel(id) {
    const map=current(),edge=map?.edges.find(e=>e.id===id);if(!edge)return;
    const dlg=$("mmDlg");$("mmDlgBody").innerHTML=`<form id="mmEdgeLabelForm"><h3>箭头文字标记</h3><textarea id="mmEdgeLabelInput" rows="3" maxlength="500" placeholder="输入文字；留空保存可移除标记">${esc(edge.label || "")}</textarea><div class="mm-label-buttons"><button class="mm-b" type="button" id="mmEdgeLabelCancel">取消</button><button class="mm-b pri" type="submit">保存</button></div></form>`;
    $("mmEdgeLabelCancel").onclick=()=>dlg.close();$("mmEdgeLabelForm").onsubmit=e=>{e.preventDefault();if(current()?.id!==map.id || !map.edges.includes(edge)){dlg.close();return;}const text=$("mmEdgeLabelInput").value.trim();M().editMap(()=>{if(text)edge.label=text;else delete edge.label;});dlg.close();};
    dlg.showModal();$("mmEdgeLabelInput").focus();
  }
  document.addEventListener("keydown",e=>{
    if(current() && (e.ctrlKey || e.metaKey) && ["=","+","-"].includes(e.key) && !e.target.closest("#mmAI,#mmShortcuts,#mmPanel,#mmMediaPanel,input:not(.mm-edit),dialog")) {e.preventDefault();e.stopImmediatePropagation();M().zoom(M().view().k*(e.key==="-"?1/1.2:1.2));return;}
    if(!current() || e.target.closest("input,textarea,[contenteditable=true],#mmAI") || $("mmDlg").open)return;
    if(e.key==="Escape" && (gesture || tool!=="select" || selected)){e.preventDefault();e.stopImmediatePropagation();gesture=null;tool="select";selected=null;render();}
    else if(selected && ["Delete","Backspace"].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();remove();}
  },true);
  function clearSelection(){selected=null;document.querySelectorAll(".mm-mark.selected").forEach(el=>el.classList.remove("selected"));}
  window.MMCanvasTools={render,extendBounds,editEdgeLabel,labelBox,hitTest,clearSelection};
})();
