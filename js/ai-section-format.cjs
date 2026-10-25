'use strict';
// Safe formatting edits are insertions only. Knowledge text, math and code stay byte-identical.
function segments(text){
 const protectedSpans=[];const re=/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)|\$\$[\s\S]*?(?:\$\$|$)|\\\[[\s\S]*?(?:\\\]|$)|\\\([\s\S]*?\\\)|(?<!\\)\$(?!\$)(?:\\.|[^$\n])*?(?:(?<!\\)\$|(?=\n|$))|`[^`\n]+`|\[[^\]\n]+\]\([^\)\n]+\)|\*\*[^\n]+?\*\*|__[^\n]+?__/g;
 for(const m of text.matchAll(re))protectedSpans.push([m.index,m.index+m[0].length]);
 const protectedAt=p=>protectedSpans.some(([a,b])=>p>a&&p<b),starts=new Set([0]);
 for(const m of text.matchAll(/\n[ \t]*(?=\S)|[。！？；](?=\s*\S)/g)){
  let at=m.index+(m[0].startsWith('\n')?1:m[0].length);while(at<text.length&&/\s/.test(text[at]))at++;
  if(protectedAt(at)||at>=text.length)continue;
  const lineStart=text.lastIndexOf('\n',at-1)+1,lineEnd=text.indexOf('\n',at),line=text.slice(lineStart,lineEnd<0?text.length:lineEnd);
  if(/^\s*#{1,6}\s/.test(line)&&at!==lineStart||/^ {4}|^\t|^\s*\|/.test(line))continue;
  starts.add(at);
 }
 let offsets=[...starts].sort((a,b)=>a-b);if(offsets.length>160){const all=offsets;offsets=Array.from({length:160},(_,i)=>all[Math.floor(i*(all.length-1)/159)]);}
 return offsets.map((at,i)=>({id:'b'+i,offset:at,text:text.slice(at,offsets[i+1]??text.length)}));
}
function check(node){
 const text=node.text,blocks=segments(text),headers=blocks.filter(b=>/^###\s+/.test(b.text)&&b.text.split('\n')[0].replace(/^###\s+/,'').trim()!=='下一步可以问');
 const visible=text.replace(/\$\$[\s\S]*?\$\$|```[\s\S]*?```/g,'').trim();
 if(visible.length<=100&&text.length<=240)return{needed:false,reason:'简短内容，无需强制分节'};
 if(headers.length>=2&&[0,...headers.map(b=>b.offset),text.length].every((at,i,a)=>i===0||at-a[i-1]<=1400))return{needed:false,reason:'已有明确分节，格式检查通过'};
 return{needed:true,reason:'较长正文或多个阅读阶段，需要判断分节',blocks};
}
function apply(plan,patches,allowed){
 const changes=[],rejected=[],accepted=new Map(),seen=new Set();
 for(const patch of patches){
  const n=plan.nodes.find(n=>n.id===patch?.nodeId);
  if(!n||!allowed.has(n.id)||seen.has(n.id)||Object.keys(patch).some(k=>!['nodeId','headings'].includes(k))||!Array.isArray(patch.headings)||patch.headings.length<1||patch.headings.length>16){rejected.push({nodeId:patch?.nodeId,reason:'未知或重复节点，或补丁格式无效'});continue;}
  seen.add(n.id);const blocks=segments(n.text),inserts=[],positions=new Set();let reason='';
  for(const h of patch.headings){const b=blocks.find(b=>b.id===h?.beforeBlock),title=typeof h?.title==='string'?h.title.trim():'';
   if(!b||positions.has(b.offset)||!title||title.length>60||/[\r\n#$<>`\\]/.test(title)||/^#{1,6}\s/.test(b.text)||Object.keys(h).some(k=>!['beforeBlock','title'].includes(k))){reason='标题或插入位置无效；原文未改';break;}
   positions.add(b.offset);inserts.push({at:b.offset,title});
  }
  if(reason){rejected.push({nodeId:n.id,reason});continue;}
  const ordinaryExisting=blocks.filter(b=>/^###\s+/.test(b.text)&&b.text.split('\n')[0].replace(/^###\s+/,'').trim()!=='下一步可以问').length;
  if(ordinaryExisting+inserts.filter(h=>h.title!=='下一步可以问').length<2){rejected.push({nodeId:n.id,reason:'一个孤立标题不能形成必要的分节'});continue;}
  let text=n.text;for(const h of inserts.sort((a,b)=>b.at-a.at)){const before=text.slice(0,h.at),gap=!before||before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n';text=before+gap+'### '+h.title+'\n\n'+text.slice(h.at);}
  if(text.length>20000){rejected.push({nodeId:n.id,reason:'增加标题后超过节点容量，保留原文'});continue;}
  accepted.set(n.id,text);changes.push({nodeId:n.id,headings:patch.headings});
 }
 return{plan:{...plan,nodes:plan.nodes.map(n=>accepted.has(n.id)?{...n,text:accepted.get(n.id)}:n)},changes,rejected};
}
module.exports={segments,check,apply};
