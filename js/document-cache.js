// Large document/recovery snapshots use IndexedDB; localStorage holds small UI/index data.
(() => {
 'use strict';
 try{if(window.MMWorkspaceEmbedded&&parent.location.origin===location.origin&&parent.MMDocumentCache){window.MMDocumentCache=parent.MMDocumentCache;return;}}catch{}
 const memory=new Map(),pending=new Map(),legacy=new Map();let db=null,timer=null,chain=Promise.resolve(),warning='';
 const valid=key=>typeof key==='string'&&/^(mm_map_|mm_recovery_v1_)[A-Za-z0-9_-]{1,100}$/.test(key);
 function report(text){warning=text;window.dispatchEvent(new Event('mm:cache-status'));}
 function transaction(entries){return new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents');for(const [key,json]of entries)if(json===null)store.delete(key);else store.put(json,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('浏览器缓存写入失败'));tx.onabort=()=>reject(tx.error||Error('浏览器缓存写入中断'));});}
 function oldValue(key){try{return localStorage.getItem(key);}catch{return null;}}
 function removeLegacy(key,json){try{if(oldValue(key)===json)localStorage.removeItem(key);}catch{}}
 const ready=(async()=>{
  if(!window.indexedDB)return;
  try{
   db=await new Promise((resolve,reject)=>{const req=indexedDB.open('laolao-mindmap-cache-v1',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('documents'))req.result.createObjectStore('documents');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('浏览器缓存升级被其他窗口占用'));});
   db.onversionchange=()=>{db.close();db=null;};
   const entries=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(valid(key)){const raw=oldValue(key);if(raw!==null)entries.push([key,raw]);}}
   // Old snapshots are removed only after the complete migration transaction succeeds.
   if(entries.length){await transaction(entries);for(const [key,raw]of entries){legacy.set(key,raw);removeLegacy(key,raw);}}
  }catch{report('浏览器恢复缓存暂不可用；请检查本地文件草稿是否已保存。');}
 })();
 async function load(keys){await ready;await Promise.all(keys.filter(valid).map(async key=>{if(memory.has(key))return;let raw;
   if(db)try{raw=await new Promise((resolve,reject)=>{const req=db.transaction('documents').objectStore('documents').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}catch{report('浏览器恢复缓存读取失败，请保留本地草稿。');}
   if(raw===undefined){raw=oldValue(key);if(raw!==null){legacy.set(key,raw);if(db){pending.set(key,raw);schedule();}}}
   if(!memory.has(key))memory.set(key,raw??null);
  }));}
 function get(key,fallback=null){if(!valid(key))return fallback;const raw=memory.has(key)?memory.get(key):oldValue(key);try{return raw===null||raw===undefined?fallback:JSON.parse(raw);}catch{return fallback;}}
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>flush(),200);}
 function set(key,value){if(!valid(key))return false;try{const raw=JSON.stringify(value);memory.set(key,raw);pending.set(key,raw);if(!legacy.has(key))legacy.set(key,oldValue(key));schedule();return true;}catch{return false;}}
 function remove(key){if(!valid(key))return;memory.set(key,null);pending.set(key,null);try{localStorage.removeItem(key);}catch{}schedule();}
 function flush(){clearTimeout(timer);chain=chain.catch(()=>{}).then(async()=>{await ready;const entries=[...pending];if(!entries.length)return true;
   try{if(db)await transaction(entries);else for(const [key,raw]of entries)if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);
    for(const [key,raw]of entries){if(pending.get(key)===raw)pending.delete(key);if(db&&legacy.has(key))removeLegacy(key,legacy.get(key));}if(warning)report('');return true;
   }catch{report('浏览器恢复缓存写入失败；这不表示硬盘已满，请检查本地文件草稿保存状态。');return false;}
  });return chain;}
 window.addEventListener('beforeunload',()=>{flush();});
 window.MMDocumentCache={ready,load,get,set,remove,flush,has:valid,get warning(){return warning;}};
})();
