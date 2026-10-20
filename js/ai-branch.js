(function(root){
  'use strict';
  const palette=['#667e51','#527f96','#9c6b4f','#856697','#a08743','#477f77','#9d667d'];
  const sides=['e','s','n','w'];
  const distance=(a,b)=>{const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));const x=rgb(a),y=rgb(b);return Math.hypot(...x.map((v,i)=>v-y[i]));};
  function color(parent,near=[],seed=0){
    parent=/^#[a-f0-9]{6}$/i.test(parent || '')?parent:palette[0];
    return palette.map((c,i)=>({c,score:distance(c,parent)*2+Math.min(...near.filter(v=>/^#[a-f0-9]{6}$/i.test(v)).map(v=>distance(c,v)),150)+(i===seed%palette.length?4:0)})).sort((a,b)=>b.score-a.score)[0].c;
  }
  function port(nodeId,edges,preferred=sides){
    const used=edges.flatMap(e=>[e.from,e.to]).filter(p=>p?.node===nodeId),occupied=(side,offset)=>used.some(p=>p.side===side && Math.abs((p.offset ?? .5)-offset)<.035);
    for(const side of preferred)if(!used.some(p=>p.side===side))return {side};
    for(let denominator=4;denominator<=128;denominator*=2)for(let i=1;i<denominator;i+=2)for(const side of preferred)if(!occupied(side,i/denominator))return {side,offset:i/denominator};
    throw new Error('节点连接点过多，请从附近节点继续提问');
  }
  const api={palette,color,port};if(typeof module==='object' && module.exports)module.exports=api;else root.MMAIBranch=api;
})(typeof window==='object'?window:globalThis);
