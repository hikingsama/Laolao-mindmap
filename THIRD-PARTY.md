# 本地浏览器依赖

添加日期：2026-10-14。发布包从 npm 官方仓库下载；没有运行安装脚本，也没有新增构建工具。所有运行时脚本、样式和公式字体均在仓库内。

| 库 | 固定版本 | 许可证 | 随项目分发体积（含许可证） | 用途 |
| --- | --- | --- | ---: | --- |
| markdown-it | 15.0.2 | MIT | 116,153 字节 | Markdown 解析，原始 HTML 关闭 |
| KaTeX | 0.19.0 | MIT | 556,426 字节 | 数学公式排版，含 20 个 WOFF2 字体 |
| html-to-image | 1.11.13 | MIT | 21,628 字节 | 把节点 DOM、公式与连线导出 PNG |
| PDF.js | 6.4.299 | Apache-2.0 | 7,180,145 字节，约6.85MiB（不含校验清单） | PDF解析、可见页面渲染、文字层、查找与页面导航 |
| 合计 | | | 7,874,352 字节（不含校验清单） | |

许可证原文位于各自 `vendor/<库名>/LICENSE`。KaTeX CSS 仅保留 WOFF2 字体地址，省略旧格式回退；JS 保持发布版本。文件校验值见 `vendor/content-assets.json`。

上游：[markdown-it](https://github.com/markdown-it/markdown-it)、[KaTeX](https://github.com/KaTeX/KaTeX)、[html-to-image](https://github.com/bubkoo/html-to-image)。

参考资料：[Obsidian Canvas](https://obsidian.md/help/Plugins/Canvas)、[LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite)。参考其保留源码、数学上下文与片段占位符的交互设计，没有移植插件代码。

PDF.js于2026-10-19添加，来自npm官方发布包 `pdfjs-dist@6.4.299`。仅保留浏览器解析器、worker、阅览组件、样式和必要的中文字符映射、标准字体、图片解码WASM及图标；没有运行包内脚本、引入构建工具或安装Node运行依赖。许可证原文位于 `vendor/pdfjs/LICENSE`，字体和字符映射目录内同时保留上游许可证。文件列表、SHA-256和发布包SHA-512记录在 `vendor/pdfjs/assets.json`；`tools/vendor-pdf.cjs` 固定版本并验证发布包完整性后提取文件。阅览器界面由本项目重新组合，未将上游通用viewer.html原样嵌入。

上游：[PDF.js源码](https://github.com/mozilla/pdf.js)、[分层及集成说明](https://mozilla.github.io/pdf.js/getting_started/)。
