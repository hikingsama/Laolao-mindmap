// The two same-origin canvases share file sessions, while keeping editor/view state separate.
(() => {
 'use strict';
 document.addEventListener('keydown',e=>window.MMWorkspace?.routeKey(e),true);
 const embedded=new URLSearchParams(location.search).get('mm-pane')==='secondary'&&window.parent!==window;
 try{if(embedded&&parent.location.origin===location.origin&&parent.MMWorkspaceSessions){window.MMWorkspaceSessions=parent.MMWorkspaceSessions;window.MMWorkspaceEmbedded=true;return;}}catch{}
 window.MMWorkspaceSessions={states:new Map()};
})();
