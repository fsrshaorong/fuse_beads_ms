import {
    ACESFilmicToneMapping, AmbientLight, DirectionalLight, Group, HemisphereLight,
    PCFShadowMap, PointLight, SRGBColorSpace, Vector3, WebGLRenderer
} from 'three';

/** Applies the published Soft Toy Room output settings, with no temporal effects. */
export function configurePainterlyRenderer(renderer: WebGLRenderer, pixelRatio: number): void
{
    renderer.setPixelRatio(Math.min(pixelRatio, 1.75));
    renderer.setClearColor(0xffe7d3, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    // Three r185 also converts the reference's deprecated PCFSoft setting to PCF.
    renderer.shadowMap.type = PCFShadowMap;
}

/**
 * Creates the reference's five lights. Only the practical lamp position may be
 * adapted to a scene's visible bulb. The caller owns the directional shadow map.
 */
export function createPainterlyLighting(lampPosition = new Vector3(-2.12, 2.32, -0.7)): Group
{
    const lighting = new Group();
    lighting.name = 'SoftToyRoomLighting';
    const sunlight = new DirectionalLight('#ffd2a6', 4.6);
    sunlight.name = 'PainterlySunlight';
    sunlight.position.set(-4.2, 7.5, 6.4);
    sunlight.target.position.set(0, 0.65, -0.65);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -6;
    sunlight.shadow.camera.right = 6;
    sunlight.shadow.camera.top = 6;
    sunlight.shadow.camera.bottom = -4;
    sunlight.shadow.camera.near = 0.5;
    sunlight.shadow.camera.far = 22;
    sunlight.shadow.bias = -0.00028;
    sunlight.shadow.normalBias = 0.026;
    sunlight.shadow.radius = 2.05;
    const fill = new PointLight('#b9b5dc', 1.45 * 2.4, 8, 2);
    fill.position.set(3.6, 3.8, 2.8);
    const lamp = new PointLight('#ffc4a8', 9.8, 4.2, 2);
    lamp.name = 'PainterlyDeskLamp';
    lamp.position.copy(lampPosition);
    lighting.add(
        new AmbientLight('#ffe5c6', 0.32),
        new HemisphereLight('#b9b5dc', '#9b5fac', 1.45 * 0.64),
        sunlight, sunlight.target, fill, lamp
    );

    return lighting;
}
