import type { NumberedBeadPaletteEntry } from './NumberedBeadBoard';
import {
    STARTER_PATTERN_CATALOG,
    findStarterPattern
} from './StarterPatterns';
import type {
    StarterPatternCatalogEntry
} from './StarterPatterns';

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

/** Runtime catalog adds the independent example without changing the original twelve. */
export const PLAYABLE_PATTERN_CATALOG: readonly StarterPatternCatalogEntry[] =
    Object.freeze([
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
