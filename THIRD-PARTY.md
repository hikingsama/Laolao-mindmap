# 本地浏览器依赖

添加日期：2026-10-14。发布包从 npm 官方仓库下载；没有运行安装脚本，也没有新增构建工具。所有运行时脚本、样式和公式字体均在仓库内。

| 库 | 固定版本 | 许可证 | 随项目分发体积（含许可证） | 用途 |
| --- | --- | --- | ---: | --- |
| markdown-it | 15.0.2 | MIT | 116,153 字节 | Markdown 解析，原始 HTML 关闭 |
| KaTeX | 0.19.0 | MIT | 556,426 字节 | 数学公式排版，含 20 个 WOFF2 字体 |
| html-to-image | 1.11.13 | MIT | 21,628 字节 | 把节点 DOM、公式与连线导出 PNG |
| 合计 | | | 694,207 字节，约 678 KiB | |

许可证原文位于各自 `vendor/<库名>/LICENSE`。KaTeX CSS 仅保留 WOFF2 字体地址，省略旧格式回退；JS 保持发布版本。文件校验值见 `vendor/content-assets.json`。

上游：[markdown-it](https://github.com/markdown-it/markdown-it)、[KaTeX](https://github.com/KaTeX/KaTeX)、[html-to-image](https://github.com/bubkoo/html-to-image)。

参考资料：[Obsidian Canvas](https://obsidian.md/help/Plugins/Canvas)、[LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite)。参考其保留源码、数学上下文与片段占位符的交互设计，没有移植插件代码。
