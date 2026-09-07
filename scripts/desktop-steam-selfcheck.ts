import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const output = resolve('artifacts/desktop');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'beads-steam-smoke-'));
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
const overlay = process.argv.includes('--overlay');
const hidden = process.argv.includes('--hidden');
const app = await electron.launch({ executablePath: resolve('release/Fuse Beads MS-win32-x64/FuseBeadsMS.exe'),
    args: [`--atelier-data-dir=${temporary}`, '--profile=steam-smoke', '--steam-app-id=480',
        ...(overlay ? ['--steam-overlay'] : []), ...(hidden ? ['--hidden'] : [])], env, timeout: 60000 });
try
{
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => window.beadsAtelier?.metrics().ready, undefined, { timeout: 60000 });
    if (!hidden) { await page.bringToFront(); }
    await page.waitForTimeout(3500);
    const info = await page.evaluate(() => window.atelierDesktop!.info());
    const metrics = await page.evaluate(() => window.beadsAtelier.metrics());
    const first = await page.locator('.world-canvas').screenshot({ path: join(output, 'steam-frame-a.png') });
    await page.waitForTimeout(700);
    const second = await page.locator('.world-canvas').screenshot({ path: join(output, 'steam-frame-b.png') });
    assert.equal(metrics.webglError, 0);
    assert.deepEqual(errors, []);
    const memory = await app.evaluate(async ({ app }) => app.getAppMetrics().map((entry) => ({ type: entry.type, workingSetKiB: entry.memory.workingSetSize })));
    const report = { steamSdkInitialized: info.steam.state === 'ready', hidden, info, metrics, memory,
        staticScene: first.equals(second), errors, overlayVisualVerified: false,
        scope: 'Spacewar App ID 480 SDK initialization and rendering only. Hidden runs are not performance benchmarks; no achievements, Cloud writes, lobby invites, or authentication backend changes.' };
    await writeFile(join(output, overlay ? 'steam-overlay-report.json' : 'steam-sdk-report.json'), JSON.stringify(report, null, 4));
    console.log(JSON.stringify({ steamSdkInitialized: report.steamSdkInitialized, overlayRequested: overlay,
        webglError: metrics.webglError, foregroundFrameP95Ms: hidden ? null : metrics.p95, staticScene: report.staticScene, overlayVisualVerified: false }, null, 4));
    assert.ok(report.staticScene, 'desktop scene remains static with the selected Steam configuration');
    assert.ok(report.steamSdkInitialized, 'Steam must be running and its test SDK must initialize');
}
finally
{
    await app.close();
    await rm(temporary, { recursive: true, force: true });
}
