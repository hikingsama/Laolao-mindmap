'use strict';
exports.makePlan=({title,nodes})=>{
 const root=nodes.find(n=>!n.topic) || nodes[0],roots=nodes.filter(n=>n.id===root.id || !n.topic),rootIds=new Set(roots.map(n=>n.id)),groups=new Map();
 for(const n of nodes)if(!rootIds.has(n.id)){const key=n.topic || '主要内容';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
 return{root:{nodeId:root.id,nodeIds:roots.map(n=>n.id),title:title || root.title,summary:'概括本讲的主要内容与学习路线。'},modules:[...groups].map(([title,items],i)=>({id:'m'+i,title,summary:'归纳定义、条件与应用，保持主题一致。',nodeId:items[0].id,nodeIds:[items[0].id],children:items.length>1?[{id:'c'+i,title:title+'的性质与应用',summary:'进一步解释本模块的条件、性质和应用。',nodeId:items[1].id,nodeIds:items.slice(1).map(n=>n.id),children:[]}]:[]})),reason:'合并同主题内容，以总览、主模块、子主题三级组织。',orderReason:'先基本概念，再极限连续与一元微分，最后多元微分。'};
};
