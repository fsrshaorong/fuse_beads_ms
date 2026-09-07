import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve('.desktop');
await mkdir(root, { recursive: true });
await build({ entryPoints: ['desktop/main.ts'], outfile: `${root}/main.mjs`, bundle: true, platform: 'node',
    format: 'esm', target: 'node22', external: ['electron', 'steamworks.js'] });
await build({ entryPoints: ['desktop/preload.ts'], outfile: `${root}/preload.cjs`, bundle: true, platform: 'node',
    format: 'cjs', target: 'node22', external: ['electron'] });
const web = resolve(root, 'web');
if (dirname(root) !== process.cwd() || dirname(web) !== root) { throw new Error('Unexpected desktop staging path'); }
await rm(web, { recursive: true, force: true });
await cp('dist', web, { recursive: true });
await cp('node_modules/steamworks.js', `${root}/node_modules/steamworks.js`, { recursive: true });
const source = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`${root}/package.json`, JSON.stringify({ name: source.name, version: source.version,
    productName: 'Fuse Beads MS', description: 'A little cooperative bead atelier', author: 'Fuse Beads MS',
    main: 'main.mjs', type: 'module', dependencies: { 'steamworks.js': source.dependencies['steamworks.js'] } }, null, 4));
console.log('Desktop entry and local game assets prepared in .desktop');
