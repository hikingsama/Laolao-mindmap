(() => {
  'use strict';
  // Complete paragraphs render rich text; an unfinished paragraph stays plain.
  function render(host,text,done=false){
    if(done){host.innerHTML=window.MMContent.render(text);return;}
    let fence=false,math=false,cut=0;
    const lines=text.split('\n');let offset=0;
    for(const line of lines){if(/^\s*```/.test(line))fence=!fence;if((line.match(/\$\$/g)||[]).length%2)math=!math;
      offset+=line.length+1;if(!line.trim() && !fence && !math)cut=Math.min(offset,text.length);
    }
    const stable=text.slice(0,cut),tail=text.slice(cut);
    if(!host.querySelector('.mm-ai-live-stable'))host.innerHTML='<div class="mm-ai-live-stable"></div><span class="mm-ai-live-tail"></span>';
    if(host._stable!==stable){host.querySelector('.mm-ai-live-stable').innerHTML=window.MMContent.render(stable);host._stable=stable;}
    const plain=host.querySelector('.mm-ai-live-tail');
    let safe=tail;const markers=tail.match(/\$\$|(?<!\\)\$|\\\[|\\\]|\\\(|\\\)/g)||[];
    if(fence || math || markers.length%2){const idx=tail.search(/```|\$|\\\[|\\\(/);if(idx>=0)safe=tail.slice(0,idx)+'（正在接收公式或代码…）';}
    plain.textContent=safe;
  }
  window.MMAILive={render};
})();
