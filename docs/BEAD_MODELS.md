# 拼豆尺寸、图案与 Blender 模型

网页统一使用 2.6 mm Mini 拼豆：全部 15 张图案、桌面散豆和收藏共用 Mini 未熨烫与成品网格，使用同一 145 mm、52×52 钉板和 2.7 mm 节距。旧 Midi 模型保留为建模档案，不用于运行时。模型依据公开产品资料与明确的美术估值制作，不是某一品牌的制造图纸。

## 官方依据

以下厂商资料于 2026-09-07 核对。豆子与钉板参考来自不同品牌，不能将它们组合成厂商认证的整套尺寸或兼容性承诺。

| 来源 | 官方公布内容 | 本项目如何使用 |
| --- | --- | --- |
| [Perler Mini Black 2000 粒](https://perler.com/products/2-000-mini-perler-beads-black) | 实际高度 2.8 mm、宽度 2.61 mm | Mini 未熨烫豆的高度和外径 |
| [Perler Beige 1000 粒](https://perler.com/products/1-000-perler-beads-beige) | 实际高度 5.07 mm、宽度 4.77 mm | 历史 Midi 模型的高度和外径，不用于运行时 |
| [Artkal Mini BCP01](https://www.artkalfusebeads.com/products/artkal-clear-large-square-pegboard-for-mini-2-6mm-beads-bcp01) | 145×145 mm，有 50×50、52×52 两版；钉距不同，不能互接 | Mini 使用 52×52 布局；页面没有公布数值钉距 |
| [Artkal BP01-K](https://www.artkalfusebeads.com/products/artkalbeads-5mm-big-clear-square-pegboard) | 外尺寸 145×145 mm，适用 5 mm 档豆 | 历史 Midi 方板外尺寸参考 |
| [Hama 大方板 234](https://hama.dk/en/products/midi-pegboard-large-square) | 841 钉，可拼接 | 历史 Midi 方阵取 29×29，29 为由钉数计算的结果 |
| [Hama 各类拼豆](https://hama.dk/en/pages/meet-our-different-beads) | Midi 外径 5.0 mm、Mini 外径 2.5 mm | 说明同类名称下仍有品牌尺寸差异；没有覆盖上述 Perler 实际值 |

官方实物图用于判断直筒空心、平整环形端面和小圆角的外形。孔径、口沿圆角和熨烫后的几何无法从这些产品说明中获得工程尺寸，均在下表单独标记。

## 已知尺寸与估值

运行时规格在 `src/Rendering/BeadDimensions.ts`，所有图案都读取同一 Mini 参数，不再按图案大小切换规格。规则层允许最大 52×52 图案。50×50 是默认图案的画布尺寸，52×52 是承载它的实际钉阵；旧 16×16、29×29 图案也对齐这块 52×52 板的中央钉位。

| 参数 | 当前 Mini | 历史 Midi 档案（不加载） | 性质 |
| --- | --- | --- | --- |
| 未熨烫外径 / 高度 | 2.61 / 2.8 mm | 4.77 / 5.07 mm | 上述 Perler 产品公布值 |
| 未熨烫内孔 / 口沿圆角 | 1.0 / 0.07 mm | 2.5 / 0.12 mm | 建模估值 |
| 钉中心距 | 2.7 mm | 5 mm | 建模估值，非厂商工程值 |
| 方板外宽 / 钉阵 | 145 mm / 52×52（2704 钉） | 145 mm / 29×29（841 钉） | 外宽与布局来源见上表 |
| 板厚 | 2.5 mm | 2.5 mm | 建模估值 |
| 钉高 / 钉直径 | 1.8 / 0.7 mm | 3.1 / 1.6 mm | 建模估值；钉低于豆且小于内孔 |
| 熨烫后高度 / 最窄名义通径 | 2.0 / 0.35 mm | 3.7 / 1.8 mm | 视觉目标估值 |
| Mini 成品下部容钉腔 | 直径 0.8 mm，腔顶高度 1.82 mm | — | 为 1.8 mm 高钉保留空间的建模估值 |
| 熨烫后上部外形 | 2.7×2.7 mm 圆角方形，角半径 0.22 mm | 5×5 mm 圆角方形，角半径 0.65 mm | 视觉目标估值；下部保留圆筒轮廓 |

板外宽包含边框和拼接结构，首末钉只有 `N−1` 个间隔，不能用外宽除以钉数证明钉距。当前钉中心跨度为 `51×2.7 = 137.7 mm`，两侧各留 3.65 mm；这一计算只说明 Mini 模型内部布局一致。

Mini 成品的 0.35 mm 指上部最窄喉径，不是贯穿全高的直孔。下部直径 0.8 mm 的容钉腔延伸到高度 1.82 mm，再收至高度 1.93 mm 处的 0.35 mm 喉径，顶端倒角外扩到 0.49 mm 口径。这样既保留收孔外观，又能容纳 1.8 mm 高的定位钉；整段孔型均为建模估值。

## 图案细节与兼容性

默认 `atelier-strawberry-mini-50-v1`（莓果小物）是独立绘制的 50×50 图案，1159 颗、6 色，非零轮廓实际占 40×44 格。1341 格背景留空；全部非零格四连通。五片双色叶、弧形高光、右侧暗部和 19 组三格奶油籽共同构成草莓细节。

旧 `atelier-strawberry-charm-29-v1` 为 29×29、320 颗、4 色，有效轮廓为 21×24 格。把它最近邻放大为 58×58，只会把每个旧格复制四次，得到 1280 颗而保留原轮廓与细节位置。相机靠近能看清已有的孔和筒壁，缩小豆径能增加相同画面内的格数；更细腻的叶脉、轮廓和籽仍需重新绘制图案。

新图使用独立 ID 和六个独立色号，旧 14 张图案的宽高、palette、targets、色值与名称保持原值。存档 schemaVersion 仍为 1；已有存档恢复原图的格位、选色、熨烫覆盖与收藏，只有没有存档的新访客使用新默认图。

所有旧图和已保存成品也改用统一 Mini 几何与 2.7 mm 节距。旧图不重采样，不修改 cells，不复制格位来填满板；因此它们在板上和陈列架上的实际面积比原 Midi 展示更小。相同格数的图案共用相同物理大小，不按作品单独缩放。

## 世界比例与相机

共同尺度为 `1 mm = 0.006` 世界单位。145 mm 钉板宽 0.87，占 3.8 单位桌宽约 22.9%。全部未熨烫豆外径 0.01566、高度 0.0168、节距 0.0162。这是微缩工作室的构图尺度，不代表整个房间都按现实米单位重建。

桌面上沿为 Y=1.14，板上沿为 Y=1.155，未熨烫豆顶为 Y=1.1718。所有图案居中并对齐同一钉阵，换图不改变豆子和钉板的物理规格。熨烫纸放在豆顶以上 0.002 世界单位，按压时熨斗底板跟随纸面。

`WorkshopCamera` 围绕固定物理板范围构图，全板避开页头、工具栏和右侧面板，近景用于看清筒壁与端面。滚轮保持连续缩放，拉远停稳后再次滚动才退出拼豆。Mini 的密度来自固定模型与钉阵；图案本身的细节来自绘制的格位内容，不能由相机产生。

## Blender 文件与重建

| 用途 | Mini：当前运行资产 | Midi：历史建模档案 |
| --- | --- | --- |
| 参数化生成器 | `scripts/blender/generate_mini_bead_kit.py` | `scripts/blender/generate_bead_kit.py` |
| 可编辑源文件 | `assets/models/mini-bead-kit.blend` | `assets/models/bead-kit.blend` |
| GLB 网格 | `public/models/mini-bead-kit.glb`（网页唯一加载的豆子资产） | `public/models/bead-kit.glb`（网页不加载） |
| 尺寸与拓扑报告 | `public/models/mini-bead-kit.spec.json` | `public/models/bead-kit.spec.json` |

源资产由 Blender 5.2.1 LTS 生成。场景坐标以米计、界面显示毫米；导出的 glTF 为 Y-up，底面 Y=0、X/Z 中心为零、节点为单位变换。当前网页只加载 Mini GLB 中的 `MiniBead` 与 `FusedMiniBead`，按格位状态选择未熨烫或成品几何。Midi 档案中的 `MidiBead` 与 `FusedMidiBead` 仅保留供建模研究。

Mini 使用 36 个径向分段、2 段口沿圆角：未熨烫模型 864 个三角形、成品模型 936 个。历史 Midi 两个模型各 1728 个三角形。规格报告记录尺寸、边界边、非流形边、面朝向、通孔射线、平端面高度变化和 GLB 校验摘要，可据此审查生成结果。

从仓库根目录重建当前运行资产：

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_mini_bead_kit.py
```

如果 Blender 不在 PATH，使用其完整可执行路径。例如本机 Mini 重建命令：

```powershell
& 'E:\steam\steamapps\common\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_mini_bead_kit.py
```

生成器会覆盖对应 `.blend`、GLB 和规格报告；手工精修请另存源文件。Mini 生成器还会在 `artifacts/mini-models/` 输出建模诊断预览，它使用 Blender 展示灯光，不代表网页手绘材质的最终画面。网页普通构建直接使用已提交的 GLB，不要求安装 Blender。

如需复现历史 Midi 建模档案，可另行运行 `scripts/blender/generate_bead_kit.py`；它不是启动、构建或更新当前 Mini 玩法的必要步骤。

## 材质与局部熨烫

当前 GLB 的 `COLOR_0` 保存线性中性形体明暗：顶面 1.0、外壁 0.92、内壁约 0.65–0.82。它没有预先画入豆色，也不是方向光烘焙或物理 AO。运行时将形体值与实例豆色结合，再经过参考笔触、明影染色、ACES 和 sRGB 输出。统一 Mini 不改动既有静态 Shader。

房间材质维持参考配置。针对密集小几何，`bead` 的阴影强度乘 0.30、`board` 乘 0.25，二者方向光阴影采样的法线偏移上限为 0.0004 世界单位。未熨烫豆描边宽 0.25 CSS 像素，板上及陈列架上的成品关闭逐豆描边；投射、接收阴影仍保留。详细边界见 [渲染说明](RENDERING.md)。

熨斗覆盖目标格后，该格由直筒模型切换为较矮、缩孔、上部向相邻格靠拢的成品模型，未覆盖目标格保持原状；覆盖状态随存档恢复。这里没有模拟热扩散、压力、塑料流动、体积守恒或将邻豆焊成统一拓扑网格。

背景格仍可自由放豆，但不计入目标格熨烫覆盖；这些额外豆在作品整体完成时切换为成品模型。默认草莓的数字引导不要求填背景。

## 验证入口

`npm test` 检查尺寸上限、图案连通性、旧存档兼容与完整制作规则。`npm run selfcheck:beads` 检查旧 29 格图案在统一 Mini 规格下的主应用制作回归；`npm run selfcheck:mini` 使用独立组件场景检查各图案共用的 Mini GLB、着色与格位命中，不加载主应用 `main` 或 HUD。后者不代表全界面流程已获验证。浏览器脚本使用隔离 context，输出画面和报告到 `artifacts/`；各项结果应以当前执行生成的报告为准。
