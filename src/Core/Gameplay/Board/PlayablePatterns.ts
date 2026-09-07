import type { NumberedBeadPaletteEntry } from './NumberedBeadBoard';
import {
    STARTER_PATTERN_CATALOG,
    findStarterPattern
} from './StarterPatterns';
import type {
    StarterPatternCatalogEntry
} from './StarterPatterns';

// Original Mini design: 1159 beads form a 40-by-44 cutout on a 50-grid canvas.
// Dedicated color IDs keep every previously saved pattern and palette unchanged.
const MINI_STRAWBERRY_ROWS: readonly string[] = [
    '00000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000',
    '00000000000000000000000000455000000000000000000000',
    '00000000000000000000000004555000000000000000000000',
    '00000000000000000000000004554000000000000000000000',
    '00000000000000044000000004550000044000000000000000',
    '00000000000000044440000045550000444400000000000000',
    '00000004444440004544000045540004454400444000000000',
    '00000000455444444454400444540044544444444000000000',
    '00000000445555444455440444400445444444544000000000',
    '00000000044555554445544444444454444555444000000000',
    '00000000004455555444544445444544455554440000000000',
    '00000000002444455544454445544444555544400000000000',
    '00000000222224444444445445544445555444111000000000',
    '00000002222221114444444444554455444442221110000000',
    '00000022222333111222244444454444441122222111000000',
    '00000222223333332222222222444411222222222211100000',
    '00000222223363332222262222244422622222262211100000',
    '00000222233366322222266222222426622222662211100000',
    '00000222233333322222222222222222222222222211100000',
    '00000222233333222222222222222222222222222211100000',
    '00000222233333222222222222222222222222222211100000',
    '00000222263333222622222222622222222622222611100000',
    '00000222266332222662222226622222226622226611100000',
    '00000022223332222222222222222222222222222211100000',
    '00000022223332222222222222222222222222222111000000',
    '00000022223332222222222222222222222222222111000000',
    '00000002222362222222262222222262222222621110000000',
    '00000002222266222222266222222662222226611100000000',
    '00000000222223222222222222222222222222211100000000',
    '00000000222222222222222222222222222222111000000000',
    '00000000022222222222222222222222222221110000000000',
    '00000000002222262222222262222222262221110000000000',
    '00000000002222266222222266222222662211100000000000',
    '00000000000222222222222222222222222111000000000000',
    '00000000000022222222222222222222221110000000000000',
    '00000000000002222222222222222222211100000000000000',
    '00000000000000222226222222226222111000000000000000',
    '00000000000000022226622222266221110000000000000000',
    '00000000000000002222222222222211100000000000000000',
    '00000000000000000222222222222111000000000000000000',
    '00000000000000000022222262221110000000000000000000',
    '00000000000000000002222266211100000000000000000000',
    '00000000000000000000011111111000000000000000000000',
    '00000000000000000000001111110000000000000000000000',
    '00000000000000000000000011000000000000000000000000',
    '00000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000'
];

const MINI_STRAWBERRY_TARGETS = Object.freeze(parseRows(MINI_STRAWBERRY_ROWS));
const MINI_STRAWBERRY_PALETTE: readonly NumberedBeadPaletteEntry[] = Object.freeze([
    Object.freeze({ colorId: 'strawberry-shadow', number: 1 }),
    Object.freeze({ colorId: 'strawberry-red', number: 2 }),
    Object.freeze({ colorId: 'strawberry-highlight', number: 3 }),
    Object.freeze({ colorId: 'strawberry-leaf-dark', number: 4 }),
    Object.freeze({ colorId: 'strawberry-leaf-light', number: 5 }),
    Object.freeze({ colorId: 'strawberry-seed', number: 6 })
]);

// Original 29-peg charm: 0 is open background, 1 fruit, 2 highlight, 3 leaves, 4 seeds.
// The complete nonzero mask is one four-connected piece, including the stem.
const STRAWBERRY_CHARM_ROWS: readonly string[] = [
    '00000000000000000000000000000',
    '00000000000000000000000000000',
    '00000000000000300000000000000',
    '00000000000003330000000000000',
    '00000033300003330000333000000',
    '00000033333033333033333000000',
    '00000003333333333333330000000',
    '00000011333333333333311000000',
    '00000111133313331333111100000',
    '00001111113111311131111110000',
    '00001122111111111111111110000',
    '00001221114111111141111110000',
    '00001221114111111141111110000',
    '00001221111111111111111110000',
    '00000122411111411111141100000',
    '00000122411111411111141100000',
    '00000012111111111111111000000',
    '00000011114111111141111000000',
    '00000001114111111141110000000',
    '00000000111111111111100000000',
    '00000000011114111111000000000',
    '00000000001114114110000000000',
    '00000000000111114100000000000',
    '00000000000011111000000000000',
    '00000000000001110000000000000',
    '00000000000000100000000000000',
    '00000000000000000000000000000',
    '00000000000000000000000000000',
    '00000000000000000000000000000'
];

