import { DETAILED_PATTERN_DATA } from './DetailedPatternData';
import type { StarterPatternCatalogEntry } from './StarterPatterns';

/** Authored at the final resolution; old IDs and signatures remain untouched. */
export const DETAILED_PATTERN_CATALOG: readonly StarterPatternCatalogEntry[] = Object.freeze(
    DETAILED_PATTERN_DATA.map((definition): StarterPatternCatalogEntry =>
    {
        const targetNumbers = Object.freeze(definition.rows.flatMap((row) => [...row].map(Number)));
        const palette = Object.freeze(definition.colorIds.map((colorId, index) =>
            Object.freeze({ colorId, number: index + 1 })));
        return Object.freeze({
            patternId: definition.patternId,
            name: definition.name,
            width: 50,
            height: 50,
            colorCount: palette.length,
            difficulty: definition.difficulty,
            difficultyDescription: definition.difficultyDescription,
            estimatedMinutes: definition.estimatedMinutes,
            isAvailable: true,
            targetNumbers,
            palette,
            thumbnail: Object.freeze({ width: 50, height: 50, colorNumbers: targetNumbers })
        });
    })
);

/** Older detailed subjects remain selectable for saved drafts, below the new editions. */
export const LEGACY_COMPLEX_PATTERN_IDS: readonly string[] = Object.freeze([
    'standard-strawberry', 'atelier-strawberry-charm-29-v1',
    'standard-duck', 'standard-cat-face', 'standard-potted-plant',
    'advanced-hot-air-balloon', 'advanced-little-house', 'advanced-rainbow-cloud', 'advanced-night-island'
]);
