import { packager } from '@electron/packager';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const source = JSON.parse(await readFile('package.json', 'utf8'));
const installedElectron = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8'));
if (installedElectron.version !== source.devDependencies.electron) { throw new Error('Run npm ci to install the locked Electron version.'); }
// The locked Electron npm package ships the release hashes, so a verified cache hit needs no network.
const checksums: Record<string, string> = JSON.parse(await readFile('node_modules/electron/checksums.json', 'utf8'));
const archiveName = `electron-v${installedElectron.version}-win32-x64.zip`;
if (!/^[a-f0-9]{64}$/i.test(checksums[archiveName] ?? '')) { throw new Error('Electron release checksum is missing.'); }
const outputRoot = resolve(process.env.ATELIER_PACKAGE_OUT ?? 'release');
const outputChild = relative(resolve('release'), outputRoot);
if (outputChild.startsWith('..') || isAbsolute(outputChild)) { throw new Error('Package output must stay within release/'); }
const outputs = await packager({ dir: resolve('.desktop'), out: outputRoot, name: 'Fuse Beads MS',
    platform: 'win32', arch: 'x64', electronVersion: source.devDependencies.electron,
    download: { checksums },
    asar: { unpack: '**/*.{node,dll,so,dylib,lib}' }, prune: false, overwrite: true,
    executableName: 'FuseBeadsMS', appVersion: source.version,
    win32metadata: { ProductName: 'Fuse Beads MS', FileDescription: '豆间 · 手作工作室' } });
for (const output of outputs)
{
    await cp('node_modules/steamworks.js/dist/win64/steam_api64.dll', `${output}/steam_api64.dll`);
    await writeFile(`${output}/README.txt`, '豆间 · Windows 验证版\r\n\r\n双击 FuseBeadsMS.exe 启动，F11 切换全屏。\r\n请保留整个目录，不能单独移动 exe。\r\n本版单机离线可玩，联机默认连接本机 2567 后端。\r\nSteam 功能默认关闭；尚未签名或作为正式 Steam 版本发布。\r\n存档：%APPDATA%\\FuseBeadsMS\\profiles\\local\\workshop.json\r\n');
    console.log(`Windows desktop ready: ${output}/FuseBeadsMS.exe`);
}
