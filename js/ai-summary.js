(function (root) {
  "use strict";
  const noteFormat=typeof module==="object" && module.exports?require("./ai-note-format.js"):root.MMAINoteFormat;
  function normalizeSummary(value, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("总结返回格式错误：需要包含标题和正文的对象，请重试。");
    const maxNodes=options.lecture?64:options.outline?40:12, maxEdges=options.lecture?160:options.outline?120:30;
    const kinds=["hierarchy","inference","relation","mainline","progression","parallel","supplement","contains","prerequisite","contrast","application"];
    const raw = value.nodes === undefined ? [value] : value.nodes;
    if (!Array.isArray(raw) || !raw.length || raw.length > maxNodes) throw new Error(`总结应包含1–${maxNodes}个文字节点，请重新整理。`);
    const ids = new Set(); let total = 0;
    const nodes = raw.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || item.type && item.type !== "text") throw new Error("总结节点应为文字；图片需通过独立绘图流程生成。");
      if(item.blocks!==undefined)item={...item,text:noteFormat.blocksToText(item.blocks)};
      if (typeof item.text !== "string" || item.text.length > 20000) throw new Error("总结正文缺失或过长，请重新整理。");
      const text = options.allowEmpty ? item.text : item.text.trim();
      if (!options.allowEmpty && !text) throw new Error("总结正文为空，请编辑或重新整理。");
      const title = typeof item.title === "string" ? item.title : "";
      if (title.length > 160) throw new Error("节点标题过长，请缩短到160字符以内。");
      const cleanTitle = title.trim().replace(/^#+\s*/, "").replace(/^第\s*\d+\s*次提问[：:]\s*/, "").replace(/\s+/g," ").trim();
      const id = typeof item.id === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(item.id) && !["__proto__","prototype","constructor","__entry"].includes(item.id) && !item.id.startsWith("__image_") ? item.id : "node-" + (index + 1);
      if (ids.has(id)) throw new Error("总结节点编号重复，请重新整理。");
      if(options.outline && item.origin!==undefined && !["source","supplement"].includes(item.origin))throw new Error("节点来源标记无效");
      if(options.outline && item.origin==="supplement" && !options.allowSupplement)throw new Error("模型添加了未允许的补充内容，请重新整理");
      const refs=options.outline && item.citations!==undefined? (typeof module==='object' && module.exports?require('./ai-lecture-plan.js'):root.MMAILecturePlan).citations(item.citations,options):[];
      if(options.requireCitations && item.origin!=='supplement' && !refs.length)throw new Error('课件原文节点缺少页码出处');
      if(item.brief!==undefined && (typeof item.brief!=='string' || item.brief.length>280 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.brief)))throw new Error('节点简明概述无效');
      if(item.topic!==undefined && (typeof item.topic!=='string' || !item.topic.trim() || item.topic.length>80))throw new Error('节点主题归属无效');
      if(item.parentId!==undefined && item.parentId!==null && (typeof item.parentId!=='string' || !/^[A-Za-z0-9_-]{1,60}$/.test(item.parentId)))throw new Error('节点层级编号无效');
      ids.add(id); total += text.length;
      return { id, ...(item.brief?.trim()?{brief:item.brief.trim()}:{}), ...(item.topic?{topic:item.topic.trim()}:{}),...(item.parentId?{parentId:item.parentId}:{}),...(['overview','document'].includes(item.layoutRole)?{layoutRole:item.layoutRole}:{}), ...(Array.isArray(item.mathWarnings)?{mathWarnings:item.mathWarnings.filter(v=>typeof v==='string').slice(0,8).map(v=>v.slice(0,240))}:{}), ...(options.outline && item.citations!==undefined?{citations:refs}:{}), ...(options.outline?{origin:item.origin || "source"}:{}), type: "text", title: options.allowEmpty ? title : cleanTitle || "知识点" + (index + 1), text, imagePrompt:typeof item.imagePrompt==="string"?item.imagePrompt.slice(0,2000):"", selected: item.selected !== false };
    });
    for(const n of nodes)if(n.parentId){if(n.parentId===n.id || !options.partial && !ids.has(n.parentId))throw new Error('节点层级引用了无效父节点');const seen=new Set([n.id]);let p=n.parentId;while(p){if(seen.has(p))throw new Error('节点层级形成循环');seen.add(p);p=nodes.find(v=>v.id===p)?.parentId;}}
    if (total > 100000) throw new Error("总结内容过长，请减少节点内容。");
    const rawEdges = value.edges === undefined ? nodes.slice(1).map(n=>({from:nodes[0].id,to:n.id,kind:"parallel"})) : value.edges;
    if (!Array.isArray(rawEdges) || rawEdges.length > maxEdges) throw new Error(`总结关系应为最多${maxEdges}条连线。`);
    const seen = new Set();
    const edges = rawEdges.map(e=>{
      if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from===e.to || !kinds.includes(e.kind===undefined?"relation":e.kind)) throw new Error("总结关系引用了无效节点或关系类型，请重新整理。");
      const key=e.from+":"+e.to;
      if(seen.has(key))throw new Error("总结关系重复，请重新整理。");
      seen.add(key);
      if(e.label!==undefined && (typeof e.label!=="string" || e.label.length>40 || /[\x00-\x1f\x7f-\x9f]/.test(e.label)))throw new Error("总结连线文字应为40字符以内的单行文本");
      return {from:e.from,to:e.to,kind:e.kind===undefined?"relation":e.kind,...(e.label!==undefined?{label:e.label.trim()}: {})};
    });
    // Logical flow must be acyclic; this also bounds layout depth.
    const visiting=new Set(),done=new Set();
    function visit(id){if(visiting.has(id))throw new Error("总结关系形成循环，请按主线重新整理。");if(done.has(id))return;visiting.add(id);edges.filter(e=>e.from===id).forEach(e=>visit(e.to));visiting.delete(id);done.add(id);}
    nodes.forEach(n=>visit(n.id));
    const connected=new Set([nodes[0].id]);
    for(let pass=0;pass<nodes.length;pass++)for(const e of edges)if(connected.has(e.from) || connected.has(e.to)){connected.add(e.from);connected.add(e.to);}
    if(!options.partial && connected.size!==nodes.length)throw new Error("总结节点缺少逻辑连接，请重新整理为完整的小导图。");
    if(options.outline && !options.partial){
      const reachable=new Set([nodes[0].id]);
      for(let pass=0;pass<nodes.length;pass++)for(const e of edges)if(reachable.has(e.from))reachable.add(e.to);
      if(reachable.size!==nodes.length)throw new Error("导图应从中心主题连接到每个分支，请重新整理");
    }
    return { nodes, edges, title: nodes[0].title, text: nodes[0].text };
  }
  function parseSummary(raw, options={}) {
    let value;
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "")); }
    catch { throw new Error("总结返回格式错误：AI 未返回可解析的 JSON，请重新生成。"); }
    const generatedNodes=value?.nodes===undefined?[value]:value.nodes;
    if(Array.isArray(generatedNodes))for(const item of generatedNodes)if(item && (typeof item.text==='string' || item.blocks!==undefined)){item.text=noteFormat.generatedText(item);delete item.blocks;}
    return normalizeSummary(value,options);
  }
  const relationLabels={hierarchy:"",inference:"推导",relation:"关联",contains:"包含",prerequisite:"前提",contrast:"对比",application:"应用",entry:"展开",image:"示意图",mainline:"主线",progression:"递进",parallel:"并列",supplement:"补充说明"};
  function edgeLabel(edge){return typeof edge.label==="string"?edge.label:(relationLabels[edge.kind] || "");}
  function layoutGraph(summary, measure, options={}) {
    const plan=normalizeSummary(summary,{allowEmpty:true,...options});return layoutPlan(plan,measure);
  }
  function layoutPlan(plan,measure){
    const ranks=new Map(plan.nodes.map(n=>[n.id,0]));
    for(let pass=0;pass<plan.nodes.length;pass++)for(const e of plan.edges)ranks.set(e.to,Math.max(ranks.get(e.to),ranks.get(e.from)+1));
    const nodes=plan.nodes.map(n=>({...n,...measure(n),rank:ranks.get(n.id)}));
    let x=32;
    for(let rank=0;rank<=Math.max(...ranks.values());rank++){
      const col=nodes.filter(n=>n.rank===rank);let y=48;
      for(const n of col){n.x=x;n.y=y;y+=n.h+80;}
      x+=Math.max(...col.map(n=>n.w),0)+110;
    }
    return {nodes,edges:plan.edges,width:Math.max(...nodes.map(n=>n.x+n.w))+32,height:Math.max(...nodes.map(n=>n.y+n.h))+32};
  }
  function nodeText(n){return n.type==='entry'?`# ${n.title}`:`# ${n.origin==='supplement'?'【补充】':''}${n.title.trim().replace(/^第\s*\d+\s*次提问[：:]\s*/, '')}\n\n${n.text.trim()}`;}
  function presentationPlan(summary,entryText,images={}){
    const plan=normalizeSummary(summary,{allowEmpty:true});
    const entry={id:'__entry',type:'entry',title:entryText,text:'',selected:true};
    const nodes=[entry,...plan.nodes],edges=[...plan.edges];
    for(const n of plan.nodes)if(!edges.some(e=>e.to===n.id))edges.push({from:entry.id,to:n.id,kind:'entry'});
    for(const n of plan.nodes){const image=images[n.id];if(image?.status!=='ready' || !image.media?.id)continue;
      nodes.push({id:'__image_'+n.id,type:'image',title:n.title+' · 配图',text:'',imageFor:n.id,media:image.media,selected:image.selected!==false && (n.selected || image.parentPushed)});
      edges.push({from:n.id,to:'__image_'+n.id,kind:'image'});
    }
    return {nodes,edges};
  }
  function presentationGraph(summary,entryText,images,measure){return layoutPlan(presentationPlan(summary,entryText,images),n=>n.type==='image'?{w:280,h:220}:measure(n));}
  const api = { parseSummary, normalizeSummary, layoutGraph, relationLabels, edgeLabel, nodeText,presentationPlan,presentationGraph };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMAISummary = api;
})(typeof window === "object" ? window : globalThis);
