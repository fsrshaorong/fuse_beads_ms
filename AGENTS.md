# Fuse Beads MS

这是单独维护的 Three.js + TypeScript 拼豆前端。先读 README.md 和 docs/RENDERING.md，再检查 git status。用户当前指令优先于旧项目背景。

- 不依赖 Cocos、父目录或服务器。src/Core 是纯值规则，不能导入 Three.js、DOM 或本地存储。
- 规则通过 WorkshopApplication 的 dispatch/read 边界验证；不要从界面直接写格位。保留既有本地作品，测试用隔离浏览器 context。
- 表面渲染采用指定柔光玩具房的实际公式与配置；按用户后续要求增加独立的稳定轮廓描边。几何、笔触与描边时钟冻结，正常镜头和工具动作独立运作。不要未经要求改回近似 PBR 混合、提亮、降饱和或新增其他后处理。
- TypeScript 使用严格类型、4 空格、Allman 花括号、分号、UTF-8 无 BOM；不引入 any，不批量改动无关文件。
- 变更后执行 npm test、npm run build、git diff --check。渲染改动执行 npm run selfcheck:rendering；描边改动同时执行 npm run selfcheck:outline；交互或装配改动在本地服务上执行 npm run selfcheck。说明实际验证范围。
- 只暂存本次文件；不提交 node_modules、dist、artifacts、日志、密钥或个人配置。默认 main，提交后按用户授权推送 origin/main；不得强推。
