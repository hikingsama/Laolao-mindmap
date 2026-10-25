(() => {
 'use strict';
 if(window.MMWorkspaceEmbedded&&parent.MMMapSelection){window.MMMapSelection=parent.MMMapSelection;return;}
 const ids=new Set(),folderIds=new Set(),listeners=new Set();let active=false,folders=[],placements={},mapIds=new Set();
 const signature=()=>JSON.stringify([active,[...ids].sort(),[...folderIds].sort()]);
 function descendants(id){const found=new Set([id]);for(let i=0;i<16;i++)for(const f of folders)if(found.has(f.parentId))found.add(f.id);return found;}
 function normalize(){const children=new Map(folders.map(f=>[f.id,[]])),maps=new Map(folders.map(f=>[f.id,[]]));for(const f of folders)children.get(f.parentId)?.push(f.id);for(const id of mapIds)maps.get(placements[id])?.push(id);for(let i=0;i<17;i++){let changed=false;for(const f of [...folders].reverse()){const child=children.get(f.id),items=maps.get(f.id);if(child.length||items.length){const checked=child.every(id=>folderIds.has(id))&&items.every(id=>ids.has(id));if(checked!==folderIds.has(f.id)){changed=true;if(checked)folderIds.add(f.id);else folderIds.delete(f.id);}}}if(!changed)break;}}
 function change(apply){const before=signature();apply();normalize();if(before!==signature())for(const listener of [...listeners])listener();}
 function clear(){ids.clear();folderIds.clear();}
 function setFolder(id,selected){const scope=descendants(id);for(const f of scope)if(selected)folderIds.add(f);else folderIds.delete(f);for(const map of mapIds)if(scope.has(placements[map])){if(selected)ids.add(map);else ids.delete(map);}}
 const api={ids,folderIds,get active(){return active;},get size(){return ids.size+folderIds.size;},
  configure(library,maps){change(()=>{folders=library.folders||[];placements=library.placements||{};mapIds=new Set(maps);for(const id of ids)if(!mapIds.has(id))ids.delete(id);const valid=new Set(folders.map(f=>f.id));for(const id of folderIds)if(!valid.has(id))folderIds.delete(id);});},
  state(id){if(folderIds.has(id))return 'true';const scope=descendants(id);return [...folderIds].some(f=>scope.has(f))||[...ids].some(map=>scope.has(placements[map]))?'mixed':'false';},
  snapshot(){return{mapIds:[...ids],folderIds:[...folderIds]};},
  setActive(value){change(()=>{active=!!value;if(!active)clear();});},
  toggle(id){change(()=>{active=true;if(ids.has(id))ids.delete(id);else ids.add(id);});},
  toggleFolder(id){change(()=>{active=true;setFolder(id,!folderIds.has(id));});},
  add(values){change(()=>{active=true;for(const id of values)ids.add(id);});},
  remove(id){change(()=>ids.delete(id));},
  removeItems(items){change(()=>{for(const id of items.mapIds)ids.delete(id);for(const id of items.folderIds)folderIds.delete(id);});},
  clear(){change(clear);},
  prune(valid){change(()=>{for(const id of ids)if(!valid.has(id))ids.delete(id);});},
  all(scope,scopeFolders=[]){return api.size>0&&scope.every(id=>ids.has(id))&&scopeFolders.every(id=>folderIds.has(id));},
  toggleAll(scope,scopeFolders=[]){change(()=>{active=true;if(api.all(scope,scopeFolders))clear();else{for(const id of scope)ids.add(id);for(const id of scopeFolders)setFolder(id,true);}});},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
 };window.MMMapSelection=api;
})();
