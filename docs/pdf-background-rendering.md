# PDF离屏截图与后台标签页

## 当前状态（2026-10-25）

讲义生成已进一步迁到本地Node后台子进程，PDF读取、页图渲染和后续阶段全部脱离网页；浏览器关闭后仍可继续，不再依赖下述网页渲染调度修复。浏览器内原有PDF读取接口及局部PDF.js补丁继续保留。下文是此前的动画帧修复记录，最新实现与限制见 [本地后台任务](local-background-tasks.md)。

讲义通览和内容单元回读会把原PDF页面渲染成图片。原先默认使用PDF.js显示渲染的动画帧调度；标签页没有动画帧时，render.promise无法结束，下一次模型请求也就不能开始。

生成截图现在显式传入useRequestAnimationFrame:false，使用PDF.js原有的Promise继续渲染路径，不依赖页面重绘。这个选项是本项目对PDF.js 6.4.299的局部扩展；默认仍为true，因此普通PDF阅读器保留原调度方式。没有改为print渲染意图，屏幕显示的可选图层、页面内容、批注设置及图像尺寸和质量不因本修复改变。停止仍取消当前渲染和PDF读取。

变动点是js/ai-pdf-source.js，以及vendor/pdfjs/build/pdf.mjs中render参数和内部调度选择。tools/patch-pdf-background.cjs提供幂等、版本匹配检查的补丁，tools/vendor-pdf.cjs在校验上游包后应用它。vendor/pdfjs/assets.json同时记录局部补丁名及实际文件哈希。更新PDF.js版本时若接口不匹配会停止，须人工检查，不静默丢弃扩展。

验证：node tools/verify-pdf-background-assets.cjs；浏览器验证：node tools/verify-pdf-background.cjs，使用Playwright和Edge、本地假模型、临时导图与独立端口。测试把动画帧回调彻底暂停，验证默认显示渲染可复现原卡点、离屏与显示像素一致、扫描件自动读取、整轮通览与回读、出处及一步撤销。--expect-stall仅供未修复代码的对照复现使用。

本次没有把任务推进迁到服务端。后台定时器节流仍可能延迟查询与批次衔接；页面被彻底冻结、丢弃或关闭后，不保证继续生成。测试只证明动画帧暂停不会再阻塞生成截图，不代表排除了所有后台等待。模型理解仍通过已配置的云端API完成，修复本身不增加模型请求。

这是静态脚本和PDF.js资源更新，保存当前导图后用Ctrl+Shift+R完整刷新页面即可加载。此前涉及服务端的语义流程更新仍需先重启项目服务。
