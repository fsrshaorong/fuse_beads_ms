# 来源与独立性

2026-09-07 按用户要求从 `fuse_beads` 的浏览器样板拆出，独立仓库为 `git@github.com:fsrshaorong/fuse_beads_ms.git`。提取基线：`bd3dca7`。不保留父仓库 Git 历史、Cocos 工程或联机依赖。

## 拼豆规则

`src/Core/Gameplay/Board/` 的 NumberedBeadBoard、NumberedBeadPaintingSession、PlayablePatterns、StarterPatterns，以及 `src/Core/Gameplay/Workshop/` 的 WorkshopInteractionFlow、WorkshopCameraTransition、WorkshopBeadworkZoom，来自上述基线 `assets/Scripts/Shared/Gameplay/`。这是完整的相对导入依赖闭包。拆分保留规则实现，本仓库的 `.gitattributes` 统一文本换行为 LF；此后独立维护。

## 渲染与素材

- 参考：[柔光玩具房](https://soft-toy-room-doucechen-0720.eaudoucefish.chatgpt.site/)。2026-09-07 读取的场景代码是 `/assets/ToyRoomScene-CuoAGneb.js`，SHA256 为 `7e26955303a4432b92c928b635f96196dde85480871f9b580bd2addc76eb09bd`。
- ReferenceProfile、PainterlyShaders、PainterlyMaterials 记录并移植原站渲染配置与 GLSL。差异见 [RENDERING.md](RENDERING.md)。不提交整份打包后的引擎代码。
- `public/textures/painterly/` 六张纹理来自原项目已收录的 `assets/resources/Textures/Painterly/`；原站资源目录为 `/textures/ustwo-article/`。原文件随仓库保留，应用不运行时下载它们。
- 工作室家具和钉板由 TypeScript 生成，未复制原站整套房间几何。旧项目的 ToyRoomFurniture GLB 未被这个玩法场景使用，因此没有加入仓库。
- 当前运行时只加载 `public/models/mini-bead-kit.glb`，源文件 `assets/models/mini-bead-kit.blend` 由 `scripts/blender/generate_mini_bead_kit.py` 生成。所有 15 张图案、散豆与收藏统一使用其中的 Mini 未熨烫和成品网格。两种状态均在 Blender 中原创建模，没有下载第三方豆子网格。
- 旧 `assets/models/bead-kit.blend`、`public/models/bead-kit.glb`、`public/models/bead-kit.spec.json` 与 `scripts/blender/generate_bead_kit.py` 保留为 Midi 建模档案，不由网页运行时加载。它们记录此前的尺寸研究与几何，不代表仍有 Midi 玩法模式。
- Mini 未熨烫外径 2.61 mm、高度 2.8 mm 来自 [Perler Mini Black](https://perler.com/products/2-000-mini-perler-beads-black)；145 mm、52×52 钉位布局参考 [Artkal BCP01](https://www.artkalfusebeads.com/products/artkal-clear-large-square-pegboard-for-mini-2-6mm-beads-bcp01)。2.7 mm 钉距、1 mm 内孔及熨烫形态属于建模估值；这组资料来自不同品牌，不构成单一品牌整套工程尺寸。完整来源和估算项见 [BEAD_MODELS.md](BEAD_MODELS.md)。
- `atelier-strawberry-charm-29-v1` 为原创 29×29 草莓吊饰，加入时保留了原 13 款图案。新增的 `atelier-strawberry-mini-50-v1` 为原创 50×50「莓果小物」，1159 颗、6 色，新增叶脉、高光与籽的细节，并非旧图最近邻放大。它使用独立 ID 和六个独立色号，旧 14 张图案及既有存档签名保持原值。
- 统一 Mini 只改变旧作品的几何规格与实际占地，不修改旧图的格数、色号、cells 或存档签名，不对旧图做最近邻放大。旧图与新图都居中放在同一 145 mm、52×52 钉板上，收藏也按同一 Mini 节距展示。
- 房间材质继续使用原参考配置；`bead`、`board` 的局部阴影倍率与法线偏移上限，以及未熨烫豆的细描边、成品的逐豆描边关闭，是既有的微型几何适配。统一 Mini 不再修改这套静态着色或新增美术方向，详见 [RENDERING.md](RENDERING.md)。

第三方依赖许可由各 npm 包提供；本文件是来源记录，不为参考美术另行声明许可证。
