import {
    BackSide, BufferGeometry, Camera, Color, Line, Material, Mesh, Object3D, Points,
    Scene, ShaderMaterial, Sprite, Vector2, Vector4, WebGLRenderer
} from 'three';

import { PAINTERLY_OUTLINE_FRAGMENT, PAINTERLY_OUTLINE_VERTEX } from './PainterlyOutlineShaders';
import { PainterlyOutlineGeometry } from './PainterlyOutlineGeometry';

/** Global outline controls. Width is a fallback CSS-pixel radius; strength scales every role. */
export interface PainterlyOutlineProfile
{
    readonly enabled: boolean;
    readonly width: number;
    readonly strength: number;
    readonly color: string;
    readonly opacity: number;
}

/** Explicit material/object userData.painterlyOutline metadata; objects override materials. */
export interface PainterlyOutlineSettings
{
    readonly enabled?: boolean;
    readonly width?: number;
    readonly color?: string;
    readonly opacity?: number;
}

/** User-requested steady ink contour; not claimed to be an effect in the reference bundle. */
export const DEFAULT_PAINTERLY_OUTLINE_PROFILE: Readonly<PainterlyOutlineProfile> = Object.freeze({
    enabled: true,
    width: 2,
    strength: 1,
    color: '#59424f',
    opacity: 1
});

interface RenderableObject extends Object3D
{
    material: Material | Material[];
}

interface CachedMaterial
{
    readonly material: ShaderMaterial;
    lastFrame: number;
}

interface MaterialSwap
{
    object: RenderableObject | null;
    originalMaterial: Material | Material[] | null;
    originalGeometry: BufferGeometry | null;
    originalBefore: Object3D['onBeforeRender'] | null;
    originalAfter: Object3D['onAfterRender'] | null;
    readonly replacements: Material[];
    readonly beforeOutline: Object3D['onBeforeRender'];
}

const EMPTY_CALLBACK: Object3D['onBeforeRender'] = (): void => {};

/**
 * Draws the normal scene followed by an isolated back-face contour pass. Geometry,
 * instance buffers, transforms and source materials stay owned by their callers.
 * No time input, vertex noise, render targets or postprocessing color pass is used.
 */
export class PainterlyOutline
{
    private profile: PainterlyOutlineProfile = { ...DEFAULT_PAINTERLY_OUTLINE_PROFILE };
    private readonly cache = new Map<Material, CachedMaterial>();
    private readonly geometries = new PainterlyOutlineGeometry();
    private readonly swaps: MaterialSwap[] = [];
    private readonly viewport = new Vector4();
    private readonly hiddenMaterial = new ShaderMaterial({ visible: false });
    private swapCount = 0;
    private frame = 0;
    private disposed = false;
    private rendering = false;
    private pixelRatio = 1;
    private readonly prepareObject = (object: Object3D): void => this.prepareRenderable(object);

    /** The caller retains the renderer and must dispose this pass before that renderer. */
    public constructor(private readonly renderer: WebGLRenderer)
    {
        this.hiddenMaterial.name = 'PainterlyOutline:Hidden';
    }

    /** Renders beauty and contour; disabled mode is exactly the normal renderer path. */
    public render(scene: Scene, camera: Camera): void
    {
        this.assertAlive();
        if (this.rendering)
        {
            throw new Error('PainterlyOutline.render cannot be called recursively.');
        }
        this.rendering = true;
        try
        {
            this.renderer.render(scene, camera);
            if (this.profile.enabled && this.profile.strength > 0)
            {
                this.renderContours(scene, camera);
            }
        }
        finally
        {
            this.rendering = false;
        }
    }

    /** Applies validated controls atomically without rebuilding geometry or compiling shaders. */
    public setProfile(partial: Partial<PainterlyOutlineProfile>): void
    {
        this.assertAlive();
        const candidate = { ...this.profile, ...partial };
        validateSettings(candidate);
        if (typeof candidate.enabled !== 'boolean'
            || typeof candidate.width !== 'number' || typeof candidate.opacity !== 'number'
            || typeof candidate.color !== 'string'
            || !Number.isFinite(candidate.strength) || candidate.strength < 0 || candidate.strength > 3)
        {
            throw new RangeError('Painterly outline needs a boolean enabled flag and strength between 0 and 3.');
        }
        this.profile = candidate;
    }

    /** Returns a detached effective profile for UI reset and validation. */
    public getProfile(): Readonly<PainterlyOutlineProfile>
    {
        return Object.freeze({ ...this.profile });
    }

