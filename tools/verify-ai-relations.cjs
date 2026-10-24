'use strict';
const assert=require('node:assert/strict');
const S=require('../js/ai-summary.cjs'),{partialGraph}=require('../js/ai-stream.cjs');
const {bootAll,loadInto,fireDelegated}=require('./smoke.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const graph={nodes:['a','b','c','d'].map(id=>({id,title:'知识单元 '+id,text:'定义、适用条件、性质和简短例子。'})),edges:[
 {from:'a',to:'b',kind:'hierarchy',label:''},
 {from:'b',to:'c',kind:'inference',label:'由此推出'},
 {from:'b',to:'d',kind:'relation',label:'是其特例'}
]};
check('Coarse kinds and custom labels survive JSON parsing and repeated normalization',()=>{
 const plan=S.parseSummary(JSON.stringify(graph));assert.deepEqual(plan.edges,graph.edges);assert.deepEqual(S.normalizeSummary(plan).edges,graph.edges);
});
check('Label overrides legacy captions and explicit blank labels remain blank',()=>{
 assert.equal(S.edgeLabel({kind:'contains',label:'等价于'}),'等价于');assert.equal(S.edgeLabel({kind:'contains',label:''}),'');assert.equal(S.edgeLabel({kind:'progression'}),'递进');assert.equal(S.edgeLabel({kind:'hierarchy'}),'');
});
check('Omitted kinds default to a general relation without losing domain language',()=>{
 const plan=S.normalizeSummary({nodes:graph.nodes.slice(0,2),edges:[{from:'a',to:'b',label:'反例'}]});assert.equal(plan.edges[0].kind,'relation');assert.equal(S.edgeLabel(plan.edges[0]),'反例');
});
check('Invalid label types, excessive lengths and control characters are rejected',()=>{
 for(const label of [null,4,{},'x'.repeat(41),'两行\n标签','\u0000'])assert.throws(()=>S.normalizeSummary({...graph,edges:[{...graph.edges[0],label}]},{partial:true}));
});
check('Custom labels do not bypass reference, duplicate or cycle validation',()=>{
 for(const edges of [[{from:'a',to:'missing',kind:'relation',label:'反例'}],[graph.edges[0],graph.edges[0]],[...graph.edges,{from:'c',to:'a',kind:'relation',label:'等价于'}]])assert.throws(()=>S.normalizeSummary({...graph,edges}));
});
check('Streaming keeps complete free labels and never inserts unfinished edges',()=>{
 assert.deepEqual(partialGraph(JSON.stringify(graph)).edges,graph.edges);const raw=JSON.stringify(graph);assert.equal(partialGraph(raw.slice(0,raw.indexOf('是其特例')+2)).edges.length,2);
});
check('A complete derivation stays in one rich node with separate formula lines',()=>{
 const plan=S.parseSummary(JSON.stringify({nodes:[{id:'proof',title:'完整证明',blocks:[{type:'text',text:'已知条件与定义。'},{type:'math',latex:'a=b'},{type:'text',text:'代入并说明理由。'},{type:'math',latex:'b=c'},{type:'text',text:'所以结论成立。'}]}],edges:[]}));assert.equal(plan.nodes.length,1);assert(plan.nodes[0].text.includes('$$\na=b\n$$'));assert(plan.nodes[0].text.includes('$$\nb=c\n$$'));
});
(async()=>{
 const b=bootAll(),M=b.Mindmap;for(const f of ['js/ai-note-format.js','js/ai-summary.js'])loadInto(b.sandbox,f,b.sandbox.window);
 const fixture=()=>({id:'relations-test',v:3,flat:true,title:'临时',nodes:[{id:'q',text:'问题',children:[]}],pos:{q:{x:0,y:0}},edges:[]});
 for(const outline of [false,true]){
  await M.openDocument(fixture());const before=JSON.stringify(M.state().cur),batch=outline?{kind:'outline'}:{};
  M.appendAIResult('relations-test',outline?null:'q',graph,'完整知识单元',batch,true);
  const after=JSON.stringify(M.state().cur);
  check((outline?'Outline':'Question')+' canvas persists exact custom labels, blanks and arrow direction',()=>{
   for(const e of graph.edges){const stored=M.state().cur.edges.find(v=>v.from.node===batch.mapping[e.from] && v.to.node===batch.mapping[e.to]);assert(stored);assert.equal(stored.label,e.label);assert.equal(stored.dir,'fwd');}
   assert.equal(JSON.parse(after).edges.find(e=>e.label==='是其特例').label,'是其特例');
  });
  fireDelegated(b.doc.getElementById('mmUndo'),'click',{});assert.equal(JSON.stringify(M.state().cur),before);fireDelegated(b.doc.getElementById('mmRedo'),'click',{});
  check((outline?'Outline':'Question')+' undo and redo restore custom relation labels exactly',()=>assert.equal(JSON.stringify(M.state().cur),after));
 }
 console.log(count+' relation and knowledge-unit checks passed; in-memory maps only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
