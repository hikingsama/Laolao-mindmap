'use strict';
const {randomUUID}=require('node:crypto'),{lookup}=require('node:dns/promises'),{isIP}=require('node:net');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function imageURL(value){
  let u;try{u=new URL(value);}catch{throw fail('绘图平台未返回有效图片地址',502);}
  if(u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443')throw fail('绘图平台图片地址不受支持',502);
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const records=isIP(host)?[{address:host}]:await lookup(host,{all:true});
  const privateIP=a=>a.includes(':')?!/^[23][0-9a-f]{0,3}:/i.test(a):/^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01])|22[4-9]|23\d|24\d|25[0-5])\./.test(a) || a==='255.255.255.255';
  if(!records.length || records.some(r=>privateIP(r.address)))throw fail('绘图平台返回了非公开图片地址',502);
  return u.href;
}
async function bytes(response,limit){
  const reader=response.body.getReader();let size=0;const parts=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw fail('生成图片或平台响应过大，请降低尺寸后重试',502);parts.push(Buffer.from(value));}return Buffer.concat(parts);}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
}
exports.createService=({getConfig,fetchImpl=globalThis.fetch,validateImageURL=imageURL,timeoutMs=180000,ttlMs=300000}={})=>{
  const jobs=new Map();
  function remove(id){const j=jobs.get(id);if(j){clearTimeout(j.timer);j.controller.abort();jobs.delete(id);}}
  const view=j=>({job:j.id,status:j.status,...(j.status==='completed'?j.result:{}),...(j.error?{error:j.error}:{}),stage:j.stage});
  async function execute(job,c,prompt){
    const timer=setTimeout(()=>job.controller.abort(),timeoutMs),signal=job.controller.signal;
    try{
      job.stage='智谱正在生成配图';
      const r=await fetchImpl(c.baseURL+'/images/generations',{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.apiKey},body:JSON.stringify({model:c.model,prompt,size:c.size,watermark_enabled:true})});
      if(!r.ok){await r.body?.cancel();throw fail(r.status===401?'智谱绘图密钥验证失败':r.status===429?'智谱绘图限流或额度不足':'智谱绘图失败，请检查模型权限和接口配置',502);}
      let data;try{data=JSON.parse((await bytes(r,1024*1024)).toString('utf8'));}catch(e){if(e.status)throw e;throw fail('智谱绘图响应格式错误',502);}
      if(typeof data.data?.[0]?.url!=='string')throw fail('智谱未返回生成图片，请调整描述后重试',502);
      const url=await validateImageURL(data.data[0].url);job.stage='正在接收生成图片';
      // Image hosts never receive the API credential, and redirects are not followed.
      const image=await fetchImpl(url,{signal,redirect:'error'});if(!image.ok)throw fail('生成完成，但图片下载失败，可重试',502);
      const b=await bytes(image,20*1024*1024);
      const mime=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255 && b[1]===216 && b[2]===255?'image/jpeg':b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP'?'image/webp':null;
      if(!mime)throw fail('下载的文件不是支持的图片格式',502);
      job.result={image:{dataUrl:'data:'+mime+';base64,'+b.toString('base64'),mime}};job.status='completed';job.stage='图片已生成';
    }catch(e){job.status=signal.aborted?'cancelled':'failed';job.error=signal.aborted?'绘图已停止或等待超时；文字内容保留':e.status?e.message:'无法连接智谱绘图服务，请检查网络后重试';}
    finally{clearTimeout(timer);}
  }
  return {async handle(req,res){
    if(req.url==='/api/ai/images' && req.method==='POST'){
      try{
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw fail('请使用JSON格式提交',415);
        let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>16384)throw fail('配图描述过长',413);parts.push(part);}
        let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('配图请求格式错误');}
        if(typeof input?.prompt!=='string' || !input.prompt.trim() || input.prompt.length>2400)throw fail('请填写1–2400字的配图描述');
        const id=input.requestId || randomUUID();if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id))throw fail('请求编号无效');
        if(jobs.has(id)){json(res,202,view(jobs.get(id)));return true;}
        if([...jobs.values()].filter(j=>j.status==='running').length>=2)throw fail('最多同时生成两张配图，请稍后再试',429);
        if(jobs.size>=8){const old=[...jobs.values()].find(j=>j.status!=='running');if(old)remove(old.id);}
        const config=getConfig();if(res.destroyed)return true;
        const job={id,status:'running',controller:new AbortController(),stage:'正在准备绘图'};job.timer=setTimeout(()=>remove(id),ttlMs);job.timer.unref?.();jobs.set(id,job);
        res.once('close',()=>{if(!res.writableEnded)remove(id);});json(res,202,view(job));void execute(job,config,input.prompt.trim());
      }catch(e){req.resume();if(!res.destroyed)json(res,e.status||500,{error:e.status?e.message:'绘图请求处理失败'});}return true;
    }
    const m=/^\/api\/ai\/image-jobs\/([A-Za-z0-9_-]{1,80})$/.exec(req.url);
    if(!m)return false;const j=jobs.get(m[1]);if(!j){json(res,404,{error:'绘图任务不存在或已过期'});return true;}
    if(req.method==='GET')json(res,200,view(j));else if(req.method==='DELETE'){remove(m[1]);json(res,200,{status:'cancelled'});}else json(res,405,{error:'请求方法不支持'});return true;
  },dispose(){for(const id of jobs.keys())remove(id);}};
};
