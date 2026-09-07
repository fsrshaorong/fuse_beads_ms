# 公网部署

2026-09-07 部署到用户提供的 `101.132.62.222`，复用用户已明确停用的旧端口。服务器为 Alibaba Cloud Linux 4 x64。网页与后端入口：**https://101.132.62.222/**；健康检查：**https://101.132.62.222/health**。

## 端口与运行目录

| 项目 | 配置 |
| --- | --- |
| 网页和 Socket.IO | Nginx HTTPS 443，同源 `/socket.io/` |
| HTTP 80 / 旧 5173 | 重定向到 HTTPS；80 保留 ACME 验证路径 |
| 后端 | `127.0.0.1:2567`，外网通过 Nginx WSS 访问 |
| systemd 服务 | `fuse-beads-ms.service`，独立 `fusebeadsms` 用户，开机自启、异常重启 |
| 代码版本目录 | `/opt/fuse-beads-ms/releases/`，`current` 链接指向生效版本 |
| 专用 Node | `/opt/fuse-beads-ms/runtime/node-v24.13.0-linux-x64/bin/node` |
| 后端环境 | `/etc/fuse-beads-ms/server.env`，不提交 Git |
| SQLite | `/var/lib/fuse-beads-ms/multiplayer.sqlite` |
| 前端 | `/var/www/fuse-beads-ms/current` |
| Nginx 配置 | `/etc/nginx/conf.d/fuse-beads-ms.conf` |

旧 `fuse-beads-authority` 已停止并禁用；旧 Nginx 配置改名为 `scut-ai-wms.conf.disabled`。原配置和旧服务定义备份在 `/opt/fuse-beads-ms/legacy-backup/`，旧代码、旧数据和仓储系统文件未删除。原来的 Node.js 22 安装未替换。公网根路径现已显示新版拼豆网页。

服务使用 `MemoryMax=512M` 与 384 MiB V8 堆上限；这只是资源边界，不是容量承诺。当前单进程 SQLite 方案尚未做公网大规模负载验收。健康接口只表示 HTTP 进程存活；数据库备份完整性和真实联机需要另外检查。

## 客户端连接

浏览器直接打开上述 HTTPS 网页，邀请链接可在外网使用，不需要本地开发服务。

已有桌面验证包仍默认连接本机。公网启动脚本使用独立 `online` profile，避免混用本机后端的身份和存档：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-desktop-online.ps1
```

或直接为任意已出包 exe 设置启动环境：

```powershell
$env:ATELIER_MULTIPLAYER_URL = 'https://101.132.62.222'
& '.\release\Fuse Beads MS-win32-x64\FuseBeadsMS.exe' --profile=online
```

原 `local` profile 的作品保留，公网 `online` profile 拥有独立单机作品和联机身份。来自本地后端的令牌不属于公网后端；更换服务器时请使用不同 `-Profile`。同一 profile 已经运行时，重复启动只会聚焦旧窗口，改变服务器地址前需先关闭该 profile。

## 后续更新

本地生成仅供 Node 运行的独立后端 bundle，不上传桌面依赖或个人数据库：

```powershell
npm test
npm run build:server
npm run build
```

将 `.server/main.mjs`、`.server/build-info.json`、`deploy/` 中四个后端/备份文件（`fuse-beads-ms.service`、`backup-server.py`、`fuse-beads-ms-backup.service`、`fuse-beads-ms-backup.timer`）和 `scripts/deploy-server.sh` 通过 SCP/SFTP 上传到 `/opt/fuse-beads-ms/upload/`。使用自己的 SSH 登录方式；密码不写入脚本、Git 或命令行参数。

在服务器运行：

```bash
bash /opt/fuse-beads-ms/upload/deploy-server.sh /opt/fuse-beads-ms/upload
```

脚本验证 Node 官方下载校验值，创建独立发布目录；更新前在线备份数据库，切换 `current` 并重启本服务。健康检查连续失败时恢复原代码链接；数据库不自动回退，未来涉及数据库迁移的版本需要单独设计回退步骤。脚本不自动停止其他占用端口的应用，也不自动覆盖已有环境文件或修改 Nginx。

前端更新：把本地 `dist/` 上传到 `/var/www/fuse-beads-ms/releases/` 下新目录，检查完整后切换 `current` 链接。HTML 不缓存，Vite 带 hash 的 JS/CSS 使用长期缓存。不要把本机 `data/`、浏览器存档或桌面 profile 上传到服务器。

## HTTPS 证书与续期

使用 Let's Encrypt 公共 IP 短期证书，Certbot 5.8.0 安装在专用 Python venv `/opt/fuse-beads-ms/certbot/`。证书文件在 `/etc/letsencrypt/live/fuse-beads-ms-ip/`。初始证书有效期到 2026-09-14，实际日期用下方命令查看。

`fuse-beads-ms-cert-renew.timer` 每六小时检查续期，随机延迟最多 15 分钟；成功后先检查 Nginx 配置再 reload。必须保持 80 端口及 `/.well-known/acme-challenge/` 可访问。首次签发使用 `certonly --webroot --preferred-profile shortlived --ip-address`，无需停止 Nginx。命令依据 [Let's Encrypt 的 Certbot IP 证书说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。

```bash
systemctl list-timers 'fuse-beads-ms*'
systemctl start fuse-beads-ms-cert-renew.service
journalctl -u fuse-beads-ms-cert-renew.service -n 30
openssl x509 -in /etc/letsencrypt/live/fuse-beads-ms-ip/fullchain.pem -noout -dates
```

## 备份与回退

`fuse-beads-ms-backup.timer` 每六小时执行 SQLite 在线备份 API，并运行完整性检查；保留 `/var/lib/fuse-beads-ms/backups/` 中最近 48 份。更新前也调用相同备份脚本。备份目前与服务在同一台服务器，尚无异地副本。

```bash
systemctl start fuse-beads-ms-backup.service
journalctl -u fuse-beads-ms-backup.service -n 20
systemctl status fuse-beads-ms
journalctl -u fuse-beads-ms -n 50
```

仅回退代码时，把 `/opt/fuse-beads-ms/current` 指向已验证的旧发布目录后重启 `fuse-beads-ms`。恢复数据库需要先停止该服务，完整保留当前数据库及 WAL/SHM，再从选定备份恢复权限正确的主文件；不要在运行中直接覆盖 SQLite。

## 验证

```powershell
$env:ATELIER_DEPLOYED_URL = 'https://101.132.62.222'
npm run selfcheck:deployed
```

这项检查会在指定公网服务器上创建「公网部署验证」房间和两个测试身份，并保留测试草稿。使用隔离 Chrome context，验证真实 HTTPS 证书、WSS 创建/加入、鼠标放豆、远端撤销/重做、刷新后的身份和作品恢复。测试不会忽略证书错误。

追加 `-- --wait-for-restart` 时，在终端出现 `READY_FOR_SERVER_RESTART` 后手动重启远端本服务，再按回车继续恢复检查。报告位于忽略目录 `artifacts/deployed/`，不包含身份令牌。

本次验收：45 项本地测试、生产构建、公网双浏览器放豆与撤销/重做、实际 systemd 重启后的身份和作品恢复均通过；打包后的 Electron 使用正常证书验证成功连接公网 WSS。SQLite 在线备份完整性检查通过，Certbot 模拟续期及 Nginx reload hook 通过，实际续期服务返回成功。尚未验证断网长期恢复、异地备份或公网大规模容量。
