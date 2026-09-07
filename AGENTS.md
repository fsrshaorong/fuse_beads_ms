# Fuse Beads MS

这是单独维护的 Three.js + TypeScript 拼豆前端。先读 README.md 和 docs/RENDERING.md，再检查 git status。用户当前指令优先于旧项目背景。

- 不依赖 Cocos、父目录或服务器。src/Core 是纯值规则，不能导入 Three.js、DOM 或本地存储。
- 规则通过 WorkshopApplication 的 dispatch/read 边界验证；不要从界面直接写格位。保留既有本地作品，测试用隔离浏览器 context。
- 用户已授权添加独立联机后端。单机仍经 WorkshopApplication；联机经 RoomService 与 Core/Multiplayer 规则，提交后再广播确认。不要直接把单机命令广播给多人或用整板历史覆盖他人操作。后端使用 Node.js 24+ 与本地 SQLite，服务器部署暂不处理；协议和接入范围见 docs/MULTIPLAYER.md。改动联机规则或传输时执行 test:multiplayer；广播/持久化改动同时执行 selfcheck:multiplayer。
- 页面已通过 OnlineWorkshopApplication 接入联机。镜头、工具和即时预览属于各自玩家；sessionStorage 保存每个标签页的身份与待确认操作，不能覆盖单机存档。发出过的 opId 与请求内容不可改变。联机界面或场景接入改动执行 selfcheck:multiplayer-browser；四座位、出生点与移动碰撞共用 Core/Multiplayer/WorkshopLayout.ts。
- 复杂动物、建筑与多层场景图案优先按 50×50 原始格位绘制，单板上限 52×52；必须增加轮廓与内部细节，不能只补空白边框或最近邻复制。简单图案可用较小格数。旧图用独立 ID 保留进度，新版优先展示；图案需检查连通性并实际查看成品渲染。
- 表面渲染采用指定柔光玩具房的实际公式与配置；按用户后续要求增加独立的稳定轮廓描边。几何、笔触与描边时钟冻结，正常镜头和工具动作独立运作。不要未经要求改回近似 PBR 混合、提亮、降饱和或新增其他后处理。
- TypeScript 使用严格类型、4 空格、Allman 花括号、分号、UTF-8 无 BOM；不引入 any，不批量改动无关文件。
- 变更后执行 npm test、npm run build、git diff --check。渲染改动执行 npm run selfcheck:rendering；描边改动同时执行 npm run selfcheck:outline；交互或装配改动在本地服务上执行 npm run selfcheck。说明实际验证范围。
- 只暂存本次文件；不提交 node_modules、dist、artifacts、日志、密钥或个人配置。默认 main，提交后按用户授权推送 origin/main；不得强推。
