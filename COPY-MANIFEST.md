# COPY-MANIFEST

- 复制时间（定版）：2026-10-14 03:29:56 +08:00
- 来源仓库：`C:\Users\YJSen\.dsh\bot\workspace\Laolao-mindmap`
- **来源 sha：`a820f7ba3f4d8fb67207d5d11f1d308d0880c1a5`** （分支 dev；本次内容即由该提交的 git 对象导出）
- 来源 sha 的证明方式：目标每个文件都算过 git blob sha1，与 `git ls-tree -r <sha>` 的对象 id 逐一相等（15/15 通过），因此本目录内容确实等于该提交
- **同步时工作树是否干净：干净** （同步前 `git status --porcelain` 原文为空；同步前做过 90 秒静默观察，HEAD 与工作树均无变化）
- **同步后的源状态**：HEAD = `a820f7ba3f4d8fb67207d5d11f1d308d0880c1a5`（与上方来源 sha 相同，源未再前进)；`git status --porcelain` 原文：` M tools/smoke.js |  M vendor/mindmap.js | ?? tools/blankpair.mjs | ?? tools/vischeck.mjs`
- 获取方式：`git archive --format=zip <sha>`，只取**已提交对象**，不抓活动工作树（工作树里的半成品一律不带走）
- 目标路径：`C:\Users\YJSen\Desktop\学习模块\mindmap`
- 文件数：15　总字节数：451927
- 比对：文件数 + 总字节数 + 逐文件 SHA256 → **三项一致，差异：无**

## 权威副本

**目标副本由 GPT 修改，源目录内容以复制那一刻（上方“复制时间”与“来源 sha”）为基准。**

本目录对应**已提交版本 `a820f7ba3f4d8fb67207d5d11f1d308d0880c1a5`**，可复现、可回退：在源仓库执行 `git checkout a820f7ba3f4d8fb67207d5d11f1d308d0880c1a5`（或 `git archive a820f7ba3f4d8fb67207d5d11f1d308d0880c1a5`）即可得到同一份。不要把 GPT 的改动回灌源目录。本目录不含 `.git`，不依赖源目录，可直接打开使用。

## 本次同步相对上一版的变化

上一版清单（2026-10-14 02:36:28，来源是**活动工作树中间态**、无法对应任何提交）已被本清单覆盖，不再有效。本次变化：

| 相对路径 | 上一版字节 | 本次字节 | 状态（按 sha256 判定） |
|---|---|---|---|
| `.gitattributes` | 338 | 338 | 未变 |
| `.gitignore` | 215 | 215 | 未变 |
| `BRIEF.md` | 7164 | 7164 | 未变 |
| `css/mindmap-standalone.css` | (见上版清单) | 18311 | 内容已变 |
| `HANDOFF.md` | 5637 | 5637 | 未变 |
| `index.html` | 988 | 988 | 未变 |
| `js/host-bridge.js` | 3215 | 3215 | 未变 |
| `js/standalone.js` | 1133 | 1133 | 未变 |
| `mindmap.js` | 76192 | 76192 | 未变 |
| `package.json` | 268 | 268 | 未变 |
| `README.md` | (见上版清单) | 7328 | 内容已变 |
| `server.js` | 2219 | 2219 | 未变 |
| `tools/smoke.js` | (见上版清单) | 147576 | 内容已变 |
| `tools/verify-ui.mjs` | (见上版清单) | 39910 | 内容已变 |
| `vendor/mindmap.js` | (见上版清单) | 141433 | 内容已变 |

## 排除项

- ``.git/``：不包含（`git archive` 不导出，交付干净源码）。

## 文件清单与 SHA256

| # | 相对路径 | 字节 | SHA256 |
|---|---|---|---|
| 1 | `.gitattributes` | 338 | `2638BC9A1F1360E5E5C471B3CFE310F12533E48F768C2BB21591C8550BD34407` |
| 2 | `.gitignore` | 215 | `3BE295A648AC299D817EF80320C9F0282DDE660F2B57A196AE5D3DA5BD1A9764` |
| 3 | `BRIEF.md` | 7164 | `021B3637023119E7C8F88047D48904D9BFBFAEBCBE368EEBDC5223477CEE6E2C` |
| 4 | `css/mindmap-standalone.css` | 18311 | `EF3FC6DBF7134CE39197512373B5CD9991AF10C51F37A55B18DFA2B84210359D` |
| 5 | `HANDOFF.md` | 5637 | `E03CEFE932C72DA88434A03B91990F6FCE8AAC31275F2CAAE7CCA0296940582B` |
| 6 | `index.html` | 988 | `031BB78425F6CBF2578A15165440BFDF8D3B836503305ED117FBD87B670EF5ED` |
| 7 | `js/host-bridge.js` | 3215 | `FE150689B6EF72AE49414E76F7D31EA212F6D12B36ACD061F973EEB320CBC8DD` |
| 8 | `js/standalone.js` | 1133 | `ADC6DDBC1E748B239CCBF48BCC041226973A822985BC8ADD478E926BF17C0255` |
| 9 | `mindmap.js` | 76192 | `61D63E5A5E617ACA710ABDAE7E6347208C62A635A0C951C692650A885DE6699F` |
| 10 | `package.json` | 268 | `A69F9B33E7E5D3B7282131CF15B16287696FC969A508D17760B76146E3CF7FCA` |
| 11 | `README.md` | 7328 | `E21CD5B7B94892AFAC2318C6EF148C2AE6B661549343832E90D5079539F5A2B1` |
| 12 | `server.js` | 2219 | `58A1596E09F7515C7119C5778DEA7B9AB2DD7E6A90659BB21A2DF24585081436` |
| 13 | `tools/smoke.js` | 147576 | `6B30F02F19AA22D9BCB1903DCB4485E77A18AC8D08E843EB191B3586C919268B` |
| 14 | `tools/verify-ui.mjs` | 39910 | `D938D1D48708A35CF22FF979E0DB818B15FC596265B78AFD4BFB302DFFC07153` |
| 15 | `vendor/mindmap.js` | 141433 | `852DDDDB59C5AA17144A0B2B6BB179483725D19E65FBFCD1BAB1630DB06D99EA` |

合计：**15 个文件，451927 字节**。


