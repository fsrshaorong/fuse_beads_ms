import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ProfileStore } from './ProfileStore';
import { assetPath } from './AssetPath';
import { initializeSteam } from './SteamBridge';
import type { DesktopInfo } from '../src/Platform/DesktopBridge';

function argument(name: string): string | undefined
{
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

app.setName('Fuse Beads MS');
const directory = fileURLToPath(new URL('.', import.meta.url));
const assets = join(directory, 'web');
const appIdInput = argument('steam-app-id');
const appId = appIdInput === undefined ? null : Number(appIdInput);
if (appId !== null && (!Number.isSafeInteger(appId) || appId <= 0)) { throw new Error('Invalid Steam App ID'); }
const steam = initializeSteam(appId, process.argv.includes('--steam-overlay'));
const profile = argument('profile') ?? steam.profile ?? 'local';
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) { throw new Error('Invalid profile'); }
const dataRoot = argument('atelier-data-dir') ?? join(app.getPath('appData'), 'FuseBeadsMS');
if (!isAbsolute(dataRoot)) { throw new Error('Desktop data directory must be absolute'); }
const chromiumDirectory = join(dataRoot, 'chromium', profile);
mkdirSync(chromiumDirectory, { recursive: true });
app.setPath('userData', chromiumDirectory);
const endpoint = new URL(process.env.ATELIER_MULTIPLAYER_URL ?? 'http://127.0.0.1:2567');
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
{
    throw new Error('Invalid multiplayer endpoint');
}
const socketOrigin = endpoint.origin.replace(/^http/, 'ws');
const info: Omit<DesktopInfo, 'renderer'> = { version: app.getVersion(), multiplayerUrl: endpoint.origin, steam: steam.status };
const records = new Map<number, { window: BrowserWindow; store: ProfileStore; closing: boolean; allowClose: boolean }>();
const registered = new WeakSet<Session>();
protocol.registerSchemesAsPrivileged([{ scheme: 'atelier', privileges: { standard: true, secure: true,
    supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function trusted(event: IpcMainInvokeEvent | IpcMainEvent)
{
    const record = records.get(event.sender.id);
    if (record === undefined || event.senderFrame !== event.sender.mainFrame
        || !event.senderFrame.url.startsWith('atelier://game/')) { throw new Error('Untrusted desktop caller'); }
    return record;
}

function configureSession(partition: Session): void
{
    if (registered.has(partition)) { return; }
    registered.add(partition);
    partition.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    partition.protocol.handle('atelier', async (request) =>
    {
        try
        {
            if (!['GET', 'HEAD'].includes(request.method)) { return new Response(null, { status: 405 }); }
            const response = await net.fetch(pathToFileURL(assetPath(assets, request.url)).href);
            const headers = new Headers(response.headers);
            headers.set('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${endpoint.origin} ${socketOrigin}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`);
            return new Response(response.body, { status: response.status, headers });
        }
        catch { return new Response('Resource unavailable', { status: 404 }); }
    });
}

async function createWindow(profileName: string, roomId?: string): Promise<BrowserWindow>
{
    const partition = session.fromPartition(`persist:${profileName}`);
    configureSession(partition);
    const window = new BrowserWindow({ width: 1440, height: 900, minWidth: 800, minHeight: 600,
        show: false, backgroundColor: '#f5e2cf', title: '豆间 · 手作工作室',
        webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true,
            nodeIntegration: false, sandbox: true, session: partition,
            backgroundThrottling: !process.argv.includes('--hidden') } });
    const record = { window, store: new ProfileStore(join(dataRoot, 'profiles', profileName)), closing: false, allowClose: false };
    records.set(window.webContents.id, record);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) =>
    {
        if (!url.startsWith('atelier://game/')) { event.preventDefault(); }
    });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('close', (event) =>
    {
        if (record.allowClose || window.webContents.isDestroyed()) { return; }
        event.preventDefault();
        if (!record.closing)
        {
            record.closing = true;
            window.webContents.send('desktop:before-close');
            setTimeout(() =>
            {
                if (!window.isDestroyed() && record.closing && !record.allowClose) { void closeFailed(record); }
            }, 8000).unref();
        }
    });
    const id = window.webContents.id;
    window.on('closed', () => records.delete(id));
    await window.loadURL(`atelier://game/${roomId === undefined ? '' : `?room=${encodeURIComponent(roomId)}`}`);
    if (!process.argv.includes('--hidden')) { window.show(); }
    return window;
}

async function closeFailed(record: { window: BrowserWindow; closing: boolean; allowClose: boolean }): Promise<void>
{
    record.closing = false;
    const answer = await dialog.showMessageBox(record.window, { type: 'warning', title: '作品尚未保存',
        message: '保存还没有完成。保持窗口打开后可以重试，强制退出可能丢失最近的修改。',
        buttons: ['保持打开', '仍然退出'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) { record.allowClose = true; record.window.close(); }
}

ipcMain.handle('desktop:info', (event) => { trusted(event); return info; });
ipcMain.handle('desktop:read-save', (event) => trusted(event).store.readSave());
ipcMain.handle('desktop:write-save', (event, value: unknown) => trusted(event).store.writeSave(value));
ipcMain.handle('desktop:read-session', (event) => trusted(event).store.readSession());
ipcMain.handle('desktop:write-session', (event, value: unknown) => trusted(event).store.writeSession(value));
ipcMain.handle('desktop:open-guest', async (event, roomId: unknown) =>
{
    trusted(event);
    if (typeof roomId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(roomId)) { throw new Error('Invalid room'); }
    if (records.size >= 4) { throw new Error('最多打开四个试玩窗口。'); }
    await createWindow(`guest-${randomUUID()}`, roomId);
});
ipcMain.on('desktop:close-ready', (event) =>
{
    const record = trusted(event);
    void record.store.flush().then(() => { record.allowClose = true; record.window.close(); }).catch(() => closeFailed(record));
});
ipcMain.on('desktop:close-failed', (event) => { void closeFailed(trusted(event)); });

if (!app.requestSingleInstanceLock()) { app.quit(); }
else
{
    app.on('second-instance', () => { const window = [...records.values()][0]?.window; window?.restore(); window?.show(); window?.focus(); });
    app.on('window-all-closed', () => app.quit());
    // Native ESM evaluation must finish before Electron can emit ready.
    void app.whenReady().then(async () =>
    {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { label: '游戏', submenu: [
                { label: '存档文件夹', click: async () => { const { shell } = await import('electron'); await shell.openPath(join(dataRoot, 'profiles')); } },
                { type: 'separator' }, { role: 'quit', label: '退出' }
            ] },
            { label: '视图', submenu: [{ role: 'togglefullscreen', label: '全屏 / 窗口', accelerator: 'F11' },
                { role: 'reload', label: '重新载入' }, { role: 'toggleDevTools', label: '开发调试' }] },
            { label: '验证版本', submenu: [{ label: `Steam：${steam.status.state === 'ready' ? `测试连接 ${appId}` : steam.status.state === 'disabled' ? '未启用' : '不可用'}`, enabled: false }] }
        ]));
        await createWindow(profile, argument('join-room'));
    }).catch((error: unknown) =>
    {
        console.error('Desktop startup failed:', error);
        if (!process.argv.includes('--hidden')) { dialog.showErrorBox('启动失败', '本地游戏资源未能加载，请保留完整程序目录后重试。'); }
        app.exit(1);
    });
}
