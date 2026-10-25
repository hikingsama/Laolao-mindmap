'use strict';
const {makePlan}=require('./structure-review-fixture.cjs');
exports.answer=payload=>{
 const content=payload.messages.at(-1).content,text=Array.isArray(content)?content[0].text:content,input=JSON.parse(text.split('\n\n附带')[0]);
 if(payload.messages[0].content.includes('你是整图结构复核员'))return{stage:'structure',input,output:makePlan(input)};
 if(input.stage==='survey')return{stage:'survey',input,output:{units:[{title:'选择题及解析',topic:'定积分',key:'同一道完整题目',scope:'题目条件与解析，跨页内容需要完整相接。',continuesBefore:false,continuesAfter:false,citations:input.pages.map(p=>({documentId:p.documentId,page:p.page}))}]}};
 if(input.stage==='plan')return{stage:'plan',input,output:{units:[{id:'u1',title:'选择题：完整题目与解析',topic:'定积分',goal:'完整整理题目、选项、推导与结论。',sourceIds:input.index.map(u=>u.id),dependsOn:[]}]}};
 if(input.stage==='extract')return{stage:'extract',input,output:{edges:[],nodes:[{id:'n1',title:'完整题目与解析',topic:'定积分',brief:'完整整理题目条件和推导过程。',origin:'source',citations:input.pages.map(p=>({documentId:p.documentId,page:p.page})),blocks:[{type:'text',text:'### 题目与选项\n\n- A：条件一。\n- B：条件二。\n- C：条件三。\n- D：条件四。\n\n### 第一步：分析条件\n\n'+ '保留完整题目与必要的推理依据。'.repeat(18)},{type:'math',latex:'F(b)-F(a)'},{type:'text',text:'### 第二步：核对结论\n\n后台完整结果末尾，不应截断。'}]}]}};
 throw Error('Unexpected fixture stage '+input.stage);
};
