import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { startWorkshopServer } from '../server/server';

const output = resolve('artifacts/desktop');
const temporary = await mkdtemp(join(tmpdir(), 'beads-desktop-e2e-'));
await mkdir(output, { recursive: true });
const executablePath = resolve(process.env.ATELIER_DESKTOP_EXE ?? 'release/Fuse Beads MS-win32-x64/FuseBeadsMS.exe');
const serverErrors: string[] = [];
const backend = await startWorkshopServer({ port: 0, databasePath: join(temporary, 'room.sqlite'),
    allowedOrigins: ['atelier://game'], onError: (error) => serverErrors.push(String(error)) });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
env.ATELIER_MULTIPLAYER_URL = backend.url;
const apps: ElectronApplication[] = [];
const pageErrors: string[] = [];
const requests: string[] = [];
const mode = (page: Page, expected: string) => page.waitForFunction((value) => window.beadsAtelier.read().mode === value, expected);
const ready = (page: Page) => page.waitForFunction(() => window.beadsAtelier?.metrics().ready, undefined, { timeout: 60000 });
async function launch(profile: string)
{
    const started = performance.now();
    const app = await electron.launch({ executablePath, args: [`--atelier-data-dir=${temporary}`, `--profile=${profile}`, '--hidden'], env, timeout: 60000 });
    apps.push(app);
    const page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    await ready(page);
    return { app, page, startupMs: Math.round(performance.now() - started) };
}
async function close(app: ElectronApplication)
{
    await app.close();
    apps.splice(apps.indexOf(app), 1);
}

