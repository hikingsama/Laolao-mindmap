"use strict";
// Provider-neutral placeholder. No local CLI, login, API key or model is used.
const unavailable = "当前版本尚未接入 AI 模型。节点提问和总结推送界面已保留，等待后续 API 接入。";
function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
exports.handle = (req, res, port) => {
  if (!["127.0.0.1:"+port,"localhost:"+port].includes(req.headers.host)) return json(res,403,{error:"仅允许本机访问"});
  if (req.headers.origin && !["http://127.0.0.1:"+port,"http://localhost:"+port].includes(req.headers.origin)) return json(res,403,{error:"请求来源不允许"});
  if (req.url === "/api/ai/status" && req.method === "GET") return json(res,200,{available:false,provider:null,protocol:"jobs-v1",message:unavailable});
  if (req.url === "/api/ai/chat" && req.method === "POST") {
    req.resume(); return json(res,503,{code:"AI_NOT_CONFIGURED",error:unavailable});
  }
  return json(res,404,{error:"AI 任务不存在：当前版本尚未接入模型。"});
};
