"use strict";
const json=(res,status,value)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
exports.createHandler=({settings=require("./ai-config.cjs").createService(),chat}={})=>{
  chat ||= require("./ai-chat.cjs").createService({getConfig:()=>settings.active()});
  const multi=require('./ai-map-summary.cjs').createService({getConfig:()=>settings.active()});
  return async(req,res,port)=>{
    if(!["127.0.0.1:"+port,"localhost:"+port].includes(req.headers.host) || req.headers.origin && !["http://127.0.0.1:"+port,"http://localhost:"+port].includes(req.headers.origin)){req.resume();return json(res,403,{error:"仅允许本机页面访问"});}
    try{
      if(req.url==='/api/ai/prompts' && req.method==='GET')return json(res,200,{readOnly:true,prompts:require('./ai-prompts.cjs').catalog()});
      if(await settings.handle(req,res,port))return;
      if(req.url==="/api/ai/status" && req.method==="GET"){const state=settings.status();return json(res,200,{...state,protocol:"jobs-v1",features:{workspace:"canvas-workspace-v1",libraryFolders:"library-folders-v1",mapSummary:"map-summary-v1",mapReferences:"map-references-v1",workflow:"roles-v1",memory:"tree-v1",outline:"outline-v1",lectures:"lectures-v1",prompts:"prompts-v1",mathReview:"math-review-v1",structureReview:"structure-review-v1"},message:state.available?"使用已保存的模型配置；图片和PDF需要视觉模型":"请先在顶部大模型 API 接入中保存完整配置"});}
      if(await multi.handle(req,res))return;
      if(await chat.handle(req,res))return;
      req.resume();json(res,404,{error:"AI接口或任务不存在"});
    }catch(e){req.resume();if(!res.destroyed)json(res,e.status || 500,{error:e.status?e.message:"本机AI服务异常"});}
  };
};
exports.handle=exports.createHandler();