    /** Releases only pass-owned copies, never source geometry, materials, textures or the renderer. */
    public dispose(): void
    {
        if (this.disposed)
        {
            return;
        }
        if (this.rendering)
        {
            throw new Error('PainterlyOutline cannot be disposed during its render callback.');
        }
        this.disposed = true;
        for (const entry of this.cache.values())
        {
            entry.material.dispose();
        }
        this.cache.clear();
        this.geometries.dispose();
        this.swaps.length = 0;
        this.hiddenMaterial.dispose();
    }

    private renderContours(scene: Scene, camera: Camera): void
    {
        const renderer = this.renderer;
        const autoClear = renderer.autoClear;
        const autoReset = renderer.info.autoReset;
        const shadowEnabled = renderer.shadowMap.enabled;
        const autoUpdate = scene.matrixWorldAutoUpdate;
        const background = scene.background;
        const overrideMaterial = scene.overrideMaterial;
        const beforeRender = scene.onBeforeRender;
        const afterRender = scene.onAfterRender;
        this.frame += 1;
        this.pixelRatio = renderer.getPixelRatio();
        renderer.getCurrentViewport(this.viewport);
        this.swapCount = 0;

        try
        {
            renderer.autoClear = false;
            renderer.info.autoReset = false;
            renderer.shadowMap.enabled = false;
            scene.matrixWorldAutoUpdate = false;
            scene.background = null;
            scene.overrideMaterial = null;
            scene.onBeforeRender = EMPTY_CALLBACK;
            scene.onAfterRender = EMPTY_CALLBACK;
            scene.traverseVisible(this.prepareObject);
            renderer.render(scene, camera);
        }
        finally
        {
            this.restoreMaterials();
            renderer.autoClear = autoClear;
            renderer.info.autoReset = autoReset;
            renderer.shadowMap.enabled = shadowEnabled;
            scene.matrixWorldAutoUpdate = autoUpdate;
            scene.background = background;
            scene.overrideMaterial = overrideMaterial;
            scene.onBeforeRender = beforeRender;
            scene.onAfterRender = afterRender;
            this.pruneCache();
            this.geometries.prune(this.frame);
        }
    }

    private prepareRenderable(object: Object3D): void
    {
        if (!isRenderable(object))
        {
            return;
        }
        let swap = this.swaps[this.swapCount];
        if (swap === undefined)
        {
            swap = this.createSwap();
            this.swaps.push(swap);
        }
        this.swapCount += 1;
        swap.object = object;
        swap.originalMaterial = object.material;
        swap.originalGeometry = object instanceof Mesh ? object.geometry : null;
        swap.originalBefore = object.onBeforeRender;
        swap.originalAfter = object.onAfterRender;
        object.onBeforeRender = swap.beforeOutline;
        object.onAfterRender = EMPTY_CALLBACK;

        if (Array.isArray(swap.originalMaterial))
        {
            swap.replacements.length = swap.originalMaterial.length;
            for (let index = 0; index < swap.originalMaterial.length; index += 1)
            {
                swap.replacements[index] = this.getMaterial(object, swap.originalMaterial[index]);
            }
            object.material = swap.replacements;
        }
        else
        {
            object.material = this.getMaterial(object, swap.originalMaterial);
        }
        const drawsOutline = Array.isArray(object.material)
            ? object.material.some((material) => material !== this.hiddenMaterial)
            : object.material !== this.hiddenMaterial;
        if (object instanceof Mesh && drawsOutline)
        {
            object.geometry = this.geometries.get(object.geometry, this.frame);
        }
    }

    private createSwap(): MaterialSwap
    {
        const swap: MaterialSwap = {
            object: null,
            originalMaterial: null,
            originalGeometry: null,
            originalBefore: null,
            originalAfter: null,
            replacements: [],
            beforeOutline: (_renderer, _scene, _camera, _geometry, material): void =>
            {
                const source = Array.isArray(swap.originalMaterial)
                    ? swap.originalMaterial.find((candidate) => this.cache.get(candidate)?.material === material)
                    : swap.originalMaterial;
                if (swap.object !== null && source !== null && source !== undefined
                    && material instanceof ShaderMaterial)
                {
                    this.updateUniforms(material, source, swap.object);
                }
            }
        };
        return swap;
    }

