import { packager } from '@electron/packager';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = JSON.parse(await readFile('package.json', 'utf8'));
const outputs = await packager({ dir: resolve('.desktop'), out: resolve('release'), name: 'Fuse Beads MS',
    platform: 'win32', arch: 'x64', electronVersion: source.devDependencies.electron,
    asar: { unpack: '**/*.{node,dll,so,dylib,lib}' }, prune: false, overwrite: true,
    executableName: 'FuseBeadsMS', appVersion: source.version,
    win32metadata: { ProductName: 'Fuse Beads MS', FileDescription: '豆间 · 手作工作室' } });
for (const output of outputs)
{
    await cp('node_modules/steamworks.js/dist/win64/steam_api64.dll', `${output}/steam_api64.dll`);
    await writeFile(`${output}/README.txt`, '豆间 · Windows 验证版\r\n\r\n双击 FuseBeadsMS.exe 启动，F11 切换全屏。\r\n请保留整个目录，不能单独移动 exe。\r\n本版单机离线可玩，联机默认连接本机 2567 后端。\r\nSteam 功能默认关闭；尚未签名或作为正式 Steam 版本发布。\r\n存档：%APPDATA%\\FuseBeadsMS\\profiles\\local\\workshop.json\r\n');
    console.log(`Windows desktop ready: ${output}/FuseBeadsMS.exe`);
}
