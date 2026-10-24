(function(root){
 'use strict';
 const kind=n=>n?.mapLink?'reference':n?.pdf?'pdf':n?.image?'image':'text';
 const extras={text:['edit','marks','progress','format','math','autoSize','ask'],image:['imageView','mediaRename','originalRatio','ask'],pdf:['pdfView','mediaRename','ask'],reference:['referenceOpen','referenceSplit','referenceChange']};
 function can(n,action){return ['color','align','group','delete'].includes(action)||extras[kind(n)].includes(action);}
 const shared=(nodes,action)=>!!nodes.length&&nodes.every(n=>can(n,action));
 const api={kind,can,shared};if(typeof module==='object'&&module.exports)module.exports=api;else root.MMNodeKinds=api;
})(typeof window==='object'?window:globalThis);
