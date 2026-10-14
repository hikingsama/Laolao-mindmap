# 当前功能与后续 AI 接入

本版本发布当前画布功能，已移除本机 Codex CLI 调用、ChatGPT 登录依赖和模型地址配置；不提供 API Key，也不产生模型费用。

## 运行与验证

安装 Node.js（18 或更高），在项目目录执行 `npm start`，打开 http://127.0.0.1:8788/ 。导图及聊天记录保存在当前浏览器 localStorage，仓库没有用户导图或聊天记录。

```sh
node tools/smoke.js
node tools/verify-completion.cjs
node tools/verify-ui.mjs
```

最后一项需要 Node 22+ 和 Edge/Chrome，使用隔离浏览器及模拟模型接口验证界面，不调用真实模型。

## 已有功能

- 平级节点，自由定位，八方向调整尺寸；双击编辑，单击不触发文字编辑。
- 固定磁吸点，连接线自动转弯绕过两端节点，方向可修改，支持删除与撤销。
- Markdown / KaTeX 渲染、实时编辑预览、79 个数学补全模板及侧栏查询表。
- 节点右键样式与提问入口，每个节点独立对话历史及问题草稿。
- 回答后的总结预览与确认推送：B 在 A 旁创建，B→A，一级标题“第X次提问：主题”，一次撤销，防重复。
- 约200字是总结建议，长正文允许推送；标题换行自动合并，空标题使用“讨论总结”。
- 导图本机保存；JSON、Markdown、TXT 和 PNG 导出。

## AI 后端当前状态

`js/ai-server.cjs` 只返回未配置提示。`GET /api/ai/status` 返回 `available:false`；`POST /api/ai/chat` 返回 HTTP 503 和 `AI_NOT_CONFIGURED`，保留待发送问题。没有模拟答案冒充真实回答。

前端流程和历史总结仍可研究；已有历史总结可以推送，新回答与新总结需要后续接入模型才能生成。

## 后续接入契约

主要修改 `js/ai-server.cjs`，前端 `js/ai-sidebar.js` 使用以下流程：

1. POST `/api/ai/chat`：请求包含 `context`、`messages`，生成总结时另有 `mode:"summary"`。
2. 后端立即返回 HTTP 202：`{job:"任务ID",status:"running"}`。
3. GET `/api/ai/jobs/<id>`：返回 `running`、`completed` 或 `failed`。成功回答用 `reply`，成功总结用 `summary:{title,text}`；失败用 `error`。
4. DELETE `/api/ai/jobs/<id>`：停止任务。状态请求要快速返回，避免把模型等待时间变成浏览器长连接。
5. `js/ai-summary.js` 提供前后端共享的总结解析和标题规范化；推送由 `Mindmap.pushAISummary(mapId,nodeId,text)` 完成，不需要模型工具调用。

API Key 由每个部署者自行提供，只应由服务器读取；不放进前端、提交或日志。服务仅监听回环地址。静态服务禁止隐藏文件、服务器模块及本机配置下载。

页面实际加载 `vendor/mindmap.js`。根目录 `mindmap.js` 是历史副本。位置与尺寸在导图层 `pos`、`size`，不要改为节点字段；显式连线在 `edges`。
