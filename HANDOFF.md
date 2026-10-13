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
2. **推送通道**：本机直连 `github.com` 不通（TCP 超时），需要在**仓库本地** git 配置里设
   `http.sslBackend=openssl` 并走本机代理，token 需要 `Contents: Read and write`；
   之后 **`git push` 正常可用**（`dev` 与两次 PR 都是这么推的）。REST API 只作备用。
   *（本条于 2026-10-13 修正：原文写"用 REST API 推送、等配好 deploy key 再切回 git push"，已过期。）*

## 给下一位的关键事实

- 基线文件：`vendor/mindmap.js`，原始 sha256 `1d28e770ce4d779aa95c468349463e7cfb6b69f52f4a86378711b8699d6a62b2`（75699 字节）
- **⚠️ 行号分两栏看，照抄会踩雷（本节于 2026-10-13 修正）**：`ANALYSIS.md` 给的是**基线**的行号，
  而 `vendor/mindmap.js` 已在基线上改动了约 9KB，行号必然整体后移。实测对照：

  | 锚点 | 基线 blob `75993d3` | `vendor/mindmap.js`（当前实测） |
  |---|---|---|
  | `nodes.set(` 注入位 | 171 | **198** |
  | 横向坐标赋值 | 183 | **210** |
  | 纵向坐标赋值 | 190 | **217** |
  | 根节点居中 | 204 | **231** |
  | `layout()` 定义 | 164 | **191**（已改名 `layoutAuto()`） |
  | `endNodeDrag()` | 771 | **927** |
  | `addChild` / `addSibling` / `addParent` | 299 / 305 / 311 | **451 / 458 / 466** |
  | `fill()` | 51 | **66** |

  **改代码一律用"实测行号 + 搜索锚点"，不许照抄基线行号
  本表在 **`vendor/mindmap.js` blob `012888a4…`（1145 行）** 上实测（2026-10-13）。
  **换过代码后行号一定会再移，重测办法**：`git rev-parse HEAD:vendor/mindmap.js` 记下 blob，
  再按这几个锚点搜（锚点不会漂）：`nodes.set(`、`s.side = dir; s.x =`、`s.side = 0; s.x =`、
  `rs.side = 0; rs.x =`、`function layoutAuto()`、`function endNodeDrag(`、`function addChild(`。
  ⚠️ 提示bot 复核时给的 185/197/204/218/178/917/438… 量的是 `feat/pos-coordinates@92bac22`，
  **不是本表这份 blob**，不要混用。。**
  这份文档自己就违反过这条纪律：上一版直接把基线行号写成"完全适用"，而当时 `vendor/mindmap.js` 早已改过。
  另：提问bot 复核时给出的 185/197/204/218/191… 那组数字量的是 `feat/pos-coordinates@92bac22`（**早于**云同步停用那批改动），
  与当前 HEAD 有系统性差异 —— 这就是为什么行号只认"当场实测"。
- **已知限制（2026-10-13 新增）：约定的几何统一入口 `effRect()` 并不存在** —— 全文件 0 次命中。
  实际几何读取是散开的：`pos[id]` 直查（4 处）、`curPos()`（7 处）、`s.x = ` 覆写（4 处）、
  `L.nodes.get`（18 处），以及 `layoutWithPos()` 里的 `placed` 数组（269/270/274/276 行）。
  功能已被自测台验证（旧图播种后 8 个节点互不重叠），但**没有统一入口** ——
  以后改几何必须同时检查这几处，只改一处会出现"屏幕位置与实际位置不一致"的隐蔽 bug。
- 根目录那份 `mindmap.js`（76192 字节）是 `dev` 分支上"停用云同步"的产物，页面不加载它，两边的改动没有合并
