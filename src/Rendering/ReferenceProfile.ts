import { Color } from 'three';

/** Article preset and cf() palette derivation from ToyRoomScene-CuoAGneb.js. */
export const REFERENCE_PAINTERLY_PALETTE = Object.freeze({
    background: '#f1c7b6',
    ground: '#d89aac',
    wood: '#c2675b',
    woodDark: hex(new Color('#c2675b').offsetHSL(0, -0.03, -0.2)),
    fabric: '#e8998d',
    accent: '#6fa79f',
    cream: hex(new Color('#f1c7b6').lerp(new Color('#fff3d2'), 0.62)),
    lavender: hex(new Color('#9b5fac').lerp(new Color('#e9d5e8'), 0.5)),
    yellow: hex(new Color('#ffc4a8').offsetHSL(0.055, 0.12, -0.08)),
    charcoal: hex(new Color('#9b5fac').offsetHSL(0, -0.24, -0.28)),
    green: hex(new Color('#6fa79f').offsetHSL(0.035, 0.02, -0.12)),
    blue: hex(new Color('#b9b5dc').lerp(new Color('#d8f1eb'), 0.36))
});

/** Named source roles; neutral uses the original Xd/M factory defaults. */
export type ReferencePainterlyRole = keyof typeof REFERENCE_PAINTERLY_PALETTE | 'neutral';

/** Per-role overrides passed to the original M() material factory. */
export interface ReferencePainterlyRoleSettings
{
    readonly surfaceTextureWeight: number;
    readonly toneWeight: number;
    readonly brushScaleMultiplier: number;
    readonly brushStrengthMultiplier: number;
    readonly brushIndex: number;
    readonly roughness: number;
}

/** Brush indices preserve the source's twelve-material construction order. */
export const REFERENCE_PAINTERLY_ROLE_SETTINGS: Readonly<Record<ReferencePainterlyRole, ReferencePainterlyRoleSettings>> = {
    background: role(0.78, 0, { toneWeight: 0, brushStrengthMultiplier: 0.72 }),
    ground: role(1, 1, { toneWeight: 0.18, brushStrengthMultiplier: 0.8 }),
    wood: role(0.28, 2, { brushScaleMultiplier: 1.25 }),
    woodDark: role(0.32, 0, { brushScaleMultiplier: 1.35 }),
    fabric: role(0.25, 1, { brushStrengthMultiplier: 1.16 }),
    accent: role(0.27, 2, { brushStrengthMultiplier: 1.2 }),
    cream: role(0.2, 0, { brushStrengthMultiplier: 1.12 }),
    lavender: role(0.3, 1),
    yellow: role(0.22, 2, { roughness: 0.82 }),
    charcoal: role(0.18, 0),
    green: role(0.24, 1),
    blue: role(0.42, 2, { toneWeight: 0 }),
    neutral: role(0.3, 0)
};

function role(
    surfaceTextureWeight: number,
    brushIndex: number,
    overrides: Partial<ReferencePainterlyRoleSettings> = {}
): Readonly<ReferencePainterlyRoleSettings>
{
    return Object.freeze({
        surfaceTextureWeight,
        brushIndex,
        toneWeight: 1,
        brushScaleMultiplier: 1,
        brushStrengthMultiplier: 1,
        roughness: 0.9,
        ...overrides
    });
}

function hex(color: Color): string
{
    return `#${color.getHexString()}`;
}
