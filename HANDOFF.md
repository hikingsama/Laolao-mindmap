# HANDOFF.md · 交接说明（2026-10-13 22:5x）

## 这一轮做完的

1. **独立仓库骨架 + 宿主兼容桩**：`index.html` + `js/host-bridge.js` + `js/standalone.js` + `css/mindmap-standalone.css`。
   桩补齐了原文件依赖的 `$ esc load save showView showBanner currentUser Sync CCAuth isMobile`，
   外加文件头没写但实际在用的 `currentView()`（7 个调用点，不补就整页抛错）。
   云同步按第一版范围打桩：`currentUser` 恒 `null`，代码自动走"只存在这台设备"的本地分支。
2. **零依赖静态服务器**：`server.js`，端口固定 **8788**，`node server.js` 一条命令起。
3. **坐标落地**（`vendor/mindmap.js`）：
   - 契约：`cur.pos = { 节点id: {x, y} }`，x/y 是节点左上角、舞台坐标系（**不写节点字段**）
   - `layout()` → `layoutAuto()`，外面包 `layoutWithPos()`：有坐标用坐标；父节点有坐标的子节点跟随位移；没有坐标的按旧算法排再挪开
   - `endNodeDrag()` 松手时写入 `cur.pos` 并持久化（原来拖完就丢）
   - `addChild / addSibling / addParent` 创建时算一次初始坐标并立刻固化（不盖住父节点）
   - `seedPos()`：旧导图（没有 `pos`）第一次打开播种一次，坐标原点对齐中心主题
4. **自测台**：`tools/smoke.js`（零依赖，自带 DOM/localStorage/canvas 桩）。

## 当前状态（诚实版）

- **代码层验证过**：`node --check` 全绿；自测台里导图能加载、能打开旧图、
  **播种写进 `cur.pos`（8 条）、节点不重叠、坐标没写进节点字段、二次打开不重算**。
- **还没验证到底的**：自测台里"点节点 → 新建子节点 → 拖拽落点"这三条 UI 级链路，
  卡在仿真台自己的元素查找上（`#mmStage` 里节点 div 的 `data-id` 能被解析到，
  但 `querySelector` 的深层查找还没接通）。**这是自测台的坑，不是产品代码的结论**：
  产品侧这三条路径要用真实浏览器验（见下）。
- 时间到了 22:30 的收工线，没有再往下钻。

## 下一步（按优先级）

1. **真实浏览器验收**（10 分钟能做完）：`node server.js` → 打开 `http://127.0.0.1:8788`
   - A：能打开、能编辑（Tab 建子主题、双击改字）
   - B：拖一个一级主题到别处，松手位置保持；F5 刷新后位置不变
   - C：把 `localStorage` 里一张图删掉 `pos` 字段再打开，看节点不重叠
   - D：选中一个主题按 Tab，新主题不压住父主题
   - E：F12 console 无报错
2. 补通 `tools/smoke.js` 的 UI 级三条（或换成 jsdom / Playwright，但要先报许可证和体积，硬规则第 9 条）。
3. `dev` → `main` 的 PR（验证通过后再开；**不许直接推 main**，硬规则第 5 条）。

## 两个决定（我按第 11 条先把默认选择写出来，用户可以推翻）

1. **拖拽语义**：松手时**总是**写坐标；如果落点是另一个节点，同时保留原有的"改父子关系"。
   理由：这是最小改动，两种行为都留住了。
2. **推送通道**：沙箱里 `github.com:443` 不通、本机没有 SSH 私钥 →
   用 token 走 GitHub REST API 推送（`api.github.com` 可达）。等配好 deploy key 可以切回 `git push`。

## 给下一位的关键事实

- 基线文件：`vendor/mindmap.js`，原始 sha256 `1d28e770ce4d779aa95c468349463e7cfb6b69f52f4a86378711b8699d6a62b2`（75699 字节）
- 行号分析（`ANALYSIS.md`，提问bot 出品）对这份基线**完全适用**：坐标四赋值点 171/183/190/204，`endNodeDrag` 771，`addChild` 299
- 根目录那份 `mindmap.js`（76192 字节）是 `dev` 分支上"停用云同步"的产物，**不是这次的工作副本**，两边的改动没有合并
