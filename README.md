# Laolao-mindmap · 捞捞思维导图（独立版）

从 [hangyuan2024-hue/class-calendar](https://github.com/hangyuan2024-hue/class-calendar) 根目录的
`mindmap.js` 独立出来的仓库，单独演化，**不回灌主站**。

第一版做的事：**把"位置"提升为数据**。坐标存在导图层 `cur.pos`，
拖到哪、位置就是数据；旧导图首次打开会播种一次坐标；新建节点出生就固化位置。

---

## 怎么跑（写死，不用改参数）

```bash
node server.js
```

然后打开：

```
http://127.0.0.1:8788
```

端口**固定 8788**，不随机、不跟随参数。零依赖，不需要 `npm install`。
（`npm start` 等价于 `node server.js`。）

## 自带自测

先在一个终端跑 `node server.js`，再在另一个终端跑：

```bash
node tools/smoke.js
```

它会启一个浏览器环境仿真台，把 `vendor/mindmap.js` 真跑起来，逐条验证验收情况。

---

## 目录

| 路径 | 职责 |
|---|---|
| `index.html` | 唯一页面：头部条 + 导图容器 + 弹窗 + 提示条 |
| `js/host-bridge.js` | **宿主兼容桩**：补上原文件依赖的 11 个宿主函数 + `currentView()` |
| `js/standalone.js` | 启动逻辑：容器高度、窗口变化 |
| `vendor/mindmap.js` | 导图本体（基线 sha256 `1d28e770…62b2`，改动见文件头"独立版改动记录"） |
| `css/mindmap-standalone.css` | 独立版自己的样式（原来来自主站 app.css） |
| `server.js` | 零依赖静态服务器，端口 8788 |
| `tools/smoke.js` | 本地验收自测台 |
| `HANDOFF.md` | 本轮交接：做了什么、验到哪、下一步 |

## 数据契约（第 10 条：定下即 API 契约）

```js
cur.pos = { "<节点id>": { x: 378, y: -120 } }   // x/y = 节点左上角，舞台坐标系
```

- **绝不写进节点字段**：安卓端 `MindMapDocument.normalizeNode()` 是白名单式过滤，节点字段会被静默丢掉（硬规则第 2 条）。
- 没有条目的节点仍按旧布局算法排，只是会被挪开避免压在一起。

## 第一版不做

自动布局开关 /「一键整理重排」、云同步（`mm_save` / `CCAuth` 全部打桩或剥离）、回灌主站、构建工具链重构。

## 已知限制

1. 本机直连 `github.com` 不通（TCP 超时），推送需要走本机代理并在**仓库本地** git 配置里设 `http.sslBackend=openssl`；token 需要 `Contents: Read and write`。这些都是**这台机器的环境**，不是项目要求，所以没有写进仓库。
2. 拖动一个**带子节点**的父节点时，子节点会跟着位移（保住相对位置），但不会重新布线。
3. 旧导图的播种只做一次，之后位置就是数据，不会自动重排。
4. 仓库里有**两份**导图代码：`vendor/mindmap.js`（页面实际加载的那份，含坐标改动 + 云同步已停用）和根目录 `mindmap.js`（早期"停用云同步"的基线副本，页面不加载）。合并成一份还没做 —— 这是已知的重复，不是设计。
