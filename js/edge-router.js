/* Shared orthogonal routing for canvas, picking and PNG export. No dependencies. */
(function (root) {
  function orthogonalRoute(a, b, edge, extra=[]) {
    const ports = (r) => [
      { side: 'n', x: r.x + r.w / 2, y: r.y, dx: 0, dy: -1 },
      { side: 'e', x: r.x + r.w, y: r.y + r.h / 2, dx: 1, dy: 0 },
      { side: 's', x: r.x + r.w / 2, y: r.y + r.h, dx: 0, dy: 1 },
      { side: 'w', x: r.x, y: r.y + r.h / 2, dx: -1, dy: 0 }
    ];
    const crosses = (p, q, r) => {
      const eps = 0.01;
      if (p.x === q.x) return p.x > r.x + eps && p.x < r.x + r.w - eps && Math.max(p.y, q.y) > r.y + eps && Math.min(p.y, q.y) < r.y + r.h - eps;
      return p.y > r.y + eps && p.y < r.y + r.h - eps && Math.max(p.x, q.x) > r.x + eps && Math.min(p.x, q.x) < r.x + r.w - eps;
    };
    // Endpoints are fixed: never substitute a different magnet after movement.
    function endpoint(r,end,fallback){const port=ports(r).find(v=>v.side===end?.side) || ports(r)[fallback],offset=Number.isFinite(end?.offset)?Math.min(.95,Math.max(.05,end.offset)):.5;return {...port,...(port.dx?{y:r.y+r.h*offset}:{x:r.x+r.w*offset})};}
    const p=endpoint(a,edge?.from,1),q=endpoint(b,edge?.to,3);
    const extension = (port, other) => {
      let distance = Infinity;
      if (port.dx && port.y >= other.y && port.y <= other.y + other.h) {
        if (port.dx > 0 && other.x >= port.x) distance = other.x - port.x;
        if (port.dx < 0 && other.x + other.w <= port.x) distance = port.x - other.x - other.w;
      }
      if (port.dy && port.x >= other.x && port.x <= other.x + other.w) {
        if (port.dy > 0 && other.y >= port.y) distance = other.y - port.y;
        if (port.dy < 0 && other.y + other.h <= port.y) distance = port.y - other.y - other.h;
      }
      return Math.min(24, distance / 3);
    };
    const pa = extension(p, b), pb = extension(q, a);
    const s = { x: p.x + p.dx * pa, y: p.y + p.dy * pa };
    const t = { x: q.x + q.dx * pb, y: q.y + q.dy * pb };
    const margin = Math.min(10, pa / 2, pb / 2);
    const obstacles = [a, b,...extra].map(r => ({ x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 }));
    const xs = [...new Set([s.x, t.x, ...obstacles.flatMap(r => [r.x, r.x + r.w])])].sort((x, y) => x - y);
    const ys = [...new Set([s.y, t.y, ...obstacles.flatMap(r => [r.y, r.y + r.h])])].sort((x, y) => x - y);
    const grid = ys.flatMap(y => xs.map(x => ({ x, y })));
    const allowed = grid.map(v => !obstacles.some(r => v.x > r.x + .01 && v.x < r.x + r.w - .01 && v.y > r.y + .01 && v.y < r.y + r.h - .01));
    const start = grid.findIndex(v => v.x === s.x && v.y === s.y), finish = grid.findIndex(v => v.x === t.x && v.y === t.y);
    // Dijkstra tracks approach direction so equally short routes prefer fewer bends.
    const cost = new Map(), prev = new Map(), visited = new Set();
    const initial = start * 2 + (p.dx ? 0 : 1); cost.set(initial, 0);
    let goal = null;
    while (true) {
      let current = null, least = Infinity;
      for (const [key, value] of cost) if (!visited.has(key) && value < least) { current = key; least = value; }
      if (current === null) break;
      const index = Math.floor(current / 2), dir = current % 2;
      if (index === finish && allowed[index]) { goal = current; break; }
      visited.add(current);
      const col = index % xs.length, row = Math.floor(index / xs.length);
      const neighbors = [];
      if (col) neighbors.push([index - 1, 0]);
      if (col + 1 < xs.length) neighbors.push([index + 1, 0]);
      if (row) neighbors.push([index - xs.length, 1]);
      if (row + 1 < ys.length) neighbors.push([index + xs.length, 1]);
      for (const [next, nd] of neighbors) {
        if (!allowed[index] || !allowed[next] || obstacles.some(r => crosses(grid[index], grid[next], r))) continue;
        const dx = grid[next].x - grid[index].x, dy = grid[next].y - grid[index].y;
        // Do not double back over the outward endpoint stubs.
        if (index === start && dx * p.dx + dy * p.dy < 0) continue;
        if (next === finish && dx * q.dx + dy * q.dy > 0) continue;
        const key = next * 2 + nd;
        const value = least + Math.abs(dx) + Math.abs(dy) + (dir !== nd ? 12 : 0);
        if (value < (cost.get(key) ?? Infinity)) { cost.set(key, value); prev.set(key, current); }
      }
    }
    const middle = [];
    if (goal !== null) {
      for (let key = goal; key !== undefined; key = prev.get(key)) middle.unshift(grid[Math.floor(key / 2)]);
    } else {
      // Overlapping/touching rectangles may block a fixed port. Keep that port anyway.
      const y = Math.min(a.y, b.y) - 24;
      middle.push(s, { x: s.x, y }, { x: t.x, y }, t);
    }
    const points = [];
    for (const v of [p, ...middle, q]) {
      const last = points[points.length - 1];
      if (last && v.x === last.x && v.y === last.y) continue;
      points.push({ x: v.x, y: v.y });
      while (points.length >= 3) {
        const [u, v2, w] = points.slice(-3);
        if ((u.x === v2.x && v2.x === w.x && (v2.y - u.y) * (w.y - v2.y) >= 0) || (u.y === v2.y && v2.y === w.y && (v2.x - u.x) * (w.x - v2.x) >= 0)) points.splice(points.length - 2, 1);
        else break;
      }
    }
    return { points, path: points.map((v, i) => `${i ? 'L' : 'M'}${v.x},${v.y}`).join(' '), fromSide: p.side, toSide: q.side, blocked: goal === null };
  }

  const cache=new Map();
  function route(a,b,edge,all=[]){
    const style=edge?.style || 'elbow';
    if(style==='elbow' && !all.length)return orthogonalRoute(a,b,edge);
    const nearby=all.filter(r=>r!==a && r!==b && r.x<Math.max(a.x+a.w,b.x+b.w)+250 && r.x+r.w>Math.min(a.x,b.x)-250 && r.y<Math.max(a.y+a.h,b.y+b.h)+250 && r.y+r.h>Math.min(a.y,b.y)-250);
    const key=JSON.stringify([a.x,a.y,a.w,a.h,b.x,b.y,b.w,b.h,edge?.from,edge?.to,style,edge?.id,nearby.map(r=>[r.x,r.y,r.w,r.h])]);
    if(cache.has(key))return cache.get(key);
    const endpoint=(r,end,fallback)=>{const side=['n','e','s','w'].includes(end?.side)?end.side:fallback,offset=Number.isFinite(end?.offset)?Math.min(.95,Math.max(.05,end.offset)):.5;return side==='n'?{x:r.x+r.w*offset,y:r.y,dx:0,dy:-1}:side==='s'?{x:r.x+r.w*offset,y:r.y+r.h,dx:0,dy:1}:side==='w'?{x:r.x,y:r.y+r.h*offset,dx:-1,dy:0}:{x:r.x+r.w,y:r.y+r.h*offset,dx:1,dy:0};};
    const p=endpoint(a,edge?.from,'e'),q=endpoint(b,edge?.to,'w'),fromSide=edge?.from?.side || 'e',toSide=edge?.to?.side || 'w';
    const inside=(v,r)=>v.x>r.x+.5 && v.x<r.x+r.w-.5 && v.y>r.y+.5 && v.y<r.y+r.h-.5;
    const obstacles=[a,b,...nearby],collisions=points=>points.slice(1,-1).filter(v=>obstacles.some(r=>inside(v,r))).length;
    const cubic=(p,c1,c2,q)=>Array.from({length:81},(_,i)=>{const t=i/80,u=1-t;return{x:u*u*u*p.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*q.x,y:u*u*u*p.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*q.y};});
    let result;
    if(style==='straight')result={points:[p,q],path:`M${p.x},${p.y} L${q.x},${q.y}`,fromSide,toSide,blocked:false};
    else if(style==='curve'){
      const hash=Array.from(edge?.id || '').reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),distance=Math.hypot(q.x-p.x,q.y-p.y),d=Math.min(240,Math.max(36,distance*.35)),fan=(hash%7-3)*.035;
      const c1={x:p.x+p.dx*d*(1+fan),y:p.y+p.dy*d*(1+fan)},c2={x:q.x+q.dx*d*(1-fan),y:q.y+q.dy*d*(1-fan)},points=cubic(p,c1,c2,q);
      if(!collisions(points))result={points,path:`M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`,fromSide,toSide,blocked:false};
    }
    if(!result){
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},extras=[...nearby].sort((r,s)=>Math.hypot(r.x-mid.x,r.y-mid.y)-Math.hypot(s.x-mid.x,s.y-mid.y)).slice(0,6);
      const ortho=orthogonalRoute(a,b,edge,extras);
      if(style!=='curve')result=ortho;
      else{
        const vertices=ortho.points,points=[vertices[0]];let path=`M${vertices[0].x},${vertices[0].y}`;
        for(let i=1;i<vertices.length-1;i++){
          const before=vertices[i-1],v=vertices[i],after=vertices[i+1],l1=Math.hypot(v.x-before.x,v.y-before.y),l2=Math.hypot(after.x-v.x,after.y-v.y),radius=Math.min(22,l1/3,l2/3),s={x:v.x+(before.x-v.x)*radius/l1,y:v.y+(before.y-v.y)*radius/l1},t={x:v.x+(after.x-v.x)*radius/l2,y:v.y+(after.y-v.y)*radius/l2};
          path+=` L${s.x},${s.y} Q${v.x},${v.y} ${t.x},${t.y}`;points.push(s);
          for(let j=1;j<=10;j++){const k=j/10,u=1-k;points.push({x:u*u*s.x+2*u*k*v.x+k*k*t.x,y:u*u*s.y+2*u*k*v.y+k*k*t.y});}
        }
        const last=vertices.at(-1);path+=` L${last.x},${last.y}`;points.push(last);result={...ortho,path,points};
      }
    }
    if(cache.size>=600)cache.clear();cache.set(key,result);return result;
  }

  root.MMEdgeRouter = { route };
  if (typeof module !== 'undefined') module.exports = root.MMEdgeRouter;
})(typeof window !== 'undefined' ? window : globalThis);
