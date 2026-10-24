(() => {
  const M=()=>window.Mindmap,defaults={fontSize:16};
  const replace=(ta,text,mode='select')=>ta.setRangeText(text,ta.selectionStart,ta.selectionEnd,mode);
  function style(n){return {fontSize:Number.isFinite(n?.fontSize)?Math.min(48,Math.max(10,n.fontSize)):16};}
  function apply(n,value){const s=style(value);delete n.textAlign;delete n.verticalAlign;for(const key of Object.keys(defaults))if(s[key]===defaults[key])delete n[key];else n[key]=s[key];}
  function ranges(src){
    const result=[];let pos=0;while(pos<src.length){
      if(src[pos]==='\\' && !['(','['].includes(src[pos+1])){pos+=2;continue;}
      const fence=(pos===0 || src[pos-1]==='\n') && /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(src.slice(pos));
      if(fence){const marker=fence[2],close=new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}[^\\S\\n]*$','gm');close.lastIndex=pos+fence[0].length;const end=close.exec(src);result.push({start:pos,end:end?end.index+end[0].length:src.length,block:true});pos=result.at(-1).end;continue;}
      if(src[pos]==='`'){const marker=/^`+/.exec(src.slice(pos))[0],end=src.indexOf(marker,pos+marker.length);result.push({start:pos,end:end<0?src.length:end+marker.length,block:false});pos=result.at(-1).end;continue;}
      const open=src.startsWith('$$',pos)?'$$':src.startsWith('\\[',pos)?'\\[':src.startsWith('\\(',pos)?'\\(':src[pos]==='$'?'$':null;
      if(open){const close=open==='\\['?'\\]':open==='\\('?'\\)':open;let end=pos+open.length;while((end=src.indexOf(close,end))>=0){let slash=0;for(let i=end-1;i>=0 && src[i]==='\\';i--)slash++;if(!(slash%2))break;end+=close.length;}result.push({start:pos,end:end<0?src.length:end+close.length,block:open==='$$'||open==='\\['});pos=result.at(-1).end;continue;}
      pos++;
    }return result;
  }
  function safe(ta,start,end,lines=false){const protectedAreas=ranges(ta.value);return !protectedAreas.some(r=>r.block?(start<r.end&&end>r.start || start===end&&start>=r.start&&start<r.end):lines?false:(start>r.start&&start<r.end || end>r.start&&end<r.end || start===end&&start>=r.start&&start<r.end));}
  function notify(){showBanner('公式或代码区域请使用对应语法编辑；未改变原内容。');}
  function update(ta){window.MMContent.clearMeasurements();delete ta._mmCompletion;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus({preventScroll:true});}
  function wrapLines(ta,marker,start,end){
    // Each paragraph keeps its own delimiters; list and heading prefixes stay outside.
    if(ranges(ta.value).some(r=>start<r.end&&end>r.start&&ta.value.slice(r.start,r.end).includes('\n'))){notify();return;}
    const parts=ta.value.slice(start,end).split('\n').map((line,i)=>{const atLineStart=i>0||start===0||ta.value[start-1]==='\n',prefix=atLineStart?/^(\s*(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|(?:>\s*)+))/.exec(line)?.[0] || '':'';const text=line.slice(prefix.length),leading=/^\s*/.exec(text)[0],trailing=/\s*$/.exec(text)[0];return {prefix,leading,trailing,body:text.trim()};});
    const marked=body=>body.startsWith(marker)&&body.endsWith(marker)&&body.length>marker.length*2,remove=parts.filter(p=>p.body).every(p=>marked(p.body));
    const text=parts.map(p=>p.body?p.prefix+p.leading+(remove?p.body.slice(marker.length,-marker.length):marked(p.body)?p.body:marker+p.body+marker)+p.trailing:p.prefix+p.leading).join('\n');
    replace(ta,text);update(ta);
  }
  function wrap(ta,marker){
    let start=ta.selectionStart,end=ta.selectionEnd;if(!safe(ta,start,end)){notify();return;}
    const value=ta.value.slice(start,end);
    if(value.includes('\n'))return wrapLines(ta,marker,start,end);
    if(start>=marker.length && ta.value.slice(start-marker.length,start)===marker && ta.value.slice(end,end+marker.length)===marker){ta.setSelectionRange(start-marker.length,end+marker.length);replace(ta,value,'preserve');ta.setSelectionRange(start-marker.length,end-marker.length);}
    else if(value.startsWith(marker)&&value.endsWith(marker)&&value.length>=marker.length*2){const inner=value.slice(marker.length,-marker.length);replace(ta,inner);}
    else{const text=value || '文字',leading=/^\s*/.exec(text)[0],trailing=/\s*$/.exec(text)[0],inner=text.slice(leading.length,text.length-trailing.length || undefined);if(!inner)return;const replacement=leading+marker+inner+marker+trailing;replace(ta,replacement);ta.setSelectionRange(start+leading.length+marker.length,start+leading.length+marker.length+inner.length);}
    update(ta);
  }
  function taskText(source,line,checked){const lines=source.split('\n'),text=lines[line];if(typeof text!=='string')return source;lines[line]=text.replace(/^(\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?\[)[ xX](\]\s+)/,(_,before,after)=>before+(checked?'x':' ')+after);return lines.join('\n');}
  function mount(id,ta){
    ta._nodeStyle=style(M().findNode(id)?.n);const bar=document.createElement('div');bar.className='mm-formatbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','节点文字格式');
    bar.innerHTML=`<label>字号 <input type="number" min="10" max="48" step="1" value="${ta._nodeStyle.fontSize}" list="mmFontSizes" aria-label="正文字号"></label><datalist id="mmFontSizes">${[14,16,18,20,24].map(v=>`<option value="${v}">`).join('')}</datalist><button type="button" data-format="bold" title="加粗选中文字"><b>B</b></button><button type="button" data-format="italic" title="斜体选中文字"><i>I</i></button><button type="button" data-format="highlight" title="荧光笔高亮选中文字">荧光笔</button>`;
    bar.addEventListener('pointerdown',e=>{e.stopPropagation();if(!e.target.closest('input,select'))e.preventDefault();});
    bar.addEventListener('click',e=>{const action=e.target.closest('button')?.dataset.format;if(action)wrap(ta,{bold:'**',italic:'*',highlight:'=='}[action]);});
    bar.addEventListener('change',e=>{const value=Math.round(Number(e.target.value));if(!Number.isFinite(value)||value<10||value>48){e.target.value=ta._nodeStyle.fontSize;return;}ta._nodeStyle.fontSize=value;update(ta);});
    bar.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();ta.focus();ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}else if(e.key==='Enter'){e.preventDefault();e.target.dispatchEvent(new Event('change',{bubbles:true}));ta.focus();}e.stopPropagation();});
    document.getElementById('mmStage').appendChild(bar);return bar;
  }
  function setSelected(key,value){const state=M().state(),nodes=state.selected.map(id=>M().findNode(id)?.n).filter(n=>n&&!n.image&&!n.pdf&&!n.mapLink);if(!nodes.length)return;M().editMap(()=>{for(const n of nodes){const valueStyle=style(n);valueStyle[key]=value;apply(n,valueStyle);M().fitNode(n.id);}});window.MMContextMenus.hideAll();}
  function menu(){return window.MMContextMenus.branch('正文样式',`<label class="mm-ctx-width">字号 <input type="number" data-node-font min="10" max="48" value="${style(M().findNode(M().state().sel)?.n).fontSize}" aria-label="节点正文字号"></label>`,'content-style');}
  document.addEventListener('change',e=>{if(e.target.matches('[data-node-font]')){const size=Math.round(Number(e.target.value));if(size>=10 && size<=48)setSelected('fontSize',size);}if(e.target.matches('.mm-task')){const line=Number(e.target.dataset.taskLine),ta=document.querySelector('.mm-edit'),preview=e.target.closest('.mm-edit-preview');if(preview && ta){ta.value=taskText(ta.value,line,e.target.checked);update(ta);}else{const id=e.target.closest('.mm-node')?.dataset.id;if(id)M().toggleTask(id,line,e.target.checked);}}});
  window.MMFormat={mount,style,apply,menu,wrap,taskText,ranges};
})();