try
{
    let a = await launch('player-a');
    const startupMs = a.startupMs;
    assert.equal(await a.page.evaluate(() => typeof window.atelierDesktop), 'object');
    assert.equal(await a.page.evaluate(() => typeof (globalThis as unknown as { require?: unknown }).require), 'undefined');
    assert.deepEqual((await a.page.evaluate(() => window.atelierDesktop!.info())).renderer, { sandboxed: true, contextIsolated: true });
    assert.equal((await a.page.evaluate(() => window.atelierDesktop!.info())).steam.state, 'disabled');
    await a.page.waitForTimeout(900);
    await a.page.screenshot({ path: join(output, '01-packaged-workshop.png') });
    const nativeVersions = await a.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }));
    assert.equal(await a.page.evaluate(async () => (await fetch('atelier://game/..%5c..%5cpackage.json')).status), 404);
    await a.page.locator('#primary-button').click();
    await mode(a.page, 'tabletop');
    await a.page.locator('#primary-button').click();
    await mode(a.page, 'beadwork');
    const pattern = await a.page.evaluate(() => window.beadsAtelier.read().pattern);
    const occupied = pattern.targetNumbers.flatMap((color, index) => color > 0 ? [index] : []);
    const index = occupied[Math.floor(occupied.length * 0.45)];
    await a.page.locator(`[data-color="${pattern.targetNumbers[index]}"]`).click();
    const point = await a.page.evaluate(({ x, y }) => window.beadsAtelier.projectCell(x, y), { x: index % pattern.width, y: Math.floor(index / pattern.width) });
    await a.page.mouse.click(point.x, point.y);
    assert.equal(await a.page.evaluate(() => window.beadsAtelier.read().board.correctCellCount), 1);
    // Close immediately, before the regular debounced write. The close handshake must flush it.
    await close(a.app);
    const fileSave = await readFile(join(temporary, 'profiles/player-a/workshop.json'), 'utf8');
    assert.ok(fileSave.includes(pattern.patternId));
    a = await launch('player-a');
    assert.equal(await a.page.evaluate(() => window.beadsAtelier.read().board.correctCellCount), 1);
    assert.equal(await a.page.evaluate(() => localStorage.getItem('fuse-beads.web-playground.v1')), null);
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    assert.equal(await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), true);
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
    console.log('Packaged offline game, isolated renderer, file save and restart passed.');
    await a.page.locator('#room-button').click();
    await a.page.locator('#room-nickname').fill('桌面小莓');
    await a.page.locator('#create-room').click();
    await a.page.waitForFunction(() => window.beadsAtelier.metrics().online);
    const roomId = await a.page.evaluate(() => window.beadsAtelier.metrics().roomId);
    assert.ok(roomId);
    await a.page.locator('#room-button').click();
    const guestPromise = a.app.waitForEvent('window');
    await a.page.locator('#guest-room').click();
    const b = await guestPromise;
    b.on('pageerror', (error) => pageErrors.push(error.message));
    await ready(b);
    await b.locator('#room-nickname').fill('桌面小豆');
    await b.locator('#join-room').click();
    await b.waitForFunction(() => window.beadsAtelier.metrics().online);
    await a.page.locator('[data-room-close]').click();
    await a.page.waitForFunction(() => window.beadsAtelier.metrics().players.length === 2);
    assert.notEqual(await a.page.evaluate(() => window.beadsAtelier.metrics().playerId), await b.evaluate(() => window.beadsAtelier.metrics().playerId));
    await a.page.locator('#primary-button').click();
    await mode(a.page, 'tabletop');
    await a.page.locator('#primary-button').click();
    await mode(a.page, 'beadwork');
    await a.page.locator(`[data-color="${pattern.targetNumbers[index]}"]`).click();
    const sharedPoint = await a.page.evaluate(({ x, y }) => window.beadsAtelier.projectCell(x, y), { x: index % pattern.width, y: Math.floor(index / pattern.width) });
    await a.page.mouse.click(sharedPoint.x, sharedPoint.y);
    await b.waitForFunction(() => window.beadsAtelier.read().board.correctCellCount === 1);
    const originalPlayer = await a.page.evaluate(() => window.beadsAtelier.metrics().playerId);
    await a.page.screenshot({ path: join(output, '02-desktop-shared-board.png') });
    await b.screenshot({ path: join(output, '03-desktop-partner.png') });
    await close(a.app);
    a = await launch('player-a');
    await a.page.waitForFunction(() => window.beadsAtelier.metrics().connected);
    assert.equal(await a.page.evaluate(() => window.beadsAtelier.metrics().playerId), originalPlayer);
    assert.equal(await a.page.evaluate(() => window.beadsAtelier.read().board.correctCellCount), 1);
    await a.page.locator('#room-button').click();
    await a.page.locator('#leave-room').click();
    await a.page.waitForFunction(() => !window.beadsAtelier.metrics().online);
    assert.equal(await a.page.evaluate(() => window.beadsAtelier.read().board.correctCellCount), 1, 'local work survives shared-room use');
    const metrics = await a.page.evaluate(() => window.beadsAtelier.metrics());
    assert.equal(metrics.webglError, 0);
    assert.ok(requests.filter((url) => !url.startsWith('atelier://game/')).length === 0, 'game assets never load from a dev server or website');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(serverErrors, []);
    const memory = await a.app.evaluate(async ({ app }) => app.getAppMetrics().map((entry) => ({ type: entry.type, workingSetKiB: entry.memory.workingSetSize })));
    await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, packaged: true, startupMs,
        measurementScope: 'Hidden-window functional test; throttled frame timings are not a performance benchmark.',
        nativeVersions, memory, metrics, checks: ['local packaged resources', 'sandboxed renderer', 'asset path restriction',
            'real pointer painting', 'close flush and restart', 'file saves', 'fullscreen', 'native guest window',
            'two desktop players', 'shared board', 'persistent desktop identity', 'local/online save isolation'],
        steam: 'disabled in gameplay checks; SDK/overlay need the separate Steam smoke run' }, null, 4));
    console.log('Packaged desktop multiplayer and persisted identity passed.');
}
finally
{
    for (const app of [...apps]) { await app.close().catch(() => {}); }
    await backend.close();
    // Only the unique temporary test directory created above is removed.
    await rm(temporary, { recursive: true, force: true });
}
