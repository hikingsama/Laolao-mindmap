(function (root) {
  "use strict";
  const noteFormat=typeof module==="object" && module.exports?require("./ai-note-format.js"):root.MMAINoteFormat;
  function normalizeSummary(value, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("总结返回格式错误：需要包含标题和正文的对象，请重试。");
    const raw = value.nodes === undefined ? [value] : value.nodes;
    if (!Array.isArray(raw) || !raw.length || raw.length > 12) throw new Error("总结应包含1–12个文字节点，请重新整理。");
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
      ids.add(id); total += text.length;
      return { id, type: "text", title: options.allowEmpty ? title : cleanTitle || "知识点" + (index + 1), text, imagePrompt:typeof item.imagePrompt==="string"?item.imagePrompt.slice(0,2000):"", selected: item.selected !== false };
    });
    if (total > 100000) throw new Error("总结内容过长，请减少节点内容。");
    const rawEdges = value.edges === undefined ? nodes.slice(1).map(n=>({from:nodes[0].id,to:n.id,kind:"parallel"})) : value.edges;
    if (!Array.isArray(rawEdges) || rawEdges.length > 30) throw new Error("总结关系应为最多30条连线。");
    const seen = new Set();
    const edges = rawEdges.map(e=>{
      if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from===e.to || !["mainline","progression","parallel","supplement"].includes(e.kind)) throw new Error("总结关系引用了无效节点或关系类型，请重新整理。");
      const key=e.from+":"+e.to;
      if(seen.has(key))throw new Error("总结关系重复，请重新整理。");
      seen.add(key);
      return {from:e.from,to:e.to,kind:e.kind};
    });
    // Logical flow must be acyclic; this also bounds layout depth.
    const visiting=new Set(),done=new Set();
    function visit(id){if(visiting.has(id))throw new Error("总结关系形成循环，请按主线重新整理。");if(done.has(id))return;visiting.add(id);edges.filter(e=>e.from===id).forEach(e=>visit(e.to));visiting.delete(id);done.add(id);}
    nodes.forEach(n=>visit(n.id));
    const connected=new Set([nodes[0].id]);
    for(let pass=0;pass<nodes.length;pass++)for(const e of edges)if(connected.has(e.from) || connected.has(e.to)){connected.add(e.from);connected.add(e.to);}
    if(!options.partial && connected.size!==nodes.length)throw new Error("总结节点缺少逻辑连接，请重新整理为完整的小导图。");
    return { nodes, edges, title: nodes[0].title, text: nodes[0].text };
  }
  function parseSummary(raw) {
    let value;
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "")); }
    catch { throw new Error("总结返回格式错误：AI 未返回可解析的 JSON，请重新生成。"); }
    const generatedNodes=value?.nodes===undefined?[value]:value.nodes;
    if(Array.isArray(generatedNodes))for(const item of generatedNodes)if(item && (typeof item.text==='string' || item.blocks!==undefined)){item.text=noteFormat.generatedText(item);delete item.blocks;}
    return normalizeSummary(value);
  }
  const relationLabels={entry:"展开",image:"示意图",mainline:"主线",progression:"递进",parallel:"并列",supplement:"补充说明"};
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
  function nodeText(n){return n.type==='entry'?`# ${n.title}`:`# ${n.title.trim().replace(/^第\s*\d+\s*次提问[：:]\s*/, '')}\n\n${n.text.trim()}`;}
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
  const api = { parseSummary, normalizeSummary, layoutGraph, relationLabels, nodeText,presentationPlan,presentationGraph };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMAISummary = api;
})(typeof window === "object" ? window : globalThis);
