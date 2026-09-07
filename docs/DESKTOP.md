# Windows 客户端验证版

现有 Three.js 游戏通过 Electron 44.2.0 运行在独立窗口中，与网页版共用玩法、渲染和联机协议。首个交付为 Windows x64 可运行目录；尚未完成 macOS、Linux、Steam Deck 验收或正式 Steam 发布。

## 直接试玩

构建后双击 `release/Fuse Beads MS-win32-x64/FuseBeadsMS.exe`。必须保留整个目录，不能只复制 exe。程序包含模型、纹理和页面，单机启动不依赖 Vite、Node.js 安装、Steam 或游戏服务器。当前包未签名，是本地验证版。

- F11 切换全屏；WASD 相对摄像机移动，左键或中键拖动观察，E 入座或起身。
- 菜单「游戏 → 存档文件夹」打开客户端存档目录。
- 联机前在项目运行 `npm run start:server`，默认连接 `http://127.0.0.1:2567`。
- 「一起拼豆」创建小店后，在「我的小店 → 新玩家打开测试」打开另一客户端窗口，用独立身份加入；单个进程最多四个窗口。
- 当前邀请链接指向本机网页版 `http://127.0.0.1:5173/?room=...`，该链接需要另开 Vite。客户端之间也可直接输入房间号。公网邀请和 Steam 好友邀请尚未接入。

## 构建与启动

开发和打包使用项目 Node.js 环境；联机后端需要 Node.js 24+。

```powershell
npm ci
npm run desktop:package
& '.\release\Fuse Beads MS-win32-x64\FuseBeadsMS.exe'
```

仅构建并用开发运行时启动：

```powershell
npm run desktop:build
npm run desktop:start
```

`desktop:build` 先执行正式网页构建，再将主进程、预加载脚本和网页资源写入 `.desktop/`。这不是热更新模式，修改代码后需重新构建。Electron 首次使用或打包可能下载其运行时；制作完成的客户端单机不需要联网。

`desktop:package` 使用 Electron Packager 输出 Windows x64，原生 Steam 模块从 ASAR 中解包，Steam DLL 也复制到可执行文件旁。暂存目录仅放运行所需资源，不复制后端数据库、开发依赖和个人配置。`.desktop/`、`release/` 和测试报告不提交 Git。

后端地址可在启动客户端前设置环境变量 `ATELIER_MULTIPLAYER_URL`，只接受 HTTP/HTTPS 地址。后端默认允许客户端来源 `atelier://game`。部署、证书和公网入口不在本次范围。

## 存档与平台边界

默认客户端文件位于 `%APPDATA%\FuseBeadsMS\profiles\local\`：

| 文件 | 内容 |
| --- | --- |
| `workshop.json` | 各图案的单机草稿、选色、熨烫进度、收藏 |
| `workshop.backup.json` | 上一次有效单机文件 |
| `session.json` | 联机身份和待确认操作；包含身份凭据，不应公开 |

浏览器继续使用原来的 localStorage/sessionStorage。客户端有独立存档，不自动迁移浏览器作品。退出联机会恢复该客户端原来的单机作品；共享作品仍由后端 SQLite 保存。

主进程验证单机存档后串行写入临时文件，刷盘后重命名；已有有效文件先备份。正常关闭窗口会结束当前笔画并等待单机保存和联机会话写入。写入失败时允许保持窗口开启重试。损坏的已有存档或无法读取的联机会话保留原文件；不会自动用空作品覆盖，也不会自动从备份恢复。

强制结束进程或突然断电仍可能丢失最后尚未确认的操作。联机退出只保证待确认队列落盘，不等待服务器全部确认；下次启动按原 opId 重发恢复。

`src/Platform/RuntimeStorage.ts` 处理平台存储差异；`DesktopBridge.ts` 定义有限接口。`desktop/main.ts` 管理窗口、本地资源、文件和原生 SDK；`preload.ts` 暴露这些接口。渲染进程启用沙箱和上下文隔离，关闭 Node 集成，不能直接访问文件系统。资源通过 `atelier://game/` 读取，路径限制在打包目录内，禁止外部导航和任意新窗口。