const STRAWBERRY_CHARM_TARGETS = Object.freeze(parseRows(STRAWBERRY_CHARM_ROWS));
const STRAWBERRY_CHARM_PALETTE: readonly NumberedBeadPaletteEntry[] = Object.freeze([
    Object.freeze({ colorId: 'red', number: 1 }),
    Object.freeze({ colorId: 'pink', number: 2 }),
    Object.freeze({ colorId: 'green', number: 3 }),
    Object.freeze({ colorId: 'cream', number: 4 })
]);

const PIXEL_HEART_ROWS: readonly string[] = [
    '0000000000000000',
    '0000000000000000',
    '0002210001110000',
    '0012211111111000',
    '0011111111111100',
    '0011111111111100',
    '0011111111111100',
    '0001111111111000',
    '0000111111110000',
    '0000011111100000',
    '0000001111000000',
    '0000000110000000',
    '0000000100000000',
    '0000000000000000',
    '0000000000000000',
    '0000000000000000'
];

const PIXEL_HEART_TARGETS = Object.freeze(parseRows(PIXEL_HEART_ROWS));
const PIXEL_HEART_PALETTE: readonly NumberedBeadPaletteEntry[] = Object.freeze([
    Object.freeze({ colorId: 'red', number: 1 }),
    Object.freeze({ colorId: 'pink', number: 2 })
]);

/** New pixel-coloring example; the original twelve bundled patterns remain unchanged. */
export const PIXEL_HEART_PATTERN: StarterPatternCatalogEntry = Object.freeze({
    colorCount: 2,
    difficulty: 'beginner',
    difficultyDescription: '入门 · 紧密爱心与自由背景格',
    estimatedMinutes: 5,
    height: 16,
    isAvailable: true,
    name: '像素爱心',
    palette: PIXEL_HEART_PALETTE,
    patternId: 'pixel-heart',
    targetNumbers: PIXEL_HEART_TARGETS,
    thumbnail: Object.freeze({
        colorNumbers: PIXEL_HEART_TARGETS,
        height: 16,
        width: 16
    }),
    width: 16
});

/** A clearer original cutout; its independent ID preserves every existing draft signature. */
export const STRAWBERRY_CHARM_PATTERN: StarterPatternCatalogEntry = Object.freeze({
    colorCount: 4,
    difficulty: 'beginner',
    difficultyDescription: '入门 · 清楚叶冠、奶油籽与留空背景',
    estimatedMinutes: 10,
    height: 29,
    isAvailable: true,
    name: '草莓吊饰',
    palette: STRAWBERRY_CHARM_PALETTE,
    patternId: 'atelier-strawberry-charm-29-v1',
    targetNumbers: STRAWBERRY_CHARM_TARGETS,
    thumbnail: Object.freeze({
        colorNumbers: STRAWBERRY_CHARM_TARGETS,
        height: 29,
        width: 29
    }),
    width: 29
});

/** A separate Mini cutout adds leaf veins, fruit volume and readable cream seed clusters. */
export const MINI_STRAWBERRY_PATTERN: StarterPatternCatalogEntry = Object.freeze({
    colorCount: 6,
    difficulty: 'standard',
    difficultyDescription: '细致 · 双色叶脉、弧形高光与奶油籽',
    estimatedMinutes: 35,
    height: 50,
    isAvailable: true,
    name: '莓果小物',
    palette: MINI_STRAWBERRY_PALETTE,
    patternId: 'atelier-strawberry-mini-50-v1',
    targetNumbers: MINI_STRAWBERRY_TARGETS,
    thumbnail: Object.freeze({
        colorNumbers: MINI_STRAWBERRY_TARGETS,
        height: 50,
        width: 50
    }),
    width: 50
});

/** Applies only before an existing local save restores its selected pattern. */
export const DEFAULT_PLAYABLE_PATTERN: StarterPatternCatalogEntry = MINI_STRAWBERRY_PATTERN;

/** New content precedes the fourteen immutable patterns used by existing local saves. */
export const PLAYABLE_PATTERN_CATALOG: readonly StarterPatternCatalogEntry[] =
    Object.freeze([
        MINI_STRAWBERRY_PATTERN,
        STRAWBERRY_CHARM_PATTERN,
        PIXEL_HEART_PATTERN,
        ...STARTER_PATTERN_CATALOG
    ]);

/** Resolves both the new example and the unchanged legacy starter catalog. */
export function findPlayablePattern(
    patternId: string
): StarterPatternCatalogEntry | null
{
    for (const pattern of PLAYABLE_PATTERN_CATALOG)
    {
        if (pattern.patternId === patternId)
        {
            return pattern;
        }
    }

    return findStarterPattern(patternId);
}

function parseRows(rows: readonly string[]): number[]
{
    const targetNumbers: number[] = [];

    for (const row of rows)
    {
        for (const character of row)
        {
            targetNumbers.push(Number(character));
        }
    }

    return targetNumbers;
}
