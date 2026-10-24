(function(root){
 'use strict';
 const katex=typeof module==='object' && module.exports?require('../vendor/katex/katex.min.js'):root.katex;
 const inspections=new Map();
 const syntax=(latex,display=false)=>{try{katex.renderToString(latex,{displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:20});return '';}catch(e){return String(e.message).replace(/^KaTeX parse error:\s*/,'').slice(0,180);}};
 function parts(text){
   const protectedSpans=[],formulas=[];
   const re=/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|https?:\/\/[^\s<>]+|[A-Za-z]:\\[^\s<>]+|\[[^\]\n]*\]\([^\n)]*\)|\b[\w.-]+\.(?:pdf|txt|md|js|json|png|jpg|csv|py|tex)\b|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)|(?<![\\$])\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g;
   for(const m of text.matchAll(re)){
     const value=m[0],start=m.index,end=start+value.length;
     protectedSpans.push({start,end});
     if(value.startsWith('$$'))formulas.push({start,end,latex:value.slice(2,-2),display:true});
     else if(value.startsWith('\\['))formulas.push({start,end,latex:value.slice(2,-2),display:true});
     else if(value.startsWith('\\('))formulas.push({start,end,latex:value.slice(2,-2),display:false});
     else if(value.startsWith('$'))formulas.push({start,end,latex:value.slice(1,-1),display:false});
   }
   return{protectedSpans,formulas};
 }
 function inspect(text){
   if(inspections.has(text))return inspections.get(text);
   const {protectedSpans,formulas}=parts(text),issues=[];
   for(const f of formulas){const problem=syntax(f.latex,f.display);if(problem)issues.push({code:'syntax',start:f.start,end:f.end,text:text.slice(f.start,f.end),reason:'现有公式无法渲染：'+problem});}
   let plain=text;for(const p of [...protectedSpans].reverse())plain=plain.slice(0,p.start)+' '.repeat(p.end-p.start)+plain.slice(p.end);
   const matches=/(?<![A-Za-z0-9_])(?:[A-Za-zα-ωΑ-Ω](?:[_^](?:\{[^{}\n]+\}|[A-Za-z0-9]+))+)|\\[A-Za-z]+|[α-ωΑ-Ω]/g;
   for(const m of plain.matchAll(matches))issues.push({code:'bare-math',start:m.index,end:m.index+m[0].length,text:m[0],reason:'数学符号、上下标或LaTeX命令未放入公式定界符'});
   if(/质点|质量|坐标|变量|函数|指标|设有|设空间|其中/.test(plain))for(const m of plain.matchAll(/(?<![A-Za-z0-9_\\])[A-Za-z](?![A-Za-z0-9_])/g)){
     if(!issues.some(i=>m.index>=i.start && m.index<i.end))issues.push({code:'possible-variable',start:m.index,end:m.index+1,text:m[0],reason:'数学语境中的裸变量，需结合上下文判断'});
   }
   for(const m of plain.matchAll(/\$\$|\\[()[\]]|(?<!\\)\$(?!\d)/g))issues.push({code:'delimiter',start:m.index,end:m.index+m[0].length,text:m[0],reason:'可能有未配对的数学定界符'});
   const out=issues.slice(0,64);if(inspections.size>=300)inspections.clear();inspections.set(text,out);return out;
 }
 function analyze(plan){
   const suspects=[];
   for(const node of plan.nodes)for(const field of ['title','text']){const issues=inspect(node[field] || '');if(issues.length)suspects.push({nodeId:node.id,field,issues});}
   return suspects;
 }
 function readyPrefix(plan){
   const index=plan.nodes.findIndex(n=>inspect(n.title || '').length || inspect(n.text || '').length),nodes=index<0?plan.nodes:plan.nodes.slice(0,index),ids=new Set(nodes.map(n=>n.id));
   return{...plan,nodes,edges:plan.edges.filter(e=>ids.has(e.from) && ids.has(e.to))};
 }
 function apply(plan,patches){
   const out={...plan,nodes:plan.nodes.map(n=>({...n}))},changes=[],rejected=[];
   const allowed=new Set(analyze(plan).map(s=>s.nodeId+':'+s.field));
   for(const p of (Array.isArray(patches)?[...patches]:[]).slice(0,128).sort((a,b)=>(typeof b?.expression==='string'?b.expression.length:0)-(typeof a?.expression==='string'?a.expression.length:0))){
     const node=out.nodes.find(n=>n.id===p?.nodeId),field=p?.field,expression=p?.expression;
     let why='';
     if(!node || !['title','text'].includes(field) || !allowed.has(p.nodeId+':'+field))why='修改对象不是待检查字段';
     else if(typeof expression!=='string' || !expression.trim() || expression.length>1000 || /[\n\r$\u4e00-\u9fff`]/.test(expression) || !/[A-Za-z0-9α-ωΑ-Ω\\_^]/.test(expression))why='表达式不适合安全补充定界符';
     else if(typeof p.display!=='boolean' || (p.display && field==='title'))why='公式显示方式无效';
     if(why){rejected.push({nodeId:p?.nodeId,reason:why});continue;}
     const source=node[field],spans=parts(source).protectedSpans,positions=[];
     for(let i=source.indexOf(expression);i>=0;i=source.indexOf(expression,i+1)){
       if(spans.some(s=>i<s.end && i+expression.length>s.start))continue;
       if(/[A-Za-z0-9_]/.test(expression[0]) && /[A-Za-z0-9_]/.test(source[i-1] || ''))continue;
       if(/[A-Za-z0-9_]/.test(expression.at(-1)) && /[A-Za-z0-9_]/.test(source[i+expression.length] || ''))continue;
       positions.push(i);
     }
     const at=positions[0],end=at+expression.length;
     if(positions.length!==1)why='表达式未唯一匹配可修改的原文';
     else if(p.display && ((at>0 && source.slice(0,at).split('\n').at(-1).trim()) || source.slice(end).split('\n')[0].trim()))why='句内表达式应使用行内公式';
     else if(syntax(expression,p.display))why='表达式不是可渲染的LaTeX';
     if(why){rejected.push({nodeId:p.nodeId,reason:why});continue;}
     const replacement=p.display?'$$\n'+expression+'\n$$':'$'+expression+'$';
     node[field]=source.slice(0,at)+replacement+source.slice(end);
     changes.push({nodeId:node.id,field,before:expression,after:replacement,reason:typeof p.reason==='string'?p.reason.slice(0,240):'补充数学公式定界符'});
   }
   return{plan:out,changes,rejected};
 }
 const api={inspect,analyze,readyPrefix,apply,syntax};
 if(typeof module==='object' && module.exports)module.exports=api;else root.MMAIMathCheck=api;
})(typeof window==='object'?window:globalThis);
