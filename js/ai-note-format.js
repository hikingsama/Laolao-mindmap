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
    // Only generated output is formatted; code and existing display math remain intact.
    const parts=text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g);
    const main=latex=>/[=<>≤≥≈]|\\(?:frac|lim|int|sum|prod|sim|approx|equiv|to|Rightarrow|rightarrow|sqrt)\b/.test(latex);
    return parts.map((part,i)=>i%2?part:part.replace(/(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g,(all,latex)=>main(latex)?'\n\n$$\n'+latex.trim()+'\n$$\n\n':all).replace(/\\\(([^\n]*?)\\\)/g,(all,latex)=>main(latex)?'\n\n$$\n'+latex.trim()+'\n$$\n\n':all).replace(/\n{3,}/g,'\n\n').replace(/\n\n[，,；;]\s*/g,'\n\n')).join('').trim();
  }
  function generatedText(item){return displayMainMath(item.blocks!==undefined?blocksToText(item.blocks):item.text);}
  const api={blocksToText,displayMainMath,generatedText};
  if(typeof module==='object' && module.exports)module.exports=api;else root.MMAINoteFormat=api;
})(typeof window==='object'?window:globalThis);
