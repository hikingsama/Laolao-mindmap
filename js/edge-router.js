/* Shared orthogonal routing for canvas, picking and PNG export. No dependencies. */
(function (root) {
  function route(a, b, edge) {
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
    const p = ports(a).find(v => v.side === (edge && edge.from && edge.from.side)) || ports(a)[1];
    const q = ports(b).find(v => v.side === (edge && edge.to && edge.to.side)) || ports(b)[3];
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
    const obstacles = [a, b].map(r => ({ x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 }));
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
  root.MMEdgeRouter = { route };
  if (typeof module !== 'undefined') module.exports = root.MMEdgeRouter;
})(typeof window !== 'undefined' ? window : globalThis);
