'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const definitions=[
 ['map-summary','多导图总结','逐图梳理、主题融合与来源校验'],
 ['structure-review','整图结构复核','统一全讲模块、子主题与原节点归属，保留知识正文与出处'],
 ['math-review','数学排版复核','仅补充数学定界符，保留原有符号与推导'],
 ['outline','大纲与正文整理','理解单次文字输入并组织导图'],
 ['lecture-extract','课件分批整理','理解确切页码的课件内容，生成带出处的章节结构'],
 ['lecture-merge','多讲义主题融合','从章节结果生成跨讲义主题概览'],
 ['planner','节点提问：关联与定向','选择相关资料并确定本次回答方向'],
 ['node-graph','节点提问：生成导图','回答当前问题并生成节点与关系'],
 ['node-summary','已有讨论整理','将已有讨论整理为导图'],
 ['node-chat','节点文字问答','基于当前节点回答问题']
];
const hash=text=>createHash('sha256').update(text).digest('hex');
function read(id){const def=definitions.find(d=>d[0]===id);if(!def)throw new Error('未知提示词模板');const file='prompts/'+id+'.md',template=fs.readFileSync(path.join(__dirname,'..',file),'utf8').trim();return{id,title:def[1],description:def[2],file,template,version:hash(template).slice(0,16)};}
function render(id,{allowSupplement=false}={}){return read(id).template.replaceAll('{{supplementRule}}',allowSupplement?'允许为理解提供少量必要解释。每个补充节点必须标记 origin:"supplement"，与原文节点分开；不能冒充原文已有信息。':'严格依据原文整理，禁止新增原文没有的例子、知识点和解释；所有节点标记 origin:"source"。');}
function snapshot(id,messages,model,key=''){
 const hide=value=>typeof value==='string'?(key?value.replaceAll(key,'[密钥已隐藏]'):value):Array.isArray(value)?value.map(hide):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hide(v)])):value;
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
 return hide({promptId:id,templateVersion:read(id).version,effectiveVersion:hash(system).slice(0,16),system,model,input:messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:Array.isArray(m.content)?m.content.map(p=>p.type==='image_url'?{type:'image',note:'实际请求包含页面图像；调查记录不保存图像编码'}:p):m.content})),startedAt:Date.now()});
}
module.exports={render,snapshot,catalog:()=>definitions.map(d=>read(d[0]))};
