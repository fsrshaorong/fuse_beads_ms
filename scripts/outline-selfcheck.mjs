import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// Tests the real renderer on an isolated page; neither main nor player storage runs.
const output = new URL('../artifacts/outline/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['three'] } });
await server.listen();
const browser = await chromium.launch({
    executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true
});
const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const report = { passed: false, browser: browser.version(), timestamp: new Date().toISOString(), errors: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', (message) =>
{
    if (message.type() === 'error')
    {
        report.errors.push(message.text());
    }
});
try
{
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.route('**/__outline-selfcheck.html', (route) => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><head><link rel="icon" href="data:,"><style>body{margin:0}canvas{display:block}</style></head><body></body></html>' }));
    await page.goto(`${origin}/__outline-selfcheck.html`);
    const module = await (await fetch(`${origin}/src/Rendering/PainterlyMaterials.ts`)).text();
    const threeUrl = module.match(/from\s+["']([^"']*three[^"']*\.js[^"']*)["']/)?.[1];
    assert.ok(threeUrl, 'production and test use the same Three instance');
    const result = await page.evaluate(runChecks, threeUrl);
    for (const [name, data] of Object.entries(result.images))
    {
        await writeFile(new URL(`${name}.png`, output), Buffer.from(data.split(',')[1], 'base64'));
    }
    delete result.images;
    Object.assign(report, result);
    assert.deepEqual(result.checks.filter((check) => !check.passed), [], 'all outline behavior checks pass');
    assert.deepEqual(report.errors, [], 'browser and WebGL shader console stays clean');
    report.passed = true;
}
catch (error)
{
    report.failure = String(error?.stack ?? error);
    process.exitCode = 1;
}
finally
{
    await context.close();
    await browser.close();
    await server.close();
    await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function runChecks(threeUrl)
{
    const T = await import(threeUrl);
    const { PainterlyMaterials } = await import('/src/Rendering/PainterlyMaterials.ts');
    const { configurePainterlyRenderer, createPainterlyLighting } = await import('/src/Rendering/PainterlyLighting.ts');
    const { PainterlyOutline, DEFAULT_PAINTERLY_OUTLINE_PROFILE } = await import('/src/Rendering/PainterlyOutline.ts');
    const owner = new PainterlyMaterials();
    await owner.ready;
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    configurePainterlyRenderer(renderer, 1);
    renderer.setSize(640, 480);
    document.body.append(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#f1c7b6');
    const camera = new T.OrthographicCamera(-3.2, 3.2, 2.4, -2.4, 0.1, 30);
    camera.position.set(0, 0, 8);
    const lighting = createPainterlyLighting();
    scene.add(lighting);
    const floorGeometry = new T.PlaneGeometry(6.4, 4.8);
    const floor = new T.Mesh(floorGeometry, owner.create('#d89aac', 'floor'));
    floor.position.z = -1;
    floor.receiveShadow = true;
    floor.userData.painterlyOutline = { enabled: false };
    scene.add(floor);
    const boxGeometry = new T.BoxGeometry(0.8, 0.8, 0.8);
    const material = owner.create('#c2675b', 'wood');
    material.userData.painterlyOutline = { width: 1.5 };
    const subject = new T.Mesh(boxGeometry, material);
    subject.castShadow = true;
    subject.receiveShadow = true;
    scene.add(subject);
    const sourceState = [material.side, material.opacity, material.depthWrite, material.depthTest,
        material.onBeforeCompile, material.customProgramCacheKey, subject.geometry, subject.material, subject.customDepthMaterial];
    const rendererState = [renderer.autoClear, renderer.shadowMap.enabled, renderer.shadowMap.autoUpdate,
        renderer.shadowMap.type, renderer.getRenderTarget(), renderer.getScissorTest()];
    let sourceDisposals = 0;
    material.addEventListener('dispose', () => sourceDisposals += 1);
    boxGeometry.addEventListener('dispose', () => sourceDisposals += 1);
    const gl = renderer.getContext();
    const checks = [];
    const images = {};
    const check = (name, passed, details = {}) => checks.push({ name, passed, ...details });
    function read(name)
    {
        const pixels = new Uint8Array(640 * 480 * 4);
        gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (name)
        {
            images[name] = renderer.domElement.toDataURL('image/png');
        }
        return pixels;
    }
    function difference(left, right, region = [0, 0, 640, 480])
    {
        let changedPixels = 0;
        let maxChannelDifference = 0;
        let total = 0;
        for (let y = region[1]; y < region[3]; y += 1)
        {
            for (let x = region[0]; x < region[2]; x += 1)
            {
                let changed = false;
                for (let channel = 0; channel < 4; channel += 1)
                {
                    const index = (y * 640 + x) * 4 + channel;
                    const delta = Math.abs(left[index] - right[index]);
                    changed ||= delta > 0;
                    maxChannelDifference = Math.max(maxChannelDifference, delta);
                    total += delta;
                }
                changedPixels += Number(changed);
            }
        }
        return { changedPixels, maxChannelDifference, meanChannelDifference: total / (640 * 480 * 4) };
    }
    renderer.render(scene, camera);
    const plain = read('01-original-material');
    const outline = new PainterlyOutline(renderer);
    function render(enabled = true, name)
    {
        outline.setProfile({ enabled });
        outline.render(scene, camera);
        return read(name);
    }
    const disabled = render(false);
    check('disabled preserves original rendering', difference(plain, disabled).changedPixels === 0);
    const enabled = render(true, '02-visible-outline');
    const visible = difference(disabled, enabled);
    check('enabled creates a visible contour', visible.changedPixels > 100 && visible.maxChannelDifference > 8, visible);
    owner.update(0.6);
    check('static outline has no time jitter', difference(enabled, render()).changedPixels === 0);
    check('surface interior keeps original shading', difference(disabled, enabled, [295, 215, 345, 265]).changedPixels === 0);
    const shadowRegion = [365, 100, 415, 160];
    subject.castShadow = false;
    const withoutShadow = render(false);
    subject.castShadow = true;
    const shadowEvidence = difference(disabled, withoutShadow, shadowRegion);
    check('shadow sample contains real projected shadow', shadowEvidence.changedPixels > 20, shadowEvidence);
    check('outline leaves projected shadow unchanged', difference(disabled, enabled, shadowRegion).changedPixels === 0);

    const occluder = new T.Mesh(new T.BoxGeometry(1.5, 1.5, 0.2), new T.MeshBasicMaterial({ color: '#6fa79f' }));
    occluder.position.z = 1;
    scene.add(occluder);
    const occluded = difference(render(false), render(true, '03-occluded-outline'));
    check('foreground fully occludes the rear outline', occluded.changedPixels === 0, occluded);
    scene.remove(occluder);
    occluder.geometry.dispose();
    occluder.material.dispose();
    subject.userData.painterlyOutline = { enabled: false };
    check('object exclusion overrides material metadata', difference(render(false), render()).changedPixels === 0);
    delete subject.userData.painterlyOutline;
    subject.visible = false;
    const empty = render();
    scene.remove(subject);

    const points = [[0.18, 0.04], [0.22, 0], [0.34, 0], [0.39, 0.05], [0.39, 0.52],
        [0.35, 0.57], [0.22, 0.57], [0.18, 0.53], [0.18, 0.04]].map(([x, y]) => new T.Vector2(x, y));
    const beadGeometry = new T.LatheGeometry(points, 28);
    const beadMaterial = owner.create('#e8998d', 'bead');
    beadMaterial.userData.painterlyOutline = { width: 0.75 };
    const bead = new T.Mesh(beadGeometry, beadMaterial);
    bead.rotation.x = Math.PI / 2;
    scene.add(bead);
    for (const scale of [1, 0.2])
    {
        bead.scale.setScalar(scale);
        const before = render(false);
        const after = render(true, scale === 1 ? '04-hollow-bead' : '05-small-hollow-bead');
        check(`bead silhouette is visible at scale ${scale}`, difference(before, after).changedPixels > 5);
        check(`bead hole stays open at scale ${scale}`, difference(before, after, [319, 239, 321, 241]).changedPixels === 0);
    }
    scene.remove(bead);
    check('removing dynamic geometry removes its outline immediately', difference(empty, render()).changedPixels === 0);

    const instanced = new T.InstancedMesh(boxGeometry, material, 2);
    const marker = new T.Object3D();
    marker.position.set(-1.1, 0, 0);
    marker.updateMatrix();
    instanced.setMatrixAt(0, marker.matrix);
    instanced.setMatrixAt(1, new T.Matrix4().makeTranslation(1.1, 0, 0));
    instanced.count = 1;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    scene.add(instanced);
    const initialInstance = render();
    marker.position.set(1.1, 0, 0);
    marker.rotation.set(0.18, 0.63, -0.12);
    marker.scale.set(1.25, 0.8, 0.65);
    marker.updateMatrix();
    instanced.setMatrixAt(0, marker.matrix);
    instanced.instanceMatrix.needsUpdate = true;
    const movedInstance = render(true, '06-moved-instance');
    check('instance matrix change is visible on the next render', difference(initialInstance, movedInstance).changedPixels > 100);
    scene.remove(instanced);
    subject.visible = true;
    subject.position.copy(marker.position);
    subject.rotation.copy(marker.rotation);
    subject.scale.copy(marker.scale);
    scene.add(subject);
    const transform = difference(movedInstance, render(true, '07-equivalent-mesh'));
    check('mesh and instanced TRS agree without stale outline geometry', transform.changedPixels / (640 * 480) <= 0.001 && transform.meanChannelDifference <= 0.02, transform);
    scene.remove(subject);
    instanced.setMatrixAt(0, new T.Matrix4().makeTranslation(-1.1, 0, 0));
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);
    const oneBaseline = render(false);
    const one = render();
    check('inactive instance slot has no contour', difference(oneBaseline, one, [380, 185, 480, 295]).changedPixels === 0);
    instanced.count = 2;
    instanced.setMatrixAt(1, new T.Matrix4().makeScale(0, 0, 0));
    instanced.instanceMatrix.needsUpdate = true;
    check('zero-scale empty bead slot draws no dot or contour', difference(one, render()).changedPixels === 0);
    instanced.setMatrixAt(1, new T.Matrix4().makeTranslation(1.1, 0, 0));
    instanced.instanceMatrix.needsUpdate = true;
    const twoBaseline = render(false);
    const two = render();
    const countChange = difference(one, two).changedPixels;
    const newContour = difference(twoBaseline, two, [380, 185, 480, 295]).changedPixels;
    check('growing instance count creates the new contour immediately', countChange > 100 && newContour > 50,
        { changedPixels: countChange, newContourPixels: newContour });
    instanced.count = 1;
    check('shrinking instance count removes its contour immediately', difference(one, render()).changedPixels === 0);
    scene.remove(instanced);
    instanced.dispose();
    check('deleting instances leaves no ghost contours', difference(empty, render()).changedPixels === 0);

    subject.position.set(0, 0, 0);
    subject.rotation.set(0, 0, 0);
    subject.scale.set(1, 1, 1);
    scene.add(subject);
    render();
    const currentSource = [material.side, material.opacity, material.depthWrite, material.depthTest,
        material.onBeforeCompile, material.customProgramCacheKey, subject.geometry, subject.material, subject.customDepthMaterial];
    check('source material, geometry and depth material are untouched', sourceState.every((value, index) => value === currentSource[index]));
    const currentRenderer = [renderer.autoClear, renderer.shadowMap.enabled, renderer.shadowMap.autoUpdate,
        renderer.shadowMap.type, renderer.getRenderTarget(), renderer.getScissorTest()];
    check('renderer state is restored after the outline pass', rendererState.every((value, index) => value === currentRenderer[index]));
    const programsBeforeDispose = renderer.info.programs.length;
    outline.dispose();
    outline.dispose();
    check('dispose releases owned GPU programs', renderer.info.programs.length < programsBeforeDispose,
        { programsBeforeDispose, programsAfterDispose: renderer.info.programs.length });
    check('dispose does not dispose caller-owned material or geometry', sourceDisposals === 0, { sourceDisposals });
    renderer.render(scene, camera);
    check('plain rendering after disposal matches the original', difference(plain, read('08-after-dispose')).changedPixels === 0);
    check('WebGL remains error-free', gl.getError() === 0);
    const result = { profile: DEFAULT_PAINTERLY_OUTLINE_PROFILE, resolution: '640x480', checks, images };
    floorGeometry.dispose();
    boxGeometry.dispose();
    beadGeometry.dispose();
    owner.dispose();
    lighting.traverse((object) => object.shadow?.dispose());
    renderer.dispose();
    return result;
}
