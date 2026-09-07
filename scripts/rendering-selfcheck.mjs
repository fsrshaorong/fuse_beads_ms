import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// A fresh browser context and a synthetic page keep this check away from player
// saves, UI state, and production-only debug hooks. No application entry runs.
const project = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../artifacts/rendering/', import.meta.url);
const referenceUrl = 'https://soft-toy-room-doucechen-0720.eaudoucefish.chatgpt.site/';
const offline = process.argv.includes('--offline');
const referenceOnly = process.argv.includes('--reference-only');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.ATELIER_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
});
let server;
const report = {
    passed: false,
    mode: referenceOnly ? 'reference-capture-only' : 'full-rendering-check',
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    reference: {},
    checks: {},
    errors: []
};

try
{
    const reference = await loadReference();
    report.reference = reference.provenance;
    if (!offline)
    {
        report.reference.capture = await captureReference();
        await writeFile(new URL('reference-capture.json', output), `${JSON.stringify(report.reference.capture, null, 4)}\n`);
    }
    if (!referenceOnly)
    {
        await verifyLocal(reference.shaders);
    }
    report.passed = true;
}
catch (error)
{
    report.failure = String(error?.stack ?? error);
    process.exitCode = 1;
}
finally
{
    await server?.close();
    await browser.close();
    await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function loadReference()
{
    let html;
    let bundle;
    let bundleUrl;
    if (offline)
    {
        html = await readFile(new URL('reference.html', output), 'utf8');
        bundle = await readFile(new URL('reference-scene.js', output), 'utf8');
        bundleUrl = JSON.parse(await readFile(new URL('reference-provenance.json', output), 'utf8')).bundleUrl;
    }
    else
    {
        const response = await fetch(referenceUrl, { signal: AbortSignal.timeout(30000) });
        assert.equal(response.status, 200, 'reference HTML is reachable');
        html = await response.text();
        const bundlePath = html.match(/\/assets\/ToyRoomScene-[A-Za-z0-9_-]+\.js/)?.[0];
        assert.ok(bundlePath, 'reference HTML identifies the running scene bundle');
        bundleUrl = new URL(bundlePath, referenceUrl).href;
        const bundleResponse = await fetch(bundleUrl, { signal: AbortSignal.timeout(30000) });
        assert.equal(bundleResponse.status, 200, 'running reference bundle is reachable');
        bundle = await bundleResponse.text();
        await writeFile(new URL('reference.html', output), html);
        await writeFile(new URL('reference-scene.js', output), bundle);
    }
    const shaders = {};
    for (const name of ['Ud', 'Wd', 'Kd', 'qd', 'Jd'])
    {
        const source = bundle.match(new RegExp(`${name}=\x60([^\x60]*)\x60`))?.[1];
        assert.ok(source && !source.includes('${'), `reference ${name} is a literal GLSL source`);
        shaders[name] = source;
    }
    const provenance = {
        url: referenceUrl,
        bundleUrl,
        htmlSha256: createHash('sha256').update(html).digest('hex'),
        bundleSha256: createHash('sha256').update(bundle).digest('hex'),
        oracle: 'Unmodified Ud/Wd/Kd/qd/Jd GLSL extracted from the fetched bundle; original article preset, time 0, wobble disabled.',
        scope: 'Same-geometry shader comparison; the game room has different assets and layout from the reference room.'
    };
    await writeFile(new URL('reference-provenance.json', output), `${JSON.stringify(provenance, null, 4)}\n`);
    return { shaders, provenance };
}

async function captureReference()
{
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    const resourceErrors = [];
    const failedRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) =>
    {
        if (message.type() === 'error')
        {
            consoleErrors.push(message.text());
        }
    });
    page.on('response', (response) =>
    {
        if (response.status() >= 400)
        {
            resourceErrors.push({ url: response.url(), status: response.status() });
        }
    });
    page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
    try
    {
        await page.goto(referenceUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.locator('canvas.scene-canvas').waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: fileURLToPath(new URL('reference-original.png', output)), fullPage: true });
        await page.locator('canvas.scene-canvas').screenshot({ path: fileURLToPath(new URL('reference-original-scene.png', output)) });
        // This UI switch removes reference geometry wobble. The independent
        // oracle additionally freezes time while retaining its brush texture.
        await page.getByRole('button', { name: 'Simplex 形变', exact: true }).click();
        await page.waitForTimeout(200);
        await page.locator('canvas.scene-canvas').screenshot({ path: fileURLToPath(new URL('reference-no-vertex-wobble.png', output)) });
        const webglError = await page.locator('canvas.scene-canvas').evaluate((canvas) => canvas.getContext('webgl2')?.getError());
        assert.equal(webglError, 0, 'original website has a working WebGL2 canvas');
        assert.deepEqual(errors, [], 'original website runs without browser/shader errors');
        assert.deepEqual(consoleErrors.filter((message) => /WebGL|GL_INVALID|Shader Error/i.test(message)), [], 'original website shaders compile and render');
        return { canvasCount: await page.locator('canvas').count(), webglError, errors, consoleErrors, resourceErrors, failedRequests };
    }
    finally
    {
        await context.close();
    }
}

