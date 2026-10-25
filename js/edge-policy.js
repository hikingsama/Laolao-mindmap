(function(root){
 'use strict';
 const node=end=>typeof end==='string'?end:end?.node;
 const key=(a,b)=>JSON.stringify([a,b].sort());
 const hierarchy=e=>['hierarchy','contains'].includes(e.kind) || !!e.lectureStructure;
 function unique(edges=[]){
   const result=[],seen=new Map();
   for(const e of edges){
     const a=node(e?.from),b=node(e?.to);if(!a || !b || a===b)continue;
     const pair=key(a,b),index=seen.get(pair);
     if(index===undefined){seen.set(pair,result.length);result.push(e);}
     else if(hierarchy(result[index]) && !hierarchy(e))result[index]=e;
   }
   return result;
 }
 function clean(edges,scope){
   const result=unique(edges),allowed=scope?new Set(scope):null,adjacent=new Map(),removed=new Set();
   for(const edge of result){
     const from=node(edge.from),to=node(edge.to);
     if(!hierarchy(edge) || edge.dir==='both' || edge.dir==='none' || allowed && (!allowed.has(from) || !allowed.has(to)))continue;
     const source=edge.dir==='rev'?to:from,target=edge.dir==='rev'?from:to;
     if(!adjacent.has(source))adjacent.set(source,[]);adjacent.get(source).push({edge,target});
   }
   // Only containment is transitive. Never infer redundancy for inference or contrast.
   for(let i=result.length-1;i>=0;i--){
     const edge=result[i],from=node(edge.from),to=node(edge.to);
     if(!hierarchy(edge) || edge.dir==='both' || edge.dir==='none' || allowed && (!allowed.has(from) || !allowed.has(to)))continue;
     const source=edge.dir==='rev'?to:from,target=edge.dir==='rev'?from:to,seen=new Set([source]),queue=[source];
     for(let n=0;n<queue.length && !seen.has(target);n++)for(const next of adjacent.get(queue[n]) || []){
       if(next.edge===edge || removed.has(next.edge) || seen.has(next.target))continue;
       seen.add(next.target);queue.push(next.target);
     }
     if(seen.has(target))removed.add(edge);
   }
   return result.filter(edge=>!removed.has(edge));
 }
 const api={node,key,unique,clean};
 if(typeof module==='object' && module.exports)module.exports=api;else root.MMEdgePolicy=api;
})(typeof window==='object'?window:globalThis);

