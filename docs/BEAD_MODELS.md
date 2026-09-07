# 拼豆尺寸与 Blender 模型

本轮采用约 5 mm 档的拼豆与 29×29 方板，以实体尺寸关系替换此前随图案大小缩放的豆子。模型按公开产品资料和明确的美术估值制作，不是某一品牌的制造图纸，也不承诺跨品牌拼接公差。

## 官方依据

以下资料于 2026-09-07 核对，均来自厂商官方网站。

| 来源 | 官方公布内容 | 本项目如何使用 |
| --- | --- | --- |
| [Perler Beige 1000 粒](https://perler.com/products/1-000-perler-beads-beige) | 实际高度 5.07 mm、宽度 4.77 mm | 未熨烫豆的高度和外径 |
| [Hama 各类拼豆](https://hama.dk/en/pages/meet-our-different-beads) | Midi 外径 5.0 mm；Mini 外径 2.5 mm | 说明“5 mm 档”不是各品牌完全相同的尺寸；未用 Hama 外径覆盖 Perler 的实际值 |
| [Hama 大方板 234](https://hama.dk/en/products/midi-pegboard-large-square) | 841 钉，可拼接 | 规则方阵为 29×29，29 为由钉数计算的结果 |
| [Artkal BP01-K](https://www.artkalfusebeads.com/products/artkalbeads-5mm-big-clear-square-pegboard) | 外尺寸 145×145 mm，适用 5 mm 档豆 | 方板外尺寸参考 |
| [Artkal Mini BCP01](https://www.artkalfusebeads.com/products/artkal-clear-large-square-pegboard-for-mini-2-6mm-beads-bcp01) | 适用 2.6 mm 豆；145×145 mm 有 50×50、52×52 两版，钉距不同且不能互接 | 仅作规格边界说明，当前未制作 Mini 模式 |

已查看官方实物图：未熨烫豆为直筒空心短管，外侧壁基本垂直，顶底为平整环形端面，口沿只有小圆角。模型因此保留长直侧壁与真实贯穿孔。这个外形判断来自照片；圆角半径不是照片能证明的制造尺寸。

## 已知尺寸与估值

运行时共同尺度在 `src/Rendering/BeadDimensions.ts`，Blender 输出明细在 `public/models/bead-kit.spec.json`。

| 参数 | 数值 | 性质 |
| --- | --- | --- |
| 未熨烫外径 / 高度 | 4.77 / 5.07 mm | Perler 上述产品的官方值 |
| 未熨烫内孔 / 口沿圆角 | 2.5 / 0.12 mm | 美术估值 |
| 钉中心距 | 5 mm | 建模近似，未找到官方工程值 |
| 方板外宽 / 钉阵 | 145 mm / 29×29 | 分别参考 Artkal 外宽、Hama 钉数；不是单一 SKU 的完整复刻 |
| 板厚 | 2.5 mm | 美术估值 |
| 钉高 / 钉直径 | 3.1 / 1.6 mm | 美术估值；钉低于未熨烫豆，且小于内孔 |
| 熨烫后高度 / 内孔 | 3.7 / 1.8 mm | 视觉目标估值 |
| 熨烫后上部外形 | 5×5 mm 圆角方形，平面圆角半径 0.65 mm | 视觉目标估值；下部保留圆筒轮廓 |

板外宽包含边框和拼接结构，首末钉之间只有 `N−1` 个间隔，不能用外宽除以钉数来证明钉距。当前 5 mm 钉距让 29 列钉中心跨越 140 mm，边缘中心距各为 2.5 mm；这是模型内部的一致布局。

## 世界比例与相机

`1 mm = 0.006` 世界单位。145 mm 方板宽 0.87，占 3.8 单位桌宽约 22.9%；豆外径为 0.02862、高度为 0.03042、钉距为 0.03。此比例是微缩工作室的构图选择，不代表整个房间都按现实米单位重建。

桌面上沿为 Y=1.14，板上沿为 Y=1.155，未熨烫豆顶为 Y=1.18542。图案居中放在真实钉阵上，更换图案不会改变单颗豆或整块板的物理尺寸。偶数宽图案也对齐已有钉位。

`WorkshopCamera` 从共同常量计算板的完整包围范围和近景平移上限。全板视向约为 `(0, 1, 0.2)`，保留少量倾斜以看见筒高；近景相对板面的偏移约为 `(0, 0.405, 0.18)`，靠近时稍微降低俯视角，让直筒侧壁与口沿更清楚。全板自动避开页头、工具栏和右侧颜色面板，滚轮仍连续缩放，拉远停稳后再滚动才退出拼豆。

## Blender 文件与重建

| 文件 | 用途 |
| --- | --- |
| `scripts/blender/generate_bead_kit.py` | 参数化建模、网格检查、GLB 导出 |
| `assets/models/bead-kit.blend` | 可在 Blender 打开的两个模型 |
| `public/models/bead-kit.glb` | 网页加载的同一套几何 |
| `public/models/bead-kit.spec.json` | 尺寸、拓扑、通孔检查与 GLB 校验摘要 |

本次用 Blender 5.2.1 LTS 后台生成。场景坐标以米计，Blender 界面显示毫米；GLB 为 Y-up，模型底面 Y=0，X/Z 中心为零，节点变换为单位变换。`MidiBead` 与 `FusedMidiBead` 各使用 48 个径向分段、3 段口沿圆角、1728 个三角形。规格报告检查边界边、非流形边、面朝向和轴向通孔；当前两个模型的 49 条孔内射线均贯穿。

从仓库根目录运行：

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_bead_kit.py
```

如果 Blender 不在 PATH，先将 `blender` 替换为本机可执行文件的完整路径。此次使用的命令为：

```powershell
& 'E:\steam\steamapps\common\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_bead_kit.py
```

当前参数化脚本是生成依据，会重建并覆盖上述 `.blend`、GLB 和规格文件。若在 Blender 中手工精修，应先另存源文件；再次运行生成脚本不会保留对生成版 `.blend` 的手工修改。网页普通构建直接使用已提交的 GLB，不要求试玩者安装 Blender。

## 材质与局部熨烫

GLB 的 `COLOR_0` 保存线性、中性的形体明暗：顶面 1.0、外壁 0.88、内壁约 0.48–0.72。它没有预先画入具体豆色，也不是方向光烘焙或物理求解的 AO。网页将形体值与每颗豆的实例颜色结合，再进入既有参考笔触、明影染色、ACES 与 sRGB 输出。原参考 Shader 的光影公式保持原样，色号仍由玩法状态决定。

熨斗覆盖某个目标格后，该格切换为较矮、孔更小、上部向相邻格靠拢的 `FusedMidiBead`；未覆盖目标格保留直筒模型。作品完成后使用玩家真实保存格位与颜色展示成品。两种模型和覆盖状态表达制作进度，不模拟热扩散、温度、压力、塑料流动或体积守恒，也没有把相邻豆焊成一个拓扑网格。

本轮保留旧版自由背景格与存档规则：背景格可以额外放豆，但不计入目标格熨烫覆盖；这些额外豆在整体完成时统一使用成品模型。默认草莓的数字引导不会要求填写背景。