    private getMaterial(object: RenderableObject, source: Material): Material
    {
        if (!(object instanceof Mesh) || object.geometry.getAttribute('normal') === undefined
            || !source.visible || !source.depthTest || ('wireframe' in source && source.wireframe === true))
        {
            return this.hiddenMaterial;
        }
        const materialSettings = readSettings(source.userData.painterlyOutline);
        const objectSettings = readSettings(object.userData.painterlyOutline);
        if ((materialSettings === null && objectSettings === null)
            || (objectSettings?.enabled ?? materialSettings?.enabled) === false
            || (objectSettings?.width ?? materialSettings?.width ?? this.profile.width) === 0)
        {
            return this.hiddenMaterial;
        }
        let entry = this.cache.get(source);
        if (entry === undefined)
        {
            const material = new ShaderMaterial({
                name: 'PainterlyOutline:Hull',
                vertexShader: PAINTERLY_OUTLINE_VERTEX,
                fragmentShader: PAINTERLY_OUTLINE_FRAGMENT,
                side: BackSide,
                depthTest: true,
                depthWrite: false,
                transparent: true,
                clipping: true,
                uniforms: {
                    uOutlineViewport: { value: new Vector2() },
                    uOutlineWidth: { value: 0 },
                    uOutlineColor: { value: new Color() },
                    uOutlineOpacity: { value: 1 }
                }
            });
            entry = { material, lastFrame: this.frame };
            this.cache.set(source, entry);
        }
        entry.lastFrame = this.frame;
        entry.material.clippingPlanes = source.clippingPlanes;
        entry.material.clipIntersection = source.clipIntersection;
        return entry.material;
    }

    private updateUniforms(material: ShaderMaterial, source: Material, object: Object3D): void
    {
        const materialSettings = readSettings(source.userData.painterlyOutline);
        const objectSettings = readSettings(object.userData.painterlyOutline);
        const width = objectSettings?.width ?? materialSettings?.width ?? this.profile.width;
        const color = objectSettings?.color ?? materialSettings?.color ?? this.profile.color;
        const opacity = objectSettings?.opacity ?? materialSettings?.opacity ?? this.profile.opacity;
        material.uniforms.uOutlineViewport.value.set(
            Math.max(1, this.viewport.z), Math.max(1, this.viewport.w));
        material.uniforms.uOutlineWidth.value = width * this.profile.strength * this.pixelRatio;
        material.uniforms.uOutlineColor.value.set(color);
        material.uniforms.uOutlineOpacity.value = opacity * source.opacity;
        material.uniformsNeedUpdate = true;
    }

    private restoreMaterials(): void
    {
        for (let index = 0; index < this.swapCount; index += 1)
        {
            const swap = this.swaps[index];
            if (swap.object !== null && swap.originalMaterial !== null)
            {
                swap.object.material = swap.originalMaterial;
                if (swap.object instanceof Mesh && swap.originalGeometry !== null)
                {
                    swap.object.geometry = swap.originalGeometry;
                }
                swap.object.onBeforeRender = swap.originalBefore ?? EMPTY_CALLBACK;
                swap.object.onAfterRender = swap.originalAfter ?? EMPTY_CALLBACK;
            }
            swap.object = null;
            swap.originalMaterial = null;
            swap.originalGeometry = null;
            swap.originalBefore = null;
            swap.originalAfter = null;
            swap.replacements.length = 0;
        }
        this.swapCount = 0;
    }

    private pruneCache(): void
    {
        for (const [source, entry] of this.cache)
        {
            if (this.frame - entry.lastFrame > 120)
            {
                entry.material.dispose();
                this.cache.delete(source);
            }
        }
    }

    private assertAlive(): void
    {
        if (this.disposed)
        {
            throw new Error('PainterlyOutline has already been disposed.');
        }
    }
}

function isRenderable(object: Object3D): object is RenderableObject
{
    return object instanceof Mesh || object instanceof Line || object instanceof Points || object instanceof Sprite;
}

function readSettings(value: unknown): PainterlyOutlineSettings | null
{
    if (value === undefined || value === null)
    {
        return null;
    }
    if (typeof value !== 'object' || Array.isArray(value))
    {
        throw new TypeError('userData.painterlyOutline must be an object.');
    }
    validateSettings(value);
    return value;
}

function validateSettings(value: PainterlyOutlineSettings): void
{
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    {
        throw new TypeError('Painterly outline enabled must be boolean.');
    }
    if (value.width !== undefined
        && (!Number.isFinite(value.width) || value.width < 0 || value.width > 8))
    {
        throw new RangeError('Painterly outline width must be between 0 and 8 CSS pixels.');
    }
    if (value.opacity !== undefined
        && (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1))
    {
        throw new RangeError('Painterly outline opacity must be between 0 and 1.');
    }
    if (value.color !== undefined && !/^#[0-9a-f]{6}$/i.test(value.color))
    {
        throw new TypeError('Painterly outline color must be a six-digit hex color.');
    }
}
