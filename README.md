# Fuse Beads MS · 豆间

独立的网页拼豆工作室，用来快速迭代数字拼豆玩法、微缩场景与手绘渲染。纯前端、本地存档，使用 Three.js + TypeScript + Vite；不需要 Cocos、父项目或后端。

![微缩拼豆工作室](docs/images/workshop.png)

## 运行

需要 Node.js 22.12+ 和支持 WebGL 2 的现代浏览器，本机使用 Node.js 24.13.0。

```powershell
git clone git@github.com:fsrshaorong/fuse_beads_ms.git
cd fuse_beads_ms
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173/>。六张美术纹理已包含在仓库里，`prepare:assets` 只检查本地文件。运行时不连接参考网站、CDN 或游戏服务器。

```powershell
npm run build
npm run preview
```

生产预览为 <http://127.0.0.1:4173/>。`dist/` 可由静态 Web 服务承载；不支持直接双击 HTML。开发服务只监听本机。

## 玩法

- 工作室：WASD 走动，右键拖动观察，滚轮调整距离；走近工作台按 E 坐下。
- 桌面：点击棋盘或向前滚轮，沿同一摄影机平滑进入拼豆；进入的第一次点击不会落豆。
- 拼豆：13 张图案，数字选色，点击或连续拖动放豆；B 放豆、X 擦除，支持整笔撤销/重做。错色保留目标编号。
- 近景：滚轮连续缩放；WASD 或空格拖动平移。拉远到全板后停稳，再向后滚动返回桌面；E 起身。
- 熨烫：图案正确后按住拖动熨斗覆盖成品，松开暂停，完成后收进本地收藏与陈列架。
- 美术：右上按钮调整笔触、暖光与阴影；“恢复参考效果”回到柔光玩具房默认参数。模型和笔触没有时间抖动。

存档键为 `fuse-beads.web-playground.v1`，兼容拆分前同源页面的本地作品。保存各图案草稿、选色、熨烫覆盖与成品；刷新从工作室恢复。撤销历史仅限当前会话。损坏存档保留原值并暂停覆盖。

## 迭代入口

| 内容 | 文件 |
| --- | --- |
| 制作动作、只读状态与存档校验 | `src/App/WorkshopApplication.ts` |
| 数字填色、整笔历史与三层交互规则 | `src/Core/Gameplay/` |
| 世界、桌面、拼豆的连续镜头 | `src/Scene/WorkshopCamera.ts` |
| 家具、人物、场景色板与建模 | `src/Scene/WorkshopEnvironment.ts` |
| 有贯穿孔和倒角的实例化拼豆 | `src/Rendering/BeadBoardView.ts` |
| 参考配置、笔触与光影公式 | `src/Rendering/ReferenceProfile.ts`、`PainterlyShaders.ts`、`PainterlyMaterials.ts` |
| 五盏灯、阴影与颜色输出 | `src/Rendering/PainterlyLighting.ts` |
| 熨斗和成品展示 | `src/Scene/FinishingView.ts` |
| 界面与输入 | `src/Ui/WorkshopHud.ts`、`src/main.ts`、`src/styles.css` |

渲染对照说明见 [docs/RENDERING.md](docs/RENDERING.md)，迁移与资产来源见 [docs/PROVENANCE.md](docs/PROVENANCE.md)。场景布局是拼豆工作室，渲染以指定参考页面的实际公式和参数为准。

模型目前为程序化美术样板：空心豆为 28 段旋转剖面，工作室有家具、灯、收纳罐、工具、布帘与植物。还没有最终 Blender 精修资产、模型 LOD、音效、揭纸动画、豆间熔接桥或成品自由旋转。桌面键鼠是当前验收目标，触屏未完成验收。

## 验证

```powershell
npm test
npm run build
npm run --silent scenario -- finish
npm run selfcheck
npm run selfcheck:rendering
```

`selfcheck` 需先启动开发服务及安装 Chrome；可用 `ATELIER_BROWSER` 指定浏览器路径，`ATELIER_URL` 指定服务地址。测试使用独立浏览器 context，不改当前试玩页存档。截图与报告保存在忽略目录 `artifacts/`。

渲染自检会联网获取原站着色代码作为独立对照；已有缓存后可用 `npm run selfcheck:rendering -- --offline`。应用本身不需要该网络访问。

公开 `window.beadsAtelier.dispatch/read/projectCell/metrics` 供本地工具使用；dispatch 与 UI、CLI 共用 Application 入口。纯值测试覆盖作品往返、整笔历史、存档、熨烫恢复和镜头边界；浏览器测试覆盖真实键鼠完整路径与四个桌面尺寸。
