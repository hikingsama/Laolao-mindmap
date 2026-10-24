/* Shared interchange format v1. Keep the course/browser, backend and editor copies identical. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CoursesMindmapFormat=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const MAX_BYTES=4*1024*1024, MAX_NODES=1500, MAX_DEPTH=64;
  const copy=value=>JSON.parse(JSON.stringify(value),(key,v)=>['__proto__','constructor','prototype'].includes(key)?undefined:v);
  function parseOutline(text,title){
    text=String(text||'');if(!text.trim())throw Error('大纲为空，请先生成或填写大纲');
    if(new TextEncoder().encode(text).length>MAX_BYTES)throw Error('大纲超过 4MB，请分段生成');
    const rows=text.split(/\r?\n/).filter(s=>s.trim());if(rows.length>MAX_NODES-1)throw Error('大纲条目过多，请拆成多张导图');
    const indent=s=>(s.match(/^[ \t]*/)[0].replace(/\t/g,'  ').length);
    const margin=Math.min(...rows.map(indent));
    const root={text:String(title||'思维导图').trim().slice(0,80)||'思维导图',children:[]},stack=[{level:-1,node:root}];
    for(const raw of rows){
      let label=raw.trim().replace(/^(?:[-*+•])\s+/,'').trim();if(!label)continue;
      let level=Math.floor((indent(raw)-margin)/2),m;
      if((m=/^(#{1,6})\s+(.+)$/.exec(label))){level=Math.max(level,m[1].length-1);label=m[2];}
      else if(/^第[一二三四五六七八九十百零〇\d]+[章节篇]/.test(label))level=Math.max(level,0);
      else if(/^[一二三四五六七八九十]+、/.test(label))level=Math.max(level,1);
      else if(/^[（(][一二三四五六七八九十\d]+[）)]/.test(label))level=Math.max(level,2);
      else if((m=/^(\d+(?:\.\d+)*)(?:[.、)）]\s*|\s+)/.exec(label)))level=Math.max(level,m[1].split('.').length);
      if(level>MAX_DEPTH)throw Error('大纲层级过深，请精简到 64 层以内');
      while(stack.length>1&&stack.at(-1).level>=level)stack.pop();
      const node={text:label,children:[]};stack.at(-1).node.children.push(node);stack.push({level,node});
    }
    if(!root.children.length)throw Error('没有可生成的有效大纲条目');return root;
  }
  function normalize(input){
    if(!input||!Array.isArray(input.nodes)||!input.nodes.length)throw Error('导图缺少有效节点');
    const raw=JSON.stringify(input);if(new TextEncoder().encode(raw).length>MAX_BYTES)throw Error('导图数据超过 4MB，请缩小后重试');
    const map=copy(input),nodes=[],treeEdges=[],ids=new Set();let seq=0;
    function walk(node,parent,depth){
      if(depth>MAX_DEPTH||nodes.length>=MAX_NODES)throw Error('导图节点过多或层级过深');
      if(!node||typeof node!=='object'||typeof node.text!=='string')throw Error('导图节点正文格式不正确');
      const id=node.id==null?'import-'+(++seq):String(node.id);
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||ids.has(id))throw Error('导图存在无效或重复节点编号');ids.add(id);
      const children=node.children||[];if(!Array.isArray(children))throw Error('子节点格式不正确');
      nodes.push({...node,id,children:[]});if(parent)treeEdges.push({id:'tree-'+id,from:{node:parent,side:'e'},to:{node:id,side:'w'},dir:'fwd',kind:'hierarchy'});
      for(const child of children)walk(child,id,depth+1);
    }
    for(const node of map.nodes)walk(node,null,0);
    if(map.edges!=null&&!Array.isArray(map.edges))throw Error('连线格式不正确');
    const edges=(map.edges||[]),edgeIds=new Set();if(edges.length>6000)throw Error('导图连线过多');
    for(const edge of edges){if(!edge?.from||!edge?.to||!ids.has(edge.from.node)||!ids.has(edge.to.node))throw Error('连线引用了不存在的节点');if(!edge.id||edgeIds.has(edge.id))throw Error('连线编号缺失或重复');edgeIds.add(edge.id);}
    for(const edge of treeEdges)if(!edges.some(e=>e.from.node===edge.from.node&&e.to.node===edge.to.node)){
      while(edgeIds.has(edge.id))edge.id+='-tree';edges.push(edge);edgeIds.add(edge.id);
    }
    return {...map,title:String(map.title||'思维导图').trim().slice(0,80)||'思维导图',nodes,edges,pos:map.pos||{},size:map.size||{},v:3,flat:true,line:map.line||'curve'};
  }
  function fromOutline(text,title,id){
    let seq=0;function ids(n){return {...n,id:'n'+(++seq),children:n.children.map(ids)};}
    const map=normalize({id,title,nodes:[ids(parseOutline(text,title))]});
    // Seed a compact readable tree once. Existing edited maps keep their own positions.
    const children=new Map(map.nodes.map(n=>[n.id,[]]));for(const e of map.edges)children.get(e.from.node).push(e.to.node);
    let row=0;function place(nodeId,depth){const list=children.get(nodeId);const ys=list.map(id=>place(id,depth+1));const y=ys.length?(ys[0]+ys.at(-1))/2:row++*155;map.pos[nodeId]={x:depth*350,y};map.size[nodeId]={w:280,h:100};return y;}
    place(map.nodes[0].id,0);return map;
  }
  function toOutline(input,options={}){
    const map=normalize(input),nodes=new Map(map.nodes.map(n=>[n.id,n])),out=new Map(map.nodes.map(n=>[n.id,[]])),incoming=new Set(),seen=new Set(),lines=[];
    for(const e of map.edges){if(e.kind==='relation'||e.from.node===e.to.node)continue;out.get(e.from.node).push(e.to.node);incoming.add(e.to.node);}
    function walk(id,depth){if(seen.has(id))return;seen.add(id);const label=nodes.get(id).text.replace(/\s*\n+\s*/g,' ').trim();if(label)lines.push('  '.repeat(Math.min(depth,MAX_DEPTH))+'- '+label);for(const next of out.get(id))walk(next,depth+1);}
    const roots=map.nodes.filter(n=>!incoming.has(n.id));
    if(options.omitRoot&&roots.length===1&&roots[0].text.trim()===map.title&&out.get(roots[0].id).length){seen.add(roots[0].id);for(const id of out.get(roots[0].id))walk(id,0);}
    for(const n of roots)walk(n.id,0);for(const n of map.nodes)walk(n.id,0);return lines.join('\n');
  }
  return {parseOutline,normalize,fromOutline,toOutline,MAX_BYTES,MAX_NODES};
});