async function verifyLocal(shaders)
{
    report.sourceHashes = {};
    for (const name of ['PainterlyMaterials.ts', 'PainterlyShaders.ts', 'PainterlyLighting.ts', 'ReferenceProfile.ts'])
    {
        const source = await readFile(new URL(`../src/Rendering/${name}`, import.meta.url));
        report.sourceHashes[name] = createHash('sha256').update(source).digest('hex');
    }
    server = await createServer({
        root: project,
        configFile: false,
        logLevel: 'error',
        server: { host: '127.0.0.1', port: 0 },
        optimizeDeps: { include: ['three'] }
    });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) =>
    {
        if (message.type() === 'error')
        {
            report.errors.push(message.text());
        }
    });
    await page.route('**/__rendering-selfcheck.html', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><link rel="icon" href="data:,"><style>html,body{margin:0;background:#fff}canvas{display:block}</style></head><body></body></html>'
    }));
    try
    {
        await page.goto(`${origin}/__rendering-selfcheck.html`);
        const transformed = await (await fetch(`${origin}/src/Rendering/PainterlyMaterials.ts`)).text();
        const threeUrl = transformed.match(/from\s+["']([^"']*three[^"']*\.js[^"']*)["']/)?.[1];
        assert.ok(threeUrl, 'test and production material share one Three module instance');
        const result = await page.evaluate(runFixedScene, { threeUrl, shaders });
        for (const [name, encoded] of Object.entries(result.images))
        {
            await writeFile(new URL(`${name}.png`, output), Buffer.from(encoded.split(',')[1], 'base64'));
        }
        delete result.images;
        report.checks = result;
        assert.equal(result.time.changedPixels, 0, 'time 0 and 0.6 must have exactly identical RGBA pixels');
        for (const comparison of result.instances)
        {
            assert.equal(comparison.geometryChangedPixels, 0, `${comparison.role}: same-material Mesh and same-world-position InstancedMesh must match exactly`);
            // A constant interpolated instanceColor can round differently from a
            // fragment uniform. Permit one 8-bit level in at most 0.01% of pixels;
            // geometry, time stability and reference-oracle comparisons stay exact.
            assert.ok(comparison.maxChannelDifference <= 1 && comparison.changedPixels / (640 * 480) <= 0.0001,
                `${comparison.role}: instance color must agree within tightly bounded interpolation precision`);
            assert.equal(comparison.timeChangedPixels, 0, `${comparison.role}: advancing time must not change any pixel`);
        }
        assert.ok(result.shadows.meshChangedPixels > 50, 'Mesh genuinely casts a visible shadow');
        assert.ok(result.shadows.instancedChangedPixels > 50, 'InstancedMesh genuinely casts a visible shadow');
        assert.ok(result.transformedInstance.changedPixels / (640 * 480) <= 0.001 && result.transformedInstance.meanChannelDifference <= 0.01,
            'rotation and nonuniform scale preserve instance world textures and normal shading within rasterization precision');
        assert.equal(result.oracle.maxChannelDifference, 0, 'local material must equal original GLSL for the same geometry and article preset');
        assert.equal(result.webglError, 0, 'WebGL reports no errors');
        assert.ok(result.renderedColors > 50, 'nonempty image contains material and texture variation');
        assert.deepEqual(report.errors, [], 'browser and shader console stays clean');
    }
    finally
    {
        await context.close();
    }
}

async function runFixedScene({ threeUrl, shaders })
{
    const T = await import(threeUrl);
    const { PainterlyMaterials } = await import('/src/Rendering/PainterlyMaterials.ts');
    const { configurePainterlyRenderer, createPainterlyLighting } = await import('/src/Rendering/PainterlyLighting.ts');
    const owner = new PainterlyMaterials();
    await owner.ready;
    const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false });
    configurePainterlyRenderer(renderer, 1);
    renderer.setSize(640, 480);
    document.body.append(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#f1c7b6');
    const camera = new T.OrthographicCamera(-3.6, 3.6, 2.7, -2.7, 0.1, 40);
    camera.position.set(5, 5, 7);
    camera.lookAt(0, 0.5, 0);
    scene.add(createPainterlyLighting());
    const floorGeometry = new T.BoxGeometry(6, 0.1, 5);
    const shapeGeometry = new T.BoxGeometry(1.25, 1.5, 1.1);
    const floor = new T.Mesh(floorGeometry, owner.create('#d89aac', 'floor'));
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    scene.add(floor);
    const position = new T.Vector3(0.5, 0.75, -0.25);
    const matrix = new T.Matrix4().makeTranslation(position.x, position.y, position.z);
    const subject = new T.Mesh(shapeGeometry, owner.create('#c2675b', 'wood'));
    subject.position.copy(position);
    subject.castShadow = true;
    subject.receiveShadow = true;
    scene.add(subject);
    const images = {};
    const gl = renderer.getContext();
    function render(name)
    {
        renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
        const pixels = new Uint8Array(640 * 480 * 4);
        gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (name)
        {
            images[name] = renderer.domElement.toDataURL('image/png');
        }
        return pixels;
    }
    function compare(left, right)
    {
        let changedPixels = 0;
        let maxChannelDifference = 0;
        let totalDifference = 0;
        for (let index = 0; index < left.length; index += 4)
        {
            let changed = false;
            for (let channel = 0; channel < 4; channel += 1)
            {
                const difference = Math.abs(left[index + channel] - right[index + channel]);
                changed ||= difference > 0;
                maxChannelDifference = Math.max(maxChannelDifference, difference);
                totalDifference += difference;
            }
            changedPixels += Number(changed);
        }
        return { changedPixels, maxChannelDifference, meanChannelDifference: totalDifference / left.length };
    }
    owner.update(0);
    const atZero = render('local-time-0');
    owner.update(0.6);
    const atLater = render('local-time-0.6');
    const time = compare(atZero, atLater);
    owner.update(0);
    const colors = new Set();
    for (let index = 0; index < atZero.length; index += 4)
    {
        colors.add(`${atZero[index]},${atZero[index + 1]},${atZero[index + 2]}`);
    }
    const instances = [];
    let meshShadow;
    let instanceShadow;
    for (const role of ['wood', 'bead', 'board', 'fabric', 'ceramic', 'metal', 'foliage', 'wall', 'floor'])
    {
        subject.material = owner.create('#c2675b', role);
        subject.visible = true;
        subject.castShadow = true;
        owner.update(0);
        const meshImage = render(role === 'wood' ? 'mesh' : undefined);
        owner.update(0.6);
        const meshAtLaterTime = render();
        owner.update(0);
        subject.castShadow = false;
        const meshWithoutShadow = render();
        subject.visible = false;
        const instanced = new T.InstancedMesh(shapeGeometry, owner.create('#c2675b', role), 1);
        instanced.setMatrixAt(0, matrix);
        instanced.instanceMatrix.needsUpdate = true;
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        scene.add(instanced);
        const geometryChangedPixels = compare(meshImage, render()).changedPixels;
        instanced.material = owner.create('#ffffff', role);
        instanced.setColorAt(0, new T.Color('#c2675b'));
        instanced.instanceColor.needsUpdate = true;
        const instanceImage = render(role === 'wood' ? 'instanced' : undefined);
        instances.push({ role, geometryChangedPixels, timeChangedPixels: compare(meshImage, meshAtLaterTime).changedPixels, ...compare(meshImage, instanceImage) });
        if (role === 'wood')
        {
            meshShadow = compare(meshImage, meshWithoutShadow);
            instanced.castShadow = false;
            instanceShadow = compare(instanceImage, render('without-shadow'));
        }
        scene.remove(instanced);
        instanced.dispose();
    }
    subject.visible = true;
    subject.castShadow = true;
    subject.material = owner.create('#c2675b', 'wood');
    subject.rotation.set(0.18, 0.63, -0.12);
    subject.scale.set(1.25, 0.8, 0.65);
    subject.updateMatrix();
    const rotatedMesh = render('transformed-mesh');
    const rotatedInstance = new T.InstancedMesh(shapeGeometry, subject.material, 1);
    rotatedInstance.setMatrixAt(0, subject.matrix);
    rotatedInstance.instanceMatrix.needsUpdate = true;
    rotatedInstance.castShadow = true;
    rotatedInstance.receiveShadow = true;
    scene.add(rotatedInstance);
    subject.visible = false;
    const transformedInstance = compare(rotatedMesh, render('transformed-instance'));
    scene.remove(rotatedInstance);
    rotatedInstance.dispose();
    subject.visible = true;
    subject.rotation.set(0, 0, 0);
    subject.scale.set(1, 1, 1);
    const local = render('local-oracle-scene');
    const loader = new T.TextureLoader();
    const referenceTextures = await Promise.all([
        ['noise-comparison.png', false], ['brush-strokes-02.png', false],
        ['brush-strokes-03.png', false], ['shadow-light-pair.png', true], ['shadow-texture.png', true]
    ].map(async ([name, srgb]) =>
    {
        const texture = await loader.loadAsync(`/textures/painterly/${name}`);
        texture.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
        texture.wrapS = T.RepeatWrapping;
        texture.wrapT = T.RepeatWrapping;
        texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        texture.needsUpdate = true;
        return texture;
    }));
    const uniforms = {
        uPainterTime: { value: 0 },
        uPainterNoiseTexture: { value: referenceTextures[0] },
        uPainterLightTexture: { value: referenceTextures[3] },
        uPainterShadowTexture: { value: referenceTextures[4] },
        uPainterWobbleEnabled: { value: 0 },
        uPainterBrushEnabled: { value: 1 },
        uPainterRealtimeShadowsEnabled: { value: 1 },
        uPainterDualTextureEnabled: { value: 1 },
        uPainterDesaturationEnabled: { value: 1 },
        uPainterMinimumBlackEnabled: { value: 1 },
        uPainterFadeToToneEnabled: { value: 1 },
        uPainterWobbleAmplitude: { value: 0.018 },
        uPainterNoiseScale: { value: 0.19 },
        uPainterShadowStrength: { value: 0.92 },
        uPainterShadowThreshold: { value: 0.7 },
        uPainterShadowSoftness: { value: 0.012 },
        uPainterDesaturation: { value: 0.58 },
        uPainterMinimumBlack: { value: 0.19 },
        uPainterToneStrength: { value: 0.28 },
        uPainterToneColor: { value: new T.Color('#bd88aa') },
        uPainterLightTint: { value: new T.Color('#ffc4a8') },
        uPainterShadowTint: { value: new T.Color('#9b5fac') },
        uPainterLightTextureColorize: { value: 1 },
        uPainterShadowTextureColorize: { value: 1 },
        uPainterFocusHeight: { value: 1.02 }
    };
    function originalMaterial(color, brush, scale, strength, surfaceWeight, toneWeight)
    {
        const material = new T.MeshStandardMaterial({ color, metalness: 0, roughness: 0.9 });
        material.onBeforeCompile = (shader) =>
        {
            Object.assign(shader.uniforms, uniforms, {
                uPainterBrushTexture: { value: brush },
                uPainterBrushScale: { value: scale },
                uPainterBrushStrength: { value: strength },
                uPainterSurfaceTextureWeight: { value: surfaceWeight },
                uPainterToneWeight: { value: toneWeight },
                uPainterWobbleScale: { value: 1 }
            });
            shader.vertexShader = shaders.Ud + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', shaders.Wd);
            shader.fragmentShader = shaders.Kd + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', shaders.qd);
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', shaders.Jd);
        };
        material.customProgramCacheKey = () => 'independent-original-reference-glsl';
        return material;
    }
    const oracleWood = originalMaterial('#c2675b', referenceTextures[2], 4, 0.5, 0.28, 1);
    const oracleFloor = originalMaterial('#d89aac', referenceTextures[1], 3.2, 0.4, 1, 0.18);
    subject.material = oracleWood;
    floor.material = oracleFloor;
    const oraclePixels = render('original-glsl-oracle');
    const oracle = compare(local, oraclePixels);
    const webglError = gl.getError();
    const result = {
        profile: owner.getProfile(),
        resolution: '640x480',
        time,
        instances,
        instanceColorTolerance: { maxChannelDifference: 1, maxChangedPixelFraction: 0.0001, reason: 'Uniform color versus interpolated vertex color rounding only; geometry, time and oracle are exact.' },
        transformedInstance,
        shadows: { meshChangedPixels: meshShadow.changedPixels, instancedChangedPixels: instanceShadow.changedPixels },
        oracle,
        renderedColors: colors.size,
        webglError,
        images
    };
    oracleWood.dispose();
    oracleFloor.dispose();
    for (const texture of referenceTextures)
    {
        texture.dispose();
    }
    floorGeometry.dispose();
    shapeGeometry.dispose();
    owner.dispose();
    renderer.dispose();
    return result;
}