验证工具可使用 `--atelier-data-dir=绝对路径` 和 `--profile=名称` 隔离存档。新增的访客测试窗口使用独立 profile；这些测试身份不会混用主窗口存档。默认同一 profile 单实例，重复启动会聚焦已有窗口。

## Steam 验证与后续接入

默认启动关闭 Steam 功能。已使用 `steamworks.js 0.4.0` 在主进程初始化本机 Steam 的测试 App ID 480，并验证原生模块可被打包后的 exe 加载。

```powershell
# 先启动并登录 Steam；480 仅用于本地 SDK 验证
& '.\release\Fuse Beads MS-win32-x64\FuseBeadsMS.exe' --steam-app-id=480

# 可选浮层兼容启动参数
& '.\release\Fuse Beads MS-win32-x64\FuseBeadsMS.exe' --steam-app-id=480 --steam-overlay
```

浮层选项调用 steamworks.js 提供的 Electron 兼容设置，涉及 GPU 进程参数；需单独验证。自动化报告区分 SDK 初始化、启用浮层参数后的画面检查和真正显示浮层，不能把 SDK 连接成功当成 Shift+Tab 浮层已经验收。

启用 Steam 且初始化成功时，默认按 SteamID 划分本地存档目录；显式 `--profile` 会覆盖这个选择。初始化失败会报告「不可用」并退回本地单机。测试报告不输出 SteamID 或账户昵称。

当前联机身份仍是已有后端签发的匿名令牌，尚未接入 Steam 身份票据验证。成就、云存档、好友邀请、大厅、Steam Input、商业 App ID、商店/Depot 上传、更新渠道都未完成。没有写入测试成就或云存档。

后续顺序：取得项目 App ID 后验证真实启动和浮层 → 后端验证 Steam 票据并建立稳定身份 → 云存档冲突规则、成就和好友邀请 → 手柄与 Steam Deck 操作 → 分平台打包及实机验收。游戏规则和渲染继续共用代码，平台能力放在 Bridge 中。

## 验证方式

```powershell
npm test
npm run desktop:package
npm run selfcheck:desktop
npm run selfcheck:desktop-steam
npm run selfcheck:desktop-steam -- --overlay
npm run selfcheck
npm run selfcheck:multiplayer-browser
git diff --check
```

- 单元与协议测试共 45 项，新增文件保存顺序、备份、损坏保护、身份隔离和资源路径边界测试。
- `selfcheck:desktop` 启动真正的打包 exe，使用临时存档和临时 SQLite 后端；检查资源离线加载、沙箱、放豆后立即关闭、重启恢复、全屏开关、双原生窗口共拼、身份重启恢复及单机存档隔离。全屏通过主进程调用验证，未自动按 F11。
- `selfcheck:desktop-steam` 要求已登录的 Steam，验证 SDK 初始化、前台渲染、无 WebGL 错误和两帧静态画面一致。报告中的 `overlayVisualVerified: false` 表示尚未验证实际浮层出现。
- 原有 `selfcheck` 检查网页键鼠、镜头、熨烫、收藏及多种宽高比；多人浏览器检查覆盖真实放豆、个人撤销、断线恢复、熨斗交接和共同收藏。

报告与截图位于 `artifacts/desktop/`。桌面流程自动化使用隐藏窗口，其帧率受窗口节流影响，不能作为性能基准。当前机器的 Steam SDK 前台场景测试帧耗时 P95 约 16.8 ms；这仅是本机当前场景抽样，不代表最低配置或跨平台性能。渲染公式未改动。

Steam 测试期间不要操作测试窗口，交互会使静态画面对比失败。可追加 `--hidden` 避免干扰当前操作；启用浮层参数的本次静态检查采用此模式，已通过 SDK 初始化、静态画面一致和零 WebGL 错误检查，不计入前台性能数据。当前完整 Windows 目录约 379 MiB。

实现参考：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[本地资源协议](https://www.electronjs.org/docs/latest/api/protocol)、[Steamworks.js](https://github.com/ceifa/steamworks.js)、[Steamworks SDK](https://partner.steamgames.com/doc/sdk)。
