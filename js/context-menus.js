(() => {
  "use strict";
  const esc=s=>window.esc(String(s));
  const colors=["#77885e","#6c8a94","#b17a63","#a18db1","#b39758","#749385","#a27c87","#838d70","#ad6c62","#343b2e","#9b9e8f","#ffffff"];
  function hideAll(){document.querySelectorAll(".mm-ctx").forEach(el=>el.classList.add("hidden"));}
  function branch(label,html,name){return `<div class="mm-ctx-branch" tabindex="0" data-submenu="${name}"><span>${esc(label)}</span><span aria-hidden="true">›</span><div class="mm-ctx-submenu">${html}</div></div>`;}
  function palette(action,current,extra="") {return `<div class="mm-ctx-palette">${colors.map(c=>`<button type="button" class="mm-color-swatch${c===current?" on":""}" ${action}="${c}" style="background:${c}" title="${c}" aria-label="${c}" ${extra}></button>`).join("")}</div>`;}
  function place(menu,cx,cy) {
    const box=document.getElementById("mmBox"),r=box.getBoundingClientRect();menu.classList.remove("hidden");
    menu.style.left=Math.max(4,Math.min(cx-r.left,r.width-menu.offsetWidth-4))+"px";menu.style.top=Math.max(4,Math.min(cy-r.top,r.height-menu.offsetHeight-4))+"px";
    for(const branch of menu.querySelectorAll(".mm-ctx-branch")) {
      const adjust=()=>{const sub=branch.querySelector(".mm-ctx-submenu");sub.style.top="-5px";branch.classList.remove("opens-left");if(sub.getBoundingClientRect().right>window.innerWidth-8)branch.classList.add("opens-left");const b=sub.getBoundingClientRect();if(b.bottom>window.innerHeight-8)sub.style.top=(-5-(b.bottom-window.innerHeight+8))+"px";};
      branch.addEventListener("mouseenter",adjust);branch.addEventListener("focusin",adjust);
    }
  }
  document.addEventListener("pointerdown",e=>{if(!e.target.closest(".mm-ctx"))hideAll();},true);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")hideAll();});
  window.MMContextMenus={branch,palette,place,hideAll};
})();
