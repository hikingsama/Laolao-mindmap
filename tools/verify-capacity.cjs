'use strict';
// Bounded fake streams only; no credentials or paid calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../js/capacity.js'),{readCompletion}=require('../js/ai-stream.cjs');
let checks=0;const check=(title,fn)=>{fn();checks++;console.log('PASS '+title);};
const frame=data=>'data: '+JSON.stringify(data)+'\n\n',text=t=>frame({choices:[{delta:{content:t}}]}),stop=frame({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n';
const response=s=>new Response(s,{headers:{'content-type':'text/event-stream'}});
(async()=>{
 check('Application limits are separated and larger than legacy localStorage/document limits',()=>{assert.equal(C.documentBytes,512*1048576);assert.equal(C.inputChars,200000);assert.equal(C.answerBytes,32*1048576);assert.equal(C.outputTokens({}),32768);assert.equal(C.outputTokens({maxOutputTokens:65536}),65536);assert.equal(C.outputTokens({maxOutputTokens:65536},'planner'),4096);});
 let stats;const big='中'.repeat(400000),wire=Array.from({length:40},(_,i)=>text(big.slice(i*10000,(i+1)*10000))).join('')+stop;
 assert.equal(await readCompletion(response(wire),{maxOutputTokens:65536,onStats:s=>stats=s}),big);
 check('A response above the old 1 MiB ceiling is accepted with the exact UTF-8 count',()=>{assert.equal(stats.answerBytes,1200000);assert.equal(stats.answerLimitBytes,32*1048576);assert.equal(stats.maxOutputTokens,65536);});
 const usage=frame({choices:[],usage:{prompt_tokens:2100,completion_tokens:32768,total_tokens:34868,completion_tokens_details:{reasoning_tokens:500}}});let error;
 try{await readCompletion(response(text('已完成的正文')+frame({choices:[{delta:{},finish_reason:'length'}]})+usage+'data: [DONE]\n\n'),{maxOutputTokens:65536});}catch(e){error=e;}
 check('Truncation distinguishes requested budget, platform-reported usage and byte size',()=>{assert.equal(error.code,'AI_OUTPUT_TRUNCATED');assert(error.message.includes('65,536'));assert(error.message.includes('32,768'));assert.equal(error.transfer.finishReason,'length');assert.equal(error.transfer.reasoningTokens,500);assert.equal(error.transfer.completionTokens,32768);assert.equal(error.transfer.promptTokens,2100);});
 let missing;try{await readCompletion(response(text('正文')+frame({choices:[{delta:{},finish_reason:'length'}]})+'data: [DONE]\n\n'),{maxOutputTokens:32768});}catch(e){missing=e;}
 check('Missing provider usage is stated as missing, never inferred from the requested limit',()=>{assert(missing.message.includes('平台未提供实际token用量'));assert.equal(missing.transfer.completionTokens,undefined);});
 const records=new Map(),events=[];let failing=false;const fakeStorage={getItem:k=>records.get(k)??null,setItem(k,v){if(failing)throw Error('QuotaExceededError');records.set(k,String(v));},removeItem:k=>records.delete(k)};
 const w={localStorage:fakeStorage,setTimeout,clearTimeout,Event,addEventListener(){},dispatchEvent:e=>events.push(e.type)};w.window=w;const context=vm.createContext(w);vm.runInContext(fs.readFileSync(require.resolve('../js/document-cache.js'),'utf8'),context);
 const cache=w.MMDocumentCache;await cache.ready;cache.set('mm_map_fallback',{id:'fallback',text:'原草稿'});assert(await cache.flush());
 failing=true;cache.set('mm_map_fallback',{id:'fallback',text:'新草稿'});assert.equal(await cache.flush(),false);
 check('Cache quota failure retains current edits in memory and does not misreport physical disk capacity',()=>{assert.equal(cache.get('mm_map_fallback').text,'新草稿');assert(cache.warning.includes('不表示硬盘已满'));});
 failing=false;assert(await cache.flush());check('A failed cache write can be retried without losing edits',()=>{assert.equal(JSON.parse(records.get('mm_map_fallback')).text,'新草稿');assert.equal(cache.warning,'');});
 console.log(checks+' capacity checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
