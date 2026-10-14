const assert = require('node:assert/strict');
const engine = require('../js/math-completion.js');
const katex = require('../vendor/katex/katex.min.js');
const math = (s,p) => (s.slice(0,p).match(/\$/g)||[]).length % 2 === 1;
function textarea(trigger) {
  return {value:`$${trigger}$`,selectionStart:trigger.length+1,selectionEnd:trigger.length+1,
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
    setRangeText(text,a,b){this.value=this.value.slice(0,a)+text+this.value.slice(b);this.setSelectionRange(a+text.length,a+text.length);}};
}
const selected = ta => ta.value.slice(ta.selectionStart,ta.selectionEnd);
function type(ta,text){ta.setRangeText(text,ta.selectionStart,ta.selectionEnd);engine.update(ta);}
let count=0;
function test(name,fn){fn();count++;console.log('✓ '+name);}
test('所有模板都可展开、字段数量匹配、逐项输入后正确退出',()=>{
  for(const row of engine.definitions){
    const ta=textarea(row.trigger); assert.ok(engine.expand(ta,math),row.trigger);
    for(let i=0;i<row.fields.length;i++){
      assert.equal(engine.status(ta).field,row.fields[i],row.trigger);
      assert.equal(selected(ta),'□',row.trigger);
      type(ta,`x_{${i+1}}`);assert.ok(engine.handleTab(ta,false,math),row.trigger);
    }
    assert.ok(!ta.value.includes('□'),row.trigger);
    assert.equal(engine.status(ta),null,row.trigger);
    assert.equal(ta.selectionStart,ta.value.length-1,row.trigger);
    assert.doesNotThrow(()=>katex.renderToString(ta.value.slice(1,-1),{throwOnError:true}),row.trigger);
  }
});
test('定积分依次填上下限、被积函数、微分变量',()=>{
  const ta=textarea('int');engine.expand(ta,math);
  for(const value of ['0','1','x^2','x']){type(ta,value);engine.handleTab(ta,false,math);}
  assert.equal(ta.value,'$\\int_{0}^{1} x^2\\,\\mathrm{d}x$');
});
test('极限细分变量、趋近点和函数',()=>{
  const ta=textarea('lim');engine.expand(ta,math);
  for(const value of ['x','0','\\frac{\\sin x}{x}']){type(ta,value);engine.handleTab(ta,false,math);}
  assert.equal(ta.value,'$\\lim_{x\\to 0} \\frac{\\sin x}{x}$');
});
test('Shift+Tab 能返回已填内容，修改长度后后续区域不偏移',()=>{
  const ta=textarea('int');engine.expand(ta,math);type(ta,'0');engine.handleTab(ta,false,math);type(ta,'1');engine.handleTab(ta,false,math);
  engine.handleTab(ta,true,math);assert.equal(selected(ta),'1');type(ta,'2\\pi');engine.handleTab(ta,false,math);
  assert.equal(engine.status(ta).field,'被积函数');assert.equal(selected(ta),'□');type(ta,'\\sin x');engine.handleTab(ta,false,math);type(ta,'x');engine.handleTab(ta,false,math);
  assert.equal(ta.value,'$\\int_{0}^{2\\pi} \\sin x\\,\\mathrm{d}x$');
});
test('被积函数内嵌套分数，填完自动回到积分的微分变量',()=>{
  const ta=textarea('int');engine.expand(ta,math);type(ta,'0');engine.handleTab(ta,false,math);type(ta,'1');engine.handleTab(ta,false,math);
  type(ta,'frac');engine.handleTab(ta,false,math);assert.equal(engine.status(ta).field,'分子');
  type(ta,'1');engine.handleTab(ta,false,math);type(ta,'1+x^2');engine.handleTab(ta,false,math);
  assert.equal(engine.status(ta).field,'微分变量');type(ta,'x');engine.handleTab(ta,false,math);
  assert.equal(ta.value,'$\\int_{0}^{1} \\frac{1}{1+x^2}\\,\\mathrm{d}x$');
});
test('连续插入模板不会跳回旧模板；在结构外编辑不会改动原文',()=>{
  const ta=textarea('sqrt');engine.expand(ta,math);type(ta,'x');engine.handleTab(ta,false,math);
  type(ta,'+lim');engine.handleTab(ta,false,math);assert.equal(engine.status(ta).field,'变量');
  ta.setSelectionRange(0,0);type(ta,'说明：');const text=ta.value;assert.equal(engine.status(ta),null);assert.equal(ta.value,text);
});
test('普通文字不展开，带数字的矩阵命令可以展开',()=>{
  const ta=textarea('mat3');assert.ok(engine.expand(ta,math));assert.equal(engine.status(ta).total,9);
  const plain=textarea('int');plain.value='int';plain.setSelectionRange(3,3);assert.equal(engine.expand(plain,math),false);assert.equal(plain.value,'int');
});
console.log(`\n${count} 项通过；逐项覆盖 ${engine.definitions.length} 个模板。`);
