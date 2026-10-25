'use strict';
const capacity=require('./capacity.js'),fail=message=>{throw Object.assign(Error(message),{status:400});};
const full=(value,label,max=capacity.conversationChars)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(label+'过长或格式无效；未截断正文，请缩小完整资料范围');return value;};
function media(m){
 if(!m||!['image','pdf'].includes(m.kind)||!Array.isArray(m.images)||!m.images.length||m.kind==='image'&&m.images.length!==1)fail('附件应包含完整图片或PDF页图');
 const seen=new Set();const images=m.images.map(i=>{const dataUrl=full(i?.dataUrl,'页图',2*1024*1024),match=/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);if(!match||match[2].length%4)fail('附件必须为内嵌PNG/JPEG图片');const data=Buffer.from(match[2],'base64');if(match[1]==='jpeg'?data[0]!==255||data[1]!==216||data[2]!==255:!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('附件图片格式无效');if(m.kind==='pdf'&&(!Number.isSafeInteger(i.page)||i.page<1||seen.has(i.page)))fail('PDF页码无效或重复');seen.add(i.page);return{dataUrl,...(m.kind==='pdf'?{page:i.page}:{})};});
 return{kind:m.kind,name:full(m.name,'附件名称',160),documentId:full(m.documentId,'文档编号',100),sourceNodeId:full(m.sourceNodeId,'来源节点',100),text:full(m.text,'原文'),images};
}
function normalize(value){
 if(!value||value.version!==1||!Array.isArray(value.sources)||value.sources.length>32||!Array.isArray(value.evidence)||value.evidence.length>2000||!Array.isArray(value.unavailable)||value.unavailable.length>32)fail('完整来源材料格式无效');
 const sources=value.sources.map(media),evidence=value.evidence.map((n,i)=>({id:'e'+i,origin:['user-text','user-edited','ai-authored'].includes(n.origin)?n.origin:'original-extraction',title:full(n.title,'提炼标题',200),text:full(n.text,'完整提炼正文'),citations:Array.isArray(n.citations)?n.citations.map(c=>{if(typeof c.documentId!=='string'||c.documentId.length>100||!Number.isSafeInteger(c.page)||c.page<1)fail('原始提炼出处无效');return{documentId:c.documentId,page:c.page};}):[]})),unavailable=value.unavailable.map(r=>({name:full(r.name,'附件名称',160),reason:full(r.reason,'来源状态',300)}));
 if(evidence.reduce((n,v)=>n+v.text.length,0)+sources.reduce((n,v)=>n+v.text.length,0)>capacity.conversationChars)fail('完整来源材料超过600000字符；未裁剪，请缩小范围');
 return{version:1,sources,evidence,unavailable};
}
function append(content,bundle){
 const parts=[{type:'text',text:content},{type:'text',text:'本次共同原始依据：原图/原PDF优先；original-extraction是早期完整提炼，仍需对照原页。user-text为完整原文或识别稿，user-edited为用户修订稿，ai-authored为AI编写稿，不得把AI编写稿说成权威原件。旧导图摘要与历史回答可能有裁剪或识别错误，不得据此断言原件缺失。\n'+JSON.stringify({evidence:bundle.evidence,unavailable:bundle.unavailable})}];
 bundle.sources.forEach((s,index)=>{parts.push({type:'text',text:'原始来源 '+(index+1)+'：'+s.name+(s.documentId?'；文档 '+s.documentId:'')+(s.sourceNodeId?'；来源节点 '+s.sourceNodeId:'')+(s.text?'\n完整可提取文字（可能有识别误差，以页图为准）：\n'+s.text:'')});for(const im of s.images){if(im.page)parts.push({type:'text',text:'来源 '+(index+1)+' 第'+im.page+'页'});parts.push({type:'image_url',image_url:{url:im.dataUrl}});}});return parts;
}
module.exports={full,normalize,append};
