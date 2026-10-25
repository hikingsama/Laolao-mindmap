(function(root){
 'use strict';
 // Resolve provenance, never infer attachment identity from title similarity.
 function resolve(map,nodeId){
  const nodes=new Map((map.nodes||[]).map(n=>[n.id,n])),turns=map.aiMemory?.turns||[],records=map.outlineSources||[],refs=new Map(),evidence=[],seenNodes=new Set(),seenTurns=new Set(),seenEvidence=new Set(),unavailable=[];
  const addRef=r=>{if(!r?.id&&!r?.taskId)return;const key=r.taskId&&!r.id?'task:'+r.taskId+':'+r.documentId:'media:'+r.id;const prior=refs.get(key);if(prior){if(r.pages===null||prior.pages===null)prior.pages=null;else prior.pages=[...new Set([...prior.pages,...(r.pages||[])])].sort((a,b)=>a-b);return;}refs.set(key,{...r,pages:r.kind==='pdf'?r.pages??null:null});};
  const addEvidence=(n,recordId)=>{const text=n.text;if(typeof text!=='string'||!text.trim())return;const key=recordId+'\n'+text;if(seenEvidence.has(key))return;seenEvidence.add(key);evidence.push({id:'e'+evidence.length,origin:n.originLabel||'original-extraction',recordId,title:n.title||'',text,citations:n.citations||[]});};
  function visitTurn(turn){if(!turn||seenTurns.has(turn.id))return;seenTurns.add(turn.id);for(const r of turn.sourceMaterials||[])addRef(r);visitNode(turn.sourceId);if(turn.parentTurnId)visitTurn(turns.find(t=>t.id===turn.parentTurnId));}
  function visitNode(id){if(!id||seenNodes.has(id))return;seenNodes.add(id);const n=nodes.get(id);if(!n)return;
   if(n.image||n.pdf){const id=n.image||n.pdf,file=(map.media||[]).find(m=>m.id===id);addRef({kind:n.pdf?'pdf':'image',id,mapId:map.id,name:file?.name||(n.pdf?'原PDF':'原图片'),sourceNodeId:n.id,pages:null});}
   if(n.outlineSourceId){const record=records.find(r=>r.id===n.outlineSourceId);if(record?.workflow==='text-task-v1'){
    const parts=(record.paragraphs||[]).filter(p=>!n.textSourceIds?.length||n.textSourceIds.includes(p.id));
    for(const p of parts)addEvidence({title:(record.aiAuthored?'AI编写稿':record.userEdited?'用户修订稿':'原始文字／完整识别稿')+' · 第'+p.id.slice(1)+'段',text:p.text,originLabel:record.aiAuthored?'ai-authored':record.userEdited?'user-edited':'user-text'},record.id);
    for(const ref of record.sourceMaterials||[])if(record.userEdited||parts.some(p=>p.sourceId===ref.documentId))addRef({...ref,recordId:record.id,sourceNodeId:n.id});
   }}
   if(n.outlineSourceId&&n.citations?.length){const record=records.find(r=>r.id===n.outlineSourceId);if(record){
    for(const documentId of new Set(n.citations.map(c=>c.documentId))){const d=(record.documents||[]).find(d=>d.id===documentId);if(!d)continue;const pages=n.citations.filter(c=>c.documentId===documentId).map(c=>c.page);
     if(d.mediaId)addRef({kind:'pdf',id:d.mediaId,mapId:map.id,name:d.name,documentId,recordId:record.id,sourceNodeId:n.id,pages});
     else if(record.backgroundTaskId)addRef({kind:'pdf',taskId:record.backgroundTaskId,documentId,mapId:map.id,name:d.name,recordId:record.id,sourceNodeId:n.id,pages});
     else unavailable.push({name:d.name,reason:'原PDF未保存在导图或本地后台任务中'});
    }
    for(const run of record.runs||[]){if(run.stage!=='extract')continue;for(const original of run.inspection?.output?.nodes||[]){if(original.citations?.some(c=>n.citations.some(ref=>ref.documentId===c.documentId&&ref.page===c.page)))addEvidence(original,record.id);}}
   }}
   visitTurn(turns.find(t=>t.id===n.aiTurnId)||turns.findLast(t=>t.generatedIds?.includes(id)));
  }
  visitNode(nodeId);return{version:1,references:[...refs.values()],evidence,unavailable,lineage:[...seenNodes]};
 }
 const api={resolve};if(typeof module==='object'&&module.exports)module.exports=api;else root.MMAISources=api;
})(typeof window==='object'?window:globalThis);
