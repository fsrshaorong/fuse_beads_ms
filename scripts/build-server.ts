import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.server');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['server/main.ts'], outfile: `${output}/main.mjs`, bundle: true,
    platform: 'node', format: 'esm', target: 'node24',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    external: ['bufferutil', 'utf-8-validate'] });
const source = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`${output}/build-info.json`, JSON.stringify({ name: source.name, version: source.version,
    runtime: 'Node.js 24+', protocolVersion: 1, builtAt: new Date().toISOString() }, null, 4));
console.log(`Standalone backend built: ${output}/main.mjs`);
