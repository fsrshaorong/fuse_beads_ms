# 来源与独立性

2026-09-07 按用户要求从 `fuse_beads` 的浏览器样板拆出，独立仓库为 `git@github.com:fsrshaorong/fuse_beads_ms.git`。提取基线：`bd3dca7`。不保留父仓库 Git 历史、Cocos 工程或联机依赖。

## 拼豆规则

`src/Core/Gameplay/Board/` 的 NumberedBeadBoard、NumberedBeadPaintingSession、PlayablePatterns、StarterPatterns，以及 `src/Core/Gameplay/Workshop/` 的 WorkshopInteractionFlow、WorkshopCameraTransition、WorkshopBeadworkZoom，来自上述基线 `assets/Scripts/Shared/Gameplay/`。这是完整的相对导入依赖闭包。拆分保留规则实现，本仓库的 `.gitattributes` 统一文本换行为 LF；此后独立维护。

## 渲染与素材

- 参考：[柔光玩具房](https://soft-toy-room-doucechen-0720.eaudoucefish.chatgpt.site/)。2026-09-07 读取的场景代码是 `/assets/ToyRoomScene-CuoAGneb.js`，SHA256 为 `7e26955303a4432b92c928b635f96196dde85480871f9b580bd2addc76eb09bd`。
- ReferenceProfile、PainterlyShaders、PainterlyMaterials 记录并移植原站渲染配置与 GLSL。差异见 [RENDERING.md](RENDERING.md)。不提交整份打包后的引擎代码。
- `public/textures/painterly/` 六张纹理来自原项目已收录的 `assets/resources/Textures/Painterly/`；原站资源目录为 `/textures/ustwo-article/`。原文件随仓库保留，应用不运行时下载它们。
- 工作室和拼豆模型由 TypeScript 生成，未复制原站整套房间几何。旧项目的 ToyRoomFurniture GLB 未被这个玩法场景使用，因此没有加入仓库。

第三方依赖许可由各 npm 包提供；本文件是来源记录，不为参考美术另行声明许可证。
