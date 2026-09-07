import {
    Color, DataTexture, MeshStandardMaterial, NoColorSpace, RepeatWrapping,
    RGBAFormat, ShaderChunk, SRGBColorSpace, Texture, TextureLoader
} from 'three';

import {
    PAINTERLY_BRUSH_FRAGMENT,
    PAINTERLY_FRAGMENT_DECLARATIONS,
    PAINTERLY_LIGHT_FRAGMENT,
    PAINTERLY_VERTEX_DECLARATIONS,
    PAINTERLY_VERTEX_POSITION
} from './PainterlyShaders';
import { REFERENCE_PAINTERLY_ROLE_SETTINGS } from './ReferenceProfile';
import type { ReferencePainterlyRole, ReferencePainterlyRoleSettings } from './ReferenceProfile';

/** Source roles plus compatibility aliases for existing workshop geometry. */
export type PainterlyRole = ReferencePainterlyRole
    | 'wall' | 'floor' | 'ceramic' | 'bead' | 'board' | 'metal' | 'foliage';

/** Final reference composition parameters; CSS colors are sRGB hex values. */
export interface PainterlyProfile
{
    readonly brushStrength: number;
    readonly brushScale: number;
    readonly shadowStrength: number;
    readonly shadowThreshold: number;
    readonly shadowSoftness: number;
    readonly shadowTint: string;
    readonly lightTint: string;
    readonly lightTextureColorize: number;
    readonly shadowTextureColorize: number;
    readonly desaturation: number;
    readonly minimumBlack: number;
    readonly toneStrength: number;
    readonly toneColor: string;
    readonly focusHeight: number;
    /** Legacy UI control: one leaves the reference light tint unchanged. */
    readonly warmth: number;
    /** Retained compatibility field; only zero is accepted in this static renderer. */
    readonly boilAmount: number;
}

/** Exact ef article preset, with temporal motion removed by user request. */
export const DEFAULT_PAINTERLY_PROFILE: Readonly<PainterlyProfile> = Object.freeze({
    brushStrength: 0.5,
    brushScale: 3.2,
    shadowStrength: 0.92,
    shadowThreshold: 0.7,
    shadowSoftness: 0.012,
    shadowTint: '#9b5fac',
    lightTint: '#ffc4a8',
    lightTextureColorize: 1,
    shadowTextureColorize: 1,
    desaturation: 0.58,
    minimumBlack: 0.19,
    toneStrength: 0.28,
    toneColor: '#bd88aa',
    focusHeight: 1.02,
    warmth: 1,
    boilAmount: 0
});

interface MaterialHandle
{
    readonly material: MeshStandardMaterial;
    readonly settings: ReferencePainterlyRoleSettings;
    readonly brushScale: { value: number };
    readonly brushStrength: { value: number };
    readonly shadowStrength: { value: number };
    readonly shadowStrengthMultiplier: number;
}

const ROLE_ALIASES: Readonly<Record<string, ReferencePainterlyRole>> = {
    wall: 'background',
    floor: 'ground',
    ceramic: 'cream',
    bead: 'cream',
    board: 'cream',
    metal: 'charcoal',
    foliage: 'green'
};

// CSS-pixel widths for the requested outline layer; surface shading is unchanged.
const OUTLINE_ROLE_WIDTHS: Readonly<Partial<Record<PainterlyRole, number>>> = {
    background: 0.65,
    ground: 0,
    woodDark: 1.35,
    fabric: 1.15,
    green: 1,
    blue: 0,
    bead: 0.25,
    board: 1
};

const NUMERIC_PROFILE_RANGES = {
    brushStrength: [0, 1],
    brushScale: [0.5, 8],
    shadowStrength: [0, 1],
    shadowThreshold: [0.05, 0.98],
    shadowSoftness: [0.002, 0.08],
    lightTextureColorize: [0, 1],
    shadowTextureColorize: [0, 1],
    desaturation: [0, 1],
    minimumBlack: [0, 0.4],
    toneStrength: [0, 0.75],
    focusHeight: [0.2, 2.2],
    warmth: [0, 1],
    boilAmount: [0, 0]
} as const;

