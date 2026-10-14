const assert = require('node:assert/strict');
const fs = require('node:fs');
const { route } = require('../js/edge-router.js');
const { bootAll, fireDelegated } = require('./smoke.js');
function insideSegment(p, q, box) {
  const epsilon = .001;
  if (p.x === q.x) return p.x > box.x + epsilon && p.x < box.x + box.w - epsilon && Math.max(p.y, q.y) > box.y + epsilon && Math.min(p.y, q.y) < box.y + box.h - epsilon;
  return p.y > box.y + epsilon && p.y < box.y + box.h - epsilon && Math.max(p.x, q.x) > box.x + epsilon && Math.min(p.x, q.x) < box.x + box.w - epsilon;
}
async function run() {
  let passed = 0;
  function test(name, f) { f(); passed++; console.log('✓ ' + name); }
  const a = { x: 0, y: 0, w: 140, h: 60 };
  for (const [name, b] of Object.entries({ right: { x: 300, y: 0, w: 160, h: 80 }, left: { x: -300, y: 0, w: 160, h: 80 }, above: { x: 0, y: -240, w: 100, h: 80 }, below: { x: 0, y: 240, w: 100, h: 80 }, diagonal: { x: 270, y: 160, w: 140, h: 60 }, close: { x: 150, y: 0, w: 140, h: 60 } })) {
    test('路径避开两端节点：' + name, () => {
      for (const from of ['n','e','s','w']) for (const to of ['n','e','s','w']) {
      const r = route(a, b, { from: { side: from }, to: { side: to } });
      assert.equal(r.fromSide, from); assert.equal(r.toSide, to); assert.equal(r.blocked, false, JSON.stringify(r));
      for (let i = 1; i < r.points.length; i++) {
        const p = r.points[i - 1], q = r.points[i];
        assert.ok(p.x === q.x || p.y === q.y);
        assert.ok(!insideSegment(p, q, a) && !insideSegment(p, q, b), JSON.stringify(r));
      }
      }
    });
  }
  test('移动节点后磁吸点保持固定，路径随位置转弯', () => {
    const edge = { from: {side:'w'}, to: {side:'e'} };
    const before = route(a, { x: 300, y: 0, w: 140, h: 60 }, edge);
    const after = route(a, { x: -300, y: 0, w: 140, h: 60 }, edge);
    for (const r of [before, after]) { assert.equal(r.fromSide, 'w'); assert.equal(r.toSide, 'e'); }
    assert.notEqual(before.path, after.path);
  });
  const b = bootAll(), M = b.Mindmap;
  await M.open('legacy-map');
  const click = id => { const el = b.doc.getElementById(id); assert.ok(el, id); fireDelegated(el, 'click', {}); };
  test('旧导图转平级，保留全部节点、坐标和显式连线', () => {
    const m = M.state().cur;
    assert.equal(m.nodes.length, 8); assert.ok(m.flat);
    assert.ok(m.nodes.every(n => n.children.length === 0));
    assert.equal(Object.keys(m.pos).length, 8); assert.equal(m.edges.length, 7);
    assert.equal(M.state().L.nodes.size, 8);
  });
  test('画布只绘制显式连线，没有旧父子线', () => {
    const paths = b.doc.querySelectorAll('#mmStage .mm-links path');
    assert.equal(paths.filter(p => !p.classList.contains('mm-edge') && !p.classList.contains('mm-arrow')).length, 0);
    assert.equal(paths.filter(p => p.classList.contains('mm-edge')).length, 7);
  });
  test('删除一个节点不会连带删除原来的子节点', () => {
    // open selects r1; deleting r1 must leave its seven peers.
    click('mmDel');
    assert.equal(M.state().cur.nodes.length, 7); assert.ok(M.findNode('a1x'));
    assert.ok(!M.state().cur.pos.r1);
    assert.ok(M.state().cur.edges.every(e => e.from.node !== 'r1' && e.to.node !== 'r1'));
    click('mmUndo'); assert.equal(M.state().cur.nodes.length, 8);
  });
  test('新增节点不建立父子关系或自动连线', () => {
    const edges = M.state().cur.edges.length;
    click('mmChild');
    assert.equal(M.state().cur.nodes.length, 9);
    assert.equal(M.state().cur.edges.length, edges);
    assert.ok(M.state().cur.nodes.every(n => n.children.length === 0));
    // Escape finishes the new-node editing state before undo.
    const input = b.doc.querySelector('.mm-edit');
    assert.ok(input); input.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(M.state().cur.nodes.length, 8);
  });
  test('重新打开后平级节点、位置和连线保持', () => {
    const disk = JSON.parse(b.localStorage.getItem('mm_map_legacy-map'));
    assert.equal(disk.flat, true); assert.equal(disk.nodes.length, 8);
    assert.ok(disk.nodes.every(n => n.children.length === 0));
  });
  test('画布、命中和 PNG 使用同一个路由器', () => {
    const src = fs.readFileSync(require.resolve('../vendor/mindmap.js'), 'utf8');
    for (const [start, end] of [['function edgeAt(', 'function magnetAt('], ['function edgeSvg(', 'function markEdgeHot('], ['function exportPng(', 'function listHtml(']]) {
      const body = src.slice(src.indexOf(start), src.indexOf(end));
      assert.ok(body.includes('MMEdgeRouter.route'), start);
      assert.ok(!body.includes('linkPath('), start);
    }
  });
  console.log(`\n${passed} 项通过；真实鼠标与 PNG 像素效果需浏览器验证。`);
}
module.exports = { run };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
