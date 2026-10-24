(function(root){
  'use strict';
  function blocksToText(blocks){
    if(!Array.isArray(blocks) || !blocks.length || blocks.length>40)throw new Error('总结分段应包含1–40段说明或公式');
    const result=blocks.map(b=>{
      if(!b || typeof b!=='object')throw new Error('总结分段格式错误');
      if(b.type==='text' && typeof b.text==='string' && b.text.trim())return b.text.trim();
      if(b.type==='math' && typeof b.latex==='string' && b.latex.trim()){
        const latex=b.latex.trim().replace(/^\$\$\s*|\s*\$\$$/g,'').replace(/^\\\[\s*|\s*\\\]$/g,'').trim();
        if(!latex)throw new Error('总结公式不能为空');
        return '$$\n'+latex+'\n$$';
      }
      throw new Error('总结分段仅支持说明文字或独立公式');
    }).join('\n\n');
    if(result.length>20000)throw new Error('总结正文过长，请拆分节点');return result;
  }
  function displayMainMath(text){
    // Explicit inline/display choices are authoritative. Review handles missing delimiters.
    return text;
  }

  function generatedText(item){return displayMainMath(item.blocks!==undefined?blocksToText(item.blocks):item.text);}
  const api={blocksToText,displayMainMath,generatedText};
  if(typeof module==='object' && module.exports)module.exports=api;else root.MMAINoteFormat=api;
})(typeof window==='object'?window:globalThis);
