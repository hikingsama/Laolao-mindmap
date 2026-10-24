/* Spatial membership is derived from geometry; no node coordinates or parent IDs
   are stored on nodes. A gesture snapshots its members and commits one undo step. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id), M = () => window.Mindmap;
  const esc = s => window.esc(String(s ?? ""));
  let activeMap = null, selected = null, gesture = null, suppressContext = false, contextTimer = 0;
  const current = () => M()?.state().cur;
  const valid = g => g && typeof g.id === "string" && [g.x,g.y,g.w,g.h].every(Number.isFinite) && g.w >= 64 && g.h >= 60;
  const groups = () => (current()?.groups || []).filter(valid);
  const contains = (a,b) => b.x >= a.x && b.y >= a.y && b.x+b.w <= a.x+a.w && b.y+b.h <= a.y+a.h;
  const intersects = (a,b) => b.x <= a.x+a.w && b.x+b.w >= a.x && b.y <= a.y+a.h && b.y+b.h >= a.y;
  const colorOf = g => /^#[0-9a-f]{6}$/i.test(g.color || "") ? g.color : "#83956b";
  const widthOf = g => Math.max(1,Math.min(12,Number(g.width) || 2));
  const opacityOf = g => Math.max(4,Math.min(35,Number(g.opacity) || 10));
  function members(group) {
    const nodes = [...(M().state().L?.nodes.values() || [])].filter(n => contains(group,n)).map(n => n.n.id);
    const frames = groups().filter(g => g.id !== group.id && g.w*g.h < group.w*group.h && contains(group,g)).map(g => g.id);
    return {nodes,groups:frames};
  }
  function clearSelection() {
    selected = null;
    document.querySelectorAll(".mm-group-frame.selected,.mm-group-label.selected").forEach(el => el.classList.remove("selected"));
  }
  function select(id) {
    if (!groups().some(g => g.id === id)) return;
    M().selectNodes([]); selected = id;
    document.querySelectorAll(".mm-group-frame").forEach(el=>el.classList.toggle("selected",el.dataset.group===id));
    document.querySelectorAll(".mm-group-label").forEach(el=>el.classList.toggle("selected",el.dataset.groupLabel===id));
    $("mmView")?.focus({preventScroll:true});
  }
  function create() {
    const state = M().state(), boxes = state.selected.map(id => state.L.nodes.get(id)).filter(Boolean);
    if (!boxes.length) return;
    // Leave room for an existing inner frame and its label when grouping its nodes.
    boxes.push(...groups().filter(g=>{const ids=members(g).nodes;return ids.length && ids.every(id=>state.selected.includes(id));}));
    const x = Math.min(...boxes.map(b=>b.x))-28, y = Math.min(...boxes.map(b=>b.y))-52;
    let number = 1; const names = new Set(groups().map(g=>g.title)); while(names.has("组 "+number)) number++;
    const group = {id:crypto.randomUUID(),title:"组 "+number,x,y,w:Math.max(100,Math.max(...boxes.map(b=>b.x+b.w))+28-x),h:Math.max(80,Math.max(...boxes.map(b=>b.y+b.h))+28-y),color:"#83956b",opacity:6,width:1};
    M().editMap(()=>{(current().groups ||= []).push(group);}); select(group.id);
    M().ensureVisible({x:group.x,y:group.y-40,w:Math.min(group.w,180),h:36});
  }
  function remove() {
    if (!selected) return; const id = selected; clearSelection();
    M().editMap(()=>{current().groups = (current().groups || []).filter(g=>g.id !== id);});
    window.MMContextMenus.hideAll();
  }
  function rename(id) {
    const group = groups().find(g=>g.id===id); if (!group) return;
    const mapId = current().id, dialog = $("mmDlg");
    $("mmDlgBody").innerHTML = `<form id="mmGroupNameForm"><h3>分组名称</h3><input id="mmGroupName" maxlength="80" value="${esc(group.title || "未命名组")}" aria-label="分组名称"><div class="mm-label-buttons"><button type="button" class="mm-b" id="mmGroupNameCancel">取消</button><button type="submit" class="mm-b pri">保存</button></div></form>`;
    $("mmGroupNameCancel").onclick=()=>dialog.close();
    $("mmGroupNameForm").onsubmit=e=>{e.preventDefault();const title=$("mmGroupName").value.trim();if(!title){$("mmGroupName").focus();return;}if(current()?.id===mapId && groups().includes(group))M().editMap(()=>{group.title=title;});dialog.close();};
    dialog.showModal(); $("mmGroupName").focus(); $("mmGroupName").select();
  }
  function showMenu(id,cx,cy) {
    select(id); const g = groups().find(g=>g.id===id); if (!g) return;
    const C=window.MMContextMenus; C.hideAll(); let menu=$("mmGroupMenu");
    if(!menu){menu=document.createElement("div");menu.id="mmGroupMenu";menu.className="mm-ctx";$("mmBox").appendChild(menu);}
    menu.innerHTML=C.branch("颜色",C.palette("data-group-color",colorOf(g))+`<label class="mm-ctx-custom">自选颜色 <input id="mmGroupColor" type="color" value="${colorOf(g)}" aria-label="底框颜色"></label>`,"group-color")+
      `<label class="mm-ctx-width">边框粗细 <input id="mmGroupWidth" type="number" min="1" max="12" value="${widthOf(g)}" aria-label="底框粗细"> px</label><label class="mm-ctx-width">底色浓度 <input id="mmGroupOpacity" type="number" min="4" max="35" value="${opacityOf(g)}" aria-label="底色浓度"> %</label><button data-group-action="rename">修改名称</button><button class="danger" data-group-action="delete">删除底框</button>`;
    const apply=(key,value)=>M().editMap(()=>{g[key]=value;});
    menu.onclick=e=>{const color=e.target.closest("[data-group-color]");if(color){apply("color",color.dataset.groupColor);C.hideAll();}const action=e.target.closest("[data-group-action]")?.dataset.groupAction;if(action==="delete")remove();if(action==="rename"){C.hideAll();rename(id);}};
    menu.onchange=e=>{if(e.target.id==="mmGroupColor"){apply("color",e.target.value);C.hideAll();}for(const [input,key,min,max] of [["mmGroupWidth","width",1,12],["mmGroupOpacity","opacity",4,35]])if(e.target.id===input){const value=Number(e.target.value);if(!e.target.value || !Number.isFinite(value)){e.target.value=String(g[key] || min);return;}const n=Math.max(min,Math.min(max,Math.round(value)));e.target.value=String(n);apply(key,n);}};
    C.place(menu,cx,cy);
  }
  function extendBounds(lay) {
    for(const g of groups()) {lay.bounds.x0=Math.min(lay.bounds.x0,g.x-8);lay.bounds.y0=Math.min(lay.bounds.y0,g.y-40);lay.bounds.x1=Math.max(lay.bounds.x1,g.x+g.w+8);lay.bounds.y1=Math.max(lay.bounds.y1,g.y+g.h+8);}
  }
  function render() {
    const map=current(),stage=$("mmStage"); if(!map || !stage)return;
    if(activeMap !== map.id){activeMap=map.id;selected=null;gesture=null;suppressContext=false;}
    if(selected && !groups().some(g=>g.id===selected))clearSelection();
    stage.querySelectorAll(".mm-group-frame,.mm-group-label").forEach(el=>el.remove());
    const k=M().view().k;
    // Larger backgrounds go first; smaller nested frames remain visible above them.
    const backgrounds=document.createDocumentFragment();
    for(const g of groups().sort((a,b)=>b.w*b.h-a.w*a.h)){
      const frame=document.createElement("div");frame.className="mm-group-frame"+(g.id===selected?" selected":"");frame.dataset.group=g.id;
      frame.style.cssText=`left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;--group-color:${colorOf(g)};--group-fill:${colorOf(g)}${Math.round(opacityOf(g)*2.55).toString(16).padStart(2,"0")};--group-width:${widthOf(g)}px;--group-hit:${12/k}px;--group-grip:${7/k}px`;
      frame.innerHTML=["n","s","e","w","nw","ne","sw","se"].map(dir=>`<i class="mm-group-handle ${dir}" data-group="${esc(g.id)}" data-group-resize="${dir}"></i>`).join("");
      backgrounds.appendChild(frame);
      const label=document.createElement("button");label.className="mm-group-label"+(g.id===selected?" selected":"");label.type="button";label.dataset.groupLabel=g.id;label.textContent=(Number.isInteger(g.moduleOrder)?String(g.moduleOrder).padStart(2,"0")+" · ":"")+(g.title || "未命名组");label.title="拖动标签移动整组 · 双击改名 · 右键修改样式";
      label.style.cssText=`left:${g.x}px;top:${g.y-36}px;max-width:${g.w}px;--group-color:${colorOf(g)}`;stage.appendChild(label);
    }
    stage.prepend(backgrounds);
    if(!$("mmView").dataset.groupBound)bind();
  }
  function nodeAt(cx,cy){const p=M().clientPoint(cx,cy);return [...M().state().L.nodes.values()].some(b=>p.x>=b.x && p.x<=b.x+b.w && p.y>=b.y && p.y<=b.y+b.h);}
  function marquee(g,p){return {x:Math.min(g.start.x,p.x),y:Math.min(g.start.y,p.y),w:Math.abs(p.x-g.start.x),h:Math.abs(p.y-g.start.y)};}
  function paintMarquee(g,p) {
    const b=marquee(g,p),ids=[...M().state().L.nodes.values()].filter(n=>intersects(b,n)).map(n=>n.n.id);
    M().selectNodes([...new Set([...g.base,...ids])]);
    let el=$("mmMarquee");if(!el){el=document.createElement("div");el.id="mmMarquee";el.className="mm-marquee";$("mmView").appendChild(el);}
    const v=M().view();el.style.cssText=`left:${v.x+b.x*v.k}px;top:${v.y+b.y*v.k}px;width:${b.w*v.k}px;height:${b.h*v.k}px`;
  }
  function block(e){e.preventDefault();e.stopImmediatePropagation();}
  function bind() {
    const view=$("mmView");view.dataset.groupBound="true";
    view.addEventListener("pointerdown",e=>{if(window.MMTopicUI?.mode==='overview')return;
      if(e.button===2){suppressContext=false;clearTimeout(contextTimer);}
      if(M().state().editing || e.target.closest(".mm-zoom,.mm-edit,.mm-edit-preview,.mm-edit-help,.mm-hint,.mm-task,.mm-formatbar"))return;
      const label=e.target.closest("[data-group-label]"),handle=e.target.closest("[data-group-resize]");
      if(e.button===0 && (label || handle) && !window.MMCanvasTools?.hitTest(e.clientX,e.clientY)){
        block(e);const id=label?.dataset.groupLabel || handle.dataset.group,g=groups().find(g=>g.id===id);if(!g)return;
        select(id);gesture={type:handle?"resize":"move",pointer:e.pointerId,start:M().clientPoint(e.clientX,e.clientY),cx:e.clientX,cy:e.clientY,map:current().id,snap:JSON.stringify(current()),original:{...g},members:members(g),moved:false,dir:handle?.dataset.groupResize};
        gesture.before=JSON.parse(gesture.snap);
        view.setPointerCapture(e.pointerId);return;
      }
      if(e.button===2 && !label && !handle && !nodeAt(e.clientX,e.clientY) && !window.MMCanvasTools?.hitTest(e.clientX,e.clientY) && !e.target.closest("[data-edge-label],[data-image-label]")){
        block(e);window.MMContextMenus.hideAll();view.focus({preventScroll:true});
        suppressContext=false;gesture={type:"marquee",pointer:e.pointerId,start:M().clientPoint(e.clientX,e.clientY),cx:e.clientX,cy:e.clientY,map:current().id,base:e.ctrlKey || e.metaKey?M().state().selected:[],before:M().state().selected,moved:false};
        view.setPointerCapture(e.pointerId);
      }
    },true);
    view.addEventListener("pointermove",e=>{if(window.MMTopicUI?.mode==='overview')return;
      const g=gesture;if(!g || e.pointerId!==g.pointer){if(e.target.closest("[data-group-label],[data-group-resize]")){view.classList.remove("mag-pointer","mm-mark-hover");e.stopImmediatePropagation();}return;}
      block(e);if(current()?.id!==g.map)return;
      if(!g.moved && Math.hypot(e.clientX-g.cx,e.clientY-g.cy)<5)return;g.moved=true;
      const p=M().clientPoint(e.clientX,e.clientY);
      if(g.type==="marquee"){paintMarquee(g,p);return;}
      const map=current(),o=g.original,frame=groups().find(f=>f.id===o.id);if(!frame)return;
      const dx=Math.round(p.x-g.start.x),dy=Math.round(p.y-g.start.y),before=g.before;
      if(g.type==="move"){
        frame.x=o.x+dx;frame.y=o.y+dy;
        for(const id of g.members.nodes){const at=before.pos[id];if(at)map.pos[id]={x:at.x+dx,y:at.y+dy};}
        for(const id of g.members.groups){const at=before.groups.find(f=>f.id===id),f=groups().find(f=>f.id===id);if(at && f){f.x=at.x+dx;f.y=at.y+dy;}}
      } else {
        const w=g.dir.includes("w"),n=g.dir.includes("n");
        frame.w=Math.max(64,o.w+(g.dir.includes("e")?dx:w?-dx:0));frame.h=Math.max(60,o.h+(g.dir.includes("s")?dy:n?-dy:0));
        frame.x=w?o.x+o.w-frame.w:o.x;frame.y=n?o.y+o.h-frame.h:o.y;
      }
      M().preview();
    },true);
    const up=e=>{if(window.MMTopicUI?.mode==='overview')return;
      const g=gesture;if(!g || e.pointerId!==g.pointer)return;block(e);gesture=null;
      if(current()?.id===g.map){if(g.type==="marquee"){
        $("mmMarquee")?.remove();if(e.type==="pointercancel")M().selectNodes(g.before);else if(g.moved){paintMarquee(g,M().clientPoint(e.clientX,e.clientY));$("mmMarquee")?.remove();}
        suppressContext=g.moved;clearTimeout(contextTimer);contextTimer=setTimeout(()=>{suppressContext=false;},500);
      }else if(g.moved) M().commitPreview(g.snap,e.type==="pointercancel");}
      if(view.hasPointerCapture(e.pointerId))view.releasePointerCapture(e.pointerId);
    };
    view.addEventListener("pointerup",up,true);view.addEventListener("pointercancel",up,true);
    view.addEventListener("contextmenu",e=>{if(window.MMTopicUI?.mode==='overview')return;
      if(e.target.closest(".mm-edit,.mm-edit-preview"))return;
      e.preventDefault();
      if(suppressContext || gesture?.type==="marquee"){e.stopImmediatePropagation();return;}
      if(window.MMCanvasTools?.hitTest(e.clientX,e.clientY))return;
      const label=e.target.closest("[data-group-label]");if(label){e.stopImmediatePropagation();showMenu(label.dataset.groupLabel,e.clientX,e.clientY);}
    },true);
    view.addEventListener("dblclick",e=>{if(window.MMTopicUI?.mode==='overview')return;const label=e.target.closest("[data-group-label]") || [...view.querySelectorAll("[data-group-label]")].reverse().find(el=>{const r=el.getBoundingClientRect();return e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;});if(label){block(e);rename(label.dataset.groupLabel);}else if(e.target.closest("[data-group-resize]"))block(e);},true);
    view.addEventListener("wheel",()=>window.MMContextMenus.hideAll(),true);
  }
  document.addEventListener("keydown",e=>{if(window.MMTopicUI?.mode==='overview')return;
    if(!current() || e.target.closest("input,textarea,[contenteditable=true],#mmAI,#mmShortcuts") || $("mmDlg").open)return;
    if(gesture && e.key==="Escape"){
      block(e);const g=gesture;gesture=null;$("mmMarquee")?.remove();if(g.type==="marquee")M().selectNodes(g.before);else M().commitPreview(g.snap,true);return;
    }
    if(gesture){block(e);return;}
    if(selected && ["Delete","Backspace"].includes(e.key)){block(e);remove();}
    else if(selected && e.key==="Escape"){clearSelection();render();}
  },true);
  function reset(){activeMap=null;selected=null;gesture=null;suppressContext=false;clearTimeout(contextTimer);$("mmMarquee")?.remove();}
  window.MMGroups={render,extendBounds,create,select,clearSelection,reset,members,contains,intersects,state:()=>({selected,gesture:gesture?.type || null})};
})();
