'use strict';
// Fake SSE only; never sends a network request to a model.
const assert=require('node:assert/strict'),{readCompletion,usageOptions}=require('../js/ai-stream.cjs'),U=require('../js/ai-usage.js'),C=require('../js/capacity.js');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const frame=v=>'data: '+JSON.stringify(v)+'\n\n',content=s=>frame({choices:[{delta:{content:s}}]}),end=frame({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n';
async function stream(usage,options={}){let stats;await readCompletion(new Response(content('正文')+frame({choices:[],usage})+end,{headers:{'content-type':'text/event-stream'}}),{maxOutputTokens:65536,...options,onStats:s=>stats=s});return stats;}
(async()=>{
 check('Requested capacities are 32 MiB for answers and 512 MiB for map JSON',()=>{assert.equal(C.answerBytes,32*1048576);assert.equal(C.documentBytes,512*1048576);assert(C.documentWarnBytes<C.documentBytes);});
 const a=await stream({prompt_tokens:1000,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200,completion_tokens:100,completion_tokens_details:{reasoning_tokens:30}});
 check('Provider input cache hit/miss and reasoning usage are normalized without adding reasoning twice',()=>{assert.equal(a.cacheHitTokens,800);assert.equal(a.cacheMissTokens,200);assert.equal(a.completionTokens,100);assert.equal(a.reasoningTokens,30);assert.equal(a.completionState,'completed');assert(a.completedAt>=a.startedAt);});
 const b=await stream({prompt_tokens:500,prompt_tokens_details:{cached_tokens:300},completion_tokens:50});
 check('Standard cached input maps to cache hit; misses are explicitly derived',()=>{assert.equal(b.cacheHitTokens,300);assert.equal(b.cacheMissTokens,200);assert.equal(b.cacheMissDerived,true);});
 const unknown=await stream({prompt_tokens:100,completion_tokens:12});
 check('An absent cache counter stays unknown instead of being treated as zero',()=>{assert.equal(unknown.cacheHitTokens,undefined);assert.equal(unknown.cacheMissTokens,undefined);});
 const zero=await stream({prompt_tokens:100,prompt_tokens_details:{cached_tokens:0},completion_tokens:12});
 check('An explicitly reported zero is retained',()=>{assert.equal(zero.cacheHitTokens,0);assert.equal(zero.cacheMissTokens,100);});
 let oldStats;await readCompletion(new Response(JSON.stringify({choices:[{message:{content:'正文'},finish_reason:'stop',usage:{prompt_tokens:100,completion_tokens:5}}]}),{headers:{'content-type':'application/json'}}),{onStats:s=>oldStats=s});
 check('Legacy choice-level provider usage is also accepted',()=>assert.equal(oldStats.completionTokens,5));
 const calls=U.collect({calls:[a,b,unknown],transfer:{answer:a},inspection:{transfer:a,mathReview:{inspection:{transfer:b}},planning:{transfer:unknown}}});
 check('Live transfers, terminal snapshots and audit aliases are counted once per call ID',()=>assert.equal(calls.size,3));
 const sum=U.summarize(calls);
 check('Task totals use only actual reported tokens and identify partial cache coverage',()=>{assert.equal(sum.promptTokens,1600);assert.equal(sum.completionTokens,162);assert.equal(sum.cacheHitTokens,1100);assert.equal(sum.cacheHitTokensKnown,2);assert.equal(sum.calls,3);assert.equal(sum.reasoningTokens,30);});
 U.collect({transfer:{answer:{...a,updatedAt:a.updatedAt+1,answerBytes:100}}},calls);U.collect({transfer:{answer:a}},calls);
 check('Repeated polling replaces a cumulative call counter and rejects stale updates',()=>{assert.equal(calls.get(a.callId).answerBytes,100);assert.equal(calls.size,3);});
 const ledger=U.collect({runs:[{calls:[a]},{inspection:{transfer:b}}],structureReview:{stages:[{inspection:{transfer:unknown}}]}});
 check('Lecture phases and structure review contribute to one persisted task ledger',()=>assert.equal(ledger.size,3));
 check('Only documented official endpoints get the stream usage option; custom proxies stay compatible',()=>{assert.deepEqual(usageOptions({baseURL:'https://api.deepseek.com'}),{stream_options:{include_usage:true}});assert.deepEqual(usageOptions({baseURL:'https://api.moonshot.cn/v1'}),{stream_options:{include_usage:true}});assert.deepEqual(usageOptions({baseURL:'https://example.invalid/v1'}),{});assert.deepEqual(usageOptions({baseURL:'https://api.deepseek.com.example.invalid'}),{});});
 const large='x'.repeat(9*1048576);let received;await readCompletion(new Response(content(large)+end,{headers:{'content-type':'text/event-stream'}}),{onStats:s=>received=s});
 check('A single streamed response exceeding the previous 8 MiB cap is accepted',()=>assert.equal(received.answerBytes,9*1048576));
 let truncated;try{await readCompletion(new Response(content('已生成')+frame({choices:[{delta:{},finish_reason:'length'}]})+frame({choices:[],usage:{prompt_tokens:10,completion_tokens:32768}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),{maxOutputTokens:65536});}catch(e){truncated=e;}
 check('Truncation retains exact usage and stable call identity for final diagnostics',()=>{assert.equal(truncated.transfer.completionState,'failed');assert.equal(truncated.transfer.completionTokens,32768);assert(truncated.transfer.callId);});
 console.log(checks+' usage checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
