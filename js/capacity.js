(function(root){
 'use strict';
 const MiB=1024*1024;
 const values={documentBytes:512*MiB,documentWarnBytes:480*MiB,inputChars:200000,conversationChars:600000,requestBytes:256*MiB,answerBytes:32*MiB,wireBytes:256*MiB,frameBytes:64*MiB,defaultOutputTokens:32768,minOutputTokens:1024,maxOutputTokens:131072,generationTimeoutMs:600000,jobTtlMs:900000,pollTimeoutMs:660000,structureTimeoutMs:360000,structurePollTimeoutMs:420000};
 values.outputTokens=(config,role='answer')=>{const raw=config?.maxOutputTokens,budget=Number.isInteger(raw)&&raw>=values.minOutputTokens&&raw<=values.maxOutputTokens?raw:values.defaultOutputTokens;return Math.min(budget,{planner:4096,math:8192,structure:24576}[role]||budget);};
 if(typeof module==='object'&&module.exports)module.exports=Object.freeze(values);else root.MMCapacity=Object.freeze(values);
})(typeof window==='object'?window:globalThis);