/**
 * Owns the static reference port and local reference textures.
 * All roles use the source's full dual-texture composition. There is no custom
 * geometry deformation, so ordinary Three depth materials match every instance.
 * Bead and board roles alone adapt shadow sampling and strength to their scale.
 */
export class PainterlyMaterials
{
    public readonly ready: Promise<void>;

    private profile: PainterlyProfile = { ...DEFAULT_PAINTERLY_PROFILE };
    private readonly materials = new Map<string, MaterialHandle>();
    private readonly ownedTextures = new Set<Texture>();
    private disposed = false;
    private readonly uniforms = {
        uPainterBrushEnabled: { value: 1 },
        uPainterRealtimeShadowsEnabled: { value: 1 },
        uPainterDualTextureEnabled: { value: 1 },
        uPainterDesaturationEnabled: { value: 1 },
        uPainterMinimumBlackEnabled: { value: 1 },
        uPainterFadeToToneEnabled: { value: 1 },
        uPainterShadowStrength: { value: 0.92 },
        uPainterShadowThreshold: { value: 0.7 },
        uPainterShadowSoftness: { value: 0.012 },
        uPainterDesaturation: { value: 0.58 },
        uPainterMinimumBlack: { value: 0.19 },
        uPainterToneStrength: { value: 0.28 },
        uPainterFocusHeight: { value: 1.02 },
        uPainterLightTextureColorize: { value: 1 },
        uPainterShadowTextureColorize: { value: 1 },
        uPainterToneColor: { value: new Color() },
        uPainterLightTint: { value: new Color() },
        uPainterShadowTint: { value: new Color() }
    };
    private readonly whiteTexture: DataTexture;
    private readonly light: { value: Texture };
    private readonly shadow: { value: Texture };
    private readonly brushes: readonly { value: Texture }[];

    /** Loads the six packaged source resources; ready rejects with the missing URL. */
    public constructor(textureRoot = '/textures/painterly/')
    {
        this.whiteTexture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
        this.whiteTexture.colorSpace = SRGBColorSpace;
        this.whiteTexture.needsUpdate = true;
        this.ownedTextures.add(this.whiteTexture);
        this.light = { value: this.whiteTexture };
        this.shadow = { value: this.whiteTexture };
        this.brushes = [
            { value: this.whiteTexture },
            { value: this.whiteTexture },
            { value: this.whiteTexture }
        ];
        const noise: { value: Texture } = { value: this.whiteTexture };
        const root = textureRoot.endsWith('/') ? textureRoot : `${textureRoot}/`;
        const loader = new TextureLoader();
        this.applyProfileUniforms();
        this.ready = Promise.all([
            // Keep the package contract intact; static shaders never sample noise.
            this.loadTexture(loader, `${root}noise-comparison.png`, noise, false),
            this.loadTexture(loader, `${root}brush-strokes.png`, this.brushes[0], false),
            this.loadTexture(loader, `${root}brush-strokes-02.png`, this.brushes[1], false),
            this.loadTexture(loader, `${root}brush-strokes-03.png`, this.brushes[2], false),
            this.loadTexture(loader, `${root}shadow-light-pair.png`, this.light, true),
            this.loadTexture(loader, `${root}shadow-texture.png`, this.shadow, true)
        ]).then((): void => {});
    }

