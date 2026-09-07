import type { NumberedBeadPaletteEntry } from './NumberedBeadBoard';
import {
    STARTER_PATTERN_CATALOG,
    findStarterPattern
} from './StarterPatterns';
import type {
    StarterPatternCatalogEntry
} from './StarterPatterns';

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

/** Applies only before an existing local save restores its selected pattern. */
export const DEFAULT_PLAYABLE_PATTERN: StarterPatternCatalogEntry = STRAWBERRY_CHARM_PATTERN;

/** New content precedes the thirteen immutable patterns used by existing local saves. */
export const PLAYABLE_PATTERN_CATALOG: readonly StarterPatternCatalogEntry[] =
    Object.freeze([
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
