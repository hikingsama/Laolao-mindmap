(function(root){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v)),title=n=>String(n?.text || '').split('\n').find(v=>v.trim())?.replace(/^#+\s*/,'').slice(0,100) || '未命名节点';
  function index(map){
    const memory=map.aiMemory || {},membership={...(memory.membership || {})},trees={...(memory.trees || {})},nodes=new Map((map.nodes || []).map(n=>[n.id,n]));
    const adjacent=new Map([...nodes.keys()].map(id=>[id,[]]));
    for(const e of map.edges || [])if(!e.aiReference && adjacent.has(e.from?.node) && adjacent.has(e.to?.node)){adjacent.get(e.from.node).push(e.to.node);adjacent.get(e.to.node).push(e.from.node);}
    // Existing ownership remains stable when a new cross-tree edge is added.
    for(const id of nodes.keys()){
      if(membership[id])continue;
      const seen=new Set([id]),queue=[id];let owner=null;
      for(let i=0;i<queue.length;i++){const at=queue[i];if(membership[at]){owner=membership[at];break;}for(const next of adjacent.get(at))if(!seen.has(next)){seen.add(next);queue.push(next);}}
      if(!owner){const ids=[...seen],incoming=new Set((map.edges || []).filter(e=>e.dir!=='none' && ids.includes(e.from?.node) && ids.includes(e.to?.node)).map(e=>e.to.node));const rootId=ids.find(v=>!incoming.has(v)) || ids[0];owner='tree-'+rootId;trees[owner] ||= {id:owner,root:rootId,title:title(nodes.get(rootId))};}
      // When two existing trees are bridged, only unowned nodes inherit an owner.
      for(const next of seen)if(!membership[next])membership[next]=owner;
    }
    return {membership,trees,turns:Array.isArray(memory.turns)?memory.turns:[]};
  }
  function fingerprint(text){let h=2166136261;for(const c of String(text || '')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  const terms=text=>new Set((String(text).toLowerCase().match(/[a-z][a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || []).flatMap(v=>/[\u4e00-\u9fff]/.test(v)?Array.from({length:Math.max(1,v.length-1)},(_,i)=>v.slice(i,i+2)):[v]));
  function overlap(a,b){let n=0;for(const t of a)if(b.has(t))n++;return n;}
  function collect(map,sourceId,question,{scope='project'}={}){
    const info=index(map),treeId=info.membership[sourceId],source=(map.nodes || []).find(n=>n.id===sourceId);if(!source)throw new Error('提问节点不存在');
    const nodes=new Map(map.nodes.map(n=>[n.id,n])),ancestors=new Set([sourceId]),queue=[sourceId];
    for(let i=0;scope!=='node' && i<queue.length && i<80;i++)for(const e of map.edges || []){
      if(e.aiReference)continue;
      const from=e.dir==='rev'?e.to?.node:e.from?.node,to=e.dir==='rev'?e.from?.node:e.to?.node;
      if(to===queue[i] && nodes.has(from) && info.membership[from]===treeId && !ancestors.has(from)){ancestors.add(from);queue.push(from);}
    }
    const otherRoots=new Set(Object.values(info.trees).filter(t=>t.id!==treeId).slice(0,6).map(t=>t.root));
    const query=terms(question+' '+source.text),direct=new Set((map.edges || []).flatMap(e=>e.from?.node===sourceId?[e.to.node]:e.to?.node===sourceId?[e.from.node]:[]));
    const candidates=map.nodes.map(n=>{
      const own=info.membership[n.id]===treeId,isCurrent=n.id===sourceId,isAncestor=ancestors.has(n.id),explicit=direct.has(n.id),shared=(n.pdf || n.image) && (n.pdf || n.image)===(source.pdf || source.image),match=overlap(query,terms(n.text));
      const kind=isCurrent?'current':own?(isAncestor?'ancestor':'tree'):'related';
      const score=isCurrent?1000:isAncestor?300:explicit?200:shared?150:match*10;
      return {id:n.id,nodeId:n.id,treeId:info.membership[n.id],treeTitle:info.trees[info.membership[n.id]]?.title || '关联树',title:title(n),text:String(n.text || '').slice(0,isCurrent?8000:2400),kind,score,reason:isCurrent?'本次发问节点':isAncestor?'当前推导路径':explicit?'已有连线关联':shared?'共同引用同一附件':own?'同树相关内容':match?'主题词相关':'其他树的主题概览',revision:fingerprint(n.text)};
    }).filter(n=>n.kind==='current' || scope!=='node' && (n.treeId===treeId || scope==='project') && (n.score>=20 || direct.has(n.id) || scope==='project' && otherRoots.has(n.id))).sort((a,b)=>b.score-a.score).slice(0,18);
    // Raw revisions stay local. The model receives bounded source snapshots only.
    const sources=candidates.map(({score,...n})=>n);
    const relevant=info.turns.filter(t=>t.treeId===treeId && (t.sourceId===sourceId || t.generatedIds?.some(id=>ancestors.has(id)) || !t.generatedIds?.length && ancestors.has(t.sourceId)) && t.answer && t.status==='completed' && (!t.generatedIds?.length || t.generatedIds.some(id=>nodes.has(id)))).slice(-8);
    const history=[];let size=0;
    for(const t of relevant.slice().reverse()){const answer=t.answer.slice(0,14000),question=t.question.slice(0,10000);if(size+answer.length+question.length>65000)break;history.unshift({role:'user',content:question},{role:'assistant',content:answer});size+=answer.length+question.length;}
    return {...info,treeId,treeTitle:info.trees[treeId]?.title || title(source),candidates:sources,history,ancestors:[...ancestors]};
  }
  function merge(map,record,ownership){
    const info=index(map),memory=map.aiMemory ||= {version:1};memory.version=1;memory.membership={...info.membership,...ownership?.membership};memory.trees={...info.trees,...ownership?.trees};
    memory.turns=info.turns.slice();for(const item of (Array.isArray(record)?record:record?[record]:[])){const at=memory.turns.findIndex(t=>t.id===item.id);if(at<0)memory.turns.push(clone(item));else memory.turns[at]={...memory.turns[at],...clone(item)};for(const id of item.generatedIds || [])memory.membership[id]=item.treeId;}
    return memory;
  }
  function messages(info){return info.turns.filter(t=>t.treeId===info.treeId).flatMap(t=>[{role:'user',content:t.question,attachment:t.attachment,turnId:t.id,sourceId:t.sourceId,sourceTitle:t.sourceTitle},{role:'assistant',content:t.answer || '',turn:t.number,turnId:t.id,nodeCount:t.nodeCount || 0,generatedIds:t.generatedIds || [],workflow:t.workflow,transfer:t.transfer,color:t.color,error:t.error,incomplete:!['completed','running'].includes(t.status),generating:t.status==='running',sourceId:t.sourceId}]);}
  const api={index,collect,merge,messages,title,fingerprint};if(typeof module==='object' && module.exports)module.exports=api;else root.MMAIMemory=api;
})(typeof window==='object'?window:globalThis);