    /**
     * Returns an owner-managed material shared by source role and color. Authored
     * UVs drive the brush; world position drives the light/shadow textures. Caller
     * instance colors multiply the supplied base color exactly as in Three.
     */
    public create(color: string, role: PainterlyRole): MeshStandardMaterial
    {
        this.assertAlive();
        const sourceRole = resolveRole(role);
        const cacheKey = `${role}:${color.toLowerCase()}`;
        const existing = this.materials.get(cacheKey);
        if (existing !== undefined)
        {
            return existing.material;
        }

        const settings = REFERENCE_PAINTERLY_ROLE_SETTINGS[sourceRole];
        const microSurface = role === 'bead' || role === 'board';
        const shadowStrengthMultiplier = role === 'bead' ? 0.30 : role === 'board' ? 0.25 : 1;
        const material = new MeshStandardMaterial({
            color,
            map: this.whiteTexture,
            vertexColors: role === 'bead',
            roughness: settings.roughness,
            metalness: 0
        });
        const handle: MaterialHandle = {
            material,
            settings,
            brushScale: { value: this.profile.brushScale * settings.brushScaleMultiplier },
            brushStrength: { value: this.profile.brushStrength * settings.brushStrengthMultiplier },
            shadowStrength: { value: this.profile.shadowStrength * shadowStrengthMultiplier },
            shadowStrengthMultiplier
        };
        material.name = `Painterly:${sourceRole}:${color}`;
        material.userData.painterlyOutline = {
            width: OUTLINE_ROLE_WIDTHS[role] ?? OUTLINE_ROLE_WIDTHS[sourceRole] ?? 1.5
        };
        material.onBeforeCompile = (shader): void =>
        {
            Object.assign(shader.uniforms, this.uniforms, {
                uPainterLightTexture: this.light,
                uPainterShadowTexture: this.shadow,
                uPainterBrushTexture: this.brushes[settings.brushIndex],
                uPainterBrushScale: handle.brushScale,
                uPainterBrushStrength: handle.brushStrength,
                uPainterShadowStrength: handle.shadowStrength,
                uPainterSurfaceTextureWeight: { value: settings.surfaceTextureWeight },
                uPainterToneWeight: { value: settings.toneWeight }
            });
            shader.vertexShader = PAINTERLY_VERTEX_DECLARATIONS + shader.vertexShader;
            shader.vertexShader = replaceShaderChunk(shader.vertexShader,
                '#include <project_vertex>', PAINTERLY_VERTEX_POSITION);
            if (microSurface)
            {
                // The room's 0.026-world-unit normal offset exceeds a small bead's
                // bore. Limit receiver displacement without changing any caster,
                // room material, shadow map, or reference light/color formula.
                const microShadowVertex = replaceShaderChunk(ShaderChunk.shadowmap_vertex,
                    'directionalLightShadows[ i ].shadowNormalBias',
                    'min( directionalLightShadows[ i ].shadowNormalBias, 0.0004 )');
                shader.vertexShader = replaceShaderChunk(shader.vertexShader,
                    '#include <shadowmap_vertex>', microShadowVertex);
            }
            shader.fragmentShader = PAINTERLY_FRAGMENT_DECLARATIONS + shader.fragmentShader;
            shader.fragmentShader = replaceShaderChunk(shader.fragmentShader,
                '#include <shadowmap_pars_fragment>',
                '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
            shader.fragmentShader = replaceShaderChunk(shader.fragmentShader,
                '#include <map_fragment>', PAINTERLY_BRUSH_FRAGMENT);
            shader.fragmentShader = replaceShaderChunk(shader.fragmentShader,
                '#include <opaque_fragment>', PAINTERLY_LIGHT_FRAGMENT);
        };
        material.customProgramCacheKey = (): string => microSurface
            ? 'assemble-painterly-v7-micro-shadow-static-instanced-r185'
            : 'assemble-painterly-v6-static-instanced-r185';
        this.materials.set(cacheKey, handle);

        return material;
    }

    /** Compatibility entry point: this static shader has no time uniforms to advance. */
    public update(_timeSeconds: number): void
    {
        return;
    }

    /** Atomically validates panel changes and updates existing role uniforms. */
    public setProfile(partial: Partial<PainterlyProfile>): void
    {
        this.assertAlive();
        const candidate = { ...this.profile, ...partial };
        validateProfile(candidate);
        this.profile = candidate;
        this.applyProfileUniforms();
    }

    /** Returns a detached snapshot of the effective static composition. */
    public getProfile(): Readonly<PainterlyProfile>
    {
        return Object.freeze({ ...this.profile });
    }

    /** Releases owned materials and textures once, including resources still loading. */
    public dispose(): void
    {
        if (this.disposed)
        {
            return;
        }
        this.disposed = true;
        for (const handle of this.materials.values())
        {
            handle.material.dispose();
        }
        for (const texture of this.ownedTextures)
        {
            texture.dispose();
        }
        this.materials.clear();
        this.ownedTextures.clear();
    }

    private async loadTexture(
        loader: TextureLoader,
        url: string,
        target: { value: Texture },
        colorData: boolean
    ): Promise<void>
    {
        let texture: Texture;
        try
        {
            texture = await loader.loadAsync(url);
        }
        catch
        {
            throw new Error(`Painterly texture could not be loaded: ${url}`);
        }
        if (this.disposed)
        {
            texture.dispose();
            return;
        }
        texture.colorSpace = colorData ? SRGBColorSpace : NoColorSpace;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        // Three clamps this to the device limit, matching min(maxAnisotropy, 8).
        texture.anisotropy = 8;
        texture.needsUpdate = true;
        this.ownedTextures.add(texture);
        target.value = texture;
    }

    private applyProfileUniforms(): void
    {
        const profile = this.profile;
        this.uniforms.uPainterShadowStrength.value = profile.shadowStrength;
        this.uniforms.uPainterShadowThreshold.value = profile.shadowThreshold;
        this.uniforms.uPainterShadowSoftness.value = profile.shadowSoftness;
        this.uniforms.uPainterDesaturation.value = profile.desaturation;
        this.uniforms.uPainterMinimumBlack.value = profile.minimumBlack;
        this.uniforms.uPainterToneStrength.value = profile.toneStrength;
        this.uniforms.uPainterFocusHeight.value = profile.focusHeight;
        this.uniforms.uPainterLightTextureColorize.value = profile.lightTextureColorize;
        this.uniforms.uPainterShadowTextureColorize.value = profile.shadowTextureColorize;
        this.uniforms.uPainterToneColor.value.set(profile.toneColor);
        this.uniforms.uPainterShadowTint.value.set(profile.shadowTint);
        this.uniforms.uPainterLightTint.value.set('#ffffff').lerp(
            new Color(profile.lightTint), profile.warmth);
        for (const handle of this.materials.values())
        {
            handle.brushScale.value = profile.brushScale * handle.settings.brushScaleMultiplier;
            handle.brushStrength.value = profile.brushStrength * handle.settings.brushStrengthMultiplier;
            handle.shadowStrength.value = profile.shadowStrength * handle.shadowStrengthMultiplier;
        }
    }

    private assertAlive(): void
    {
        if (this.disposed)
        {
            throw new Error('PainterlyMaterials has already been disposed.');
        }
    }
}

function resolveRole(role: PainterlyRole): ReferencePainterlyRole
{
    const sourceRole = ROLE_ALIASES[role] ?? role;
    if (!(sourceRole in REFERENCE_PAINTERLY_ROLE_SETTINGS))
    {
        throw new TypeError(`Painterly role is not available: ${role}`);
    }
    return sourceRole as ReferencePainterlyRole;
}

function validateProfile(profile: PainterlyProfile): void
{
    for (const key of Object.keys(NUMERIC_PROFILE_RANGES) as (keyof typeof NUMERIC_PROFILE_RANGES)[])
    {
        const value = profile[key];
        const range = NUMERIC_PROFILE_RANGES[key];
        if (!Number.isFinite(value) || value < range[0] || value > range[1])
        {
            throw new RangeError(`Painterly ${key} must be between ${range[0]} and ${range[1]}.`);
        }
    }
    for (const key of ['shadowTint', 'lightTint', 'toneColor'] as const)
    {
        if (!/^#[0-9a-f]{6}$/i.test(profile[key]))
        {
            throw new TypeError(`Painterly ${key} must be a six-digit hex color.`);
        }
    }
}

function replaceShaderChunk(source: string, chunk: string, replacement: string): string
{
    if (!source.includes(chunk))
    {
        throw new Error(`Painterly expected Three r185 shader chunk: ${chunk}`);
    }

    return source.replace(chunk, replacement);
}
