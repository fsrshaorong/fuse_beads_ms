import {
    NUMBERED_BEAD_BOARD_HEIGHT,
    NUMBERED_BEAD_BOARD_WIDTH
} from './NumberedBeadBoard';
import type {
    NumberedBeadPaletteEntry,
    NumberedBeadPattern
} from './NumberedBeadBoard';

const EXPECTED_STARTER_PATTERN_COUNT = 12;
const EXPECTED_PATTERNS_PER_DIFFICULTY = 4;

/** Stable player-facing difficulty groups used by the starter catalog. */
export type StarterPatternDifficulty = 'beginner' | 'standard' | 'advanced';

/** Exact completed-color thumbnail values independent of Cocos textures. */
export interface StarterPatternThumbnail
{
    readonly colorNumbers: readonly number[];
    readonly height: number;
    readonly width: number;
}

/** One unlocked starter catalog entry and its complete numbered-board content. */
export interface StarterPatternCatalogEntry extends NumberedBeadPattern
{
    readonly colorCount: number;
    readonly difficulty: StarterPatternDifficulty;
    readonly difficultyDescription: string;
    readonly estimatedMinutes: number;
    readonly height: number;
    readonly isAvailable: boolean;
    readonly thumbnail: StarterPatternThumbnail;
    readonly width: number;
}

/** Stable machine-readable starter-content validation failures. */
export type StarterPatternValidationCode =
    | 'catalog-size'
    | 'duplicate-pattern-id'
    | 'duplicate-pattern-name'
    | 'invalid-cell-count'
    | 'invalid-color-count'
    | 'invalid-difficulty-distribution'
    | 'invalid-dimensions'
    | 'invalid-metadata'
    | 'invalid-palette'
    | 'invalid-target-number'
    | 'missing-thumbnail'
    | 'pattern-not-available'
    | 'thumbnail-mismatch';

/** One precise content problem suitable for startup diagnostics. */
export interface StarterPatternValidationIssue
{
    readonly code: StarterPatternValidationCode;
    readonly message: string;
    readonly patternId: string;
}

/** Complete result returned by the starter catalog content boundary. */
export type StarterPatternValidationResult =
    | {
        readonly accepted: true;
        readonly issues: readonly StarterPatternValidationIssue[];
    }
    | {
        readonly accepted: false;
        readonly issues: readonly StarterPatternValidationIssue[];
    };

interface StarterPatternDefinition
{
    readonly colorIds: readonly string[];
    readonly difficulty: StarterPatternDifficulty;
    readonly difficultyDescription: string;
    readonly estimatedMinutes: number;
    readonly name: string;
    readonly patternId: string;
    readonly rows: readonly string[];
}

const HEART_ROWS: readonly string[] = [
    '1111111111111111',
    '1111111111111111',
    '1113332112222111',
    '1123322222222211',
    '1222222222222221',
    '1222222222222221',
    '1222222222222221',
    '1122222222222211',
    '1112222222222111',
    '1111222222221111',
    '1111122222211111',
    '1111112222111111',
    '1111111221111111',
    '1111111111111111',
    '1111111111111111',
    '1111111111111111'
];

const STAR_ROWS: readonly string[] = [
    '1111111211111111',
    '1111112221111111',
    '1111112221113111',
    '1111122222111111',
    '1222222222222211',
    '1122222222222111',
    '1112222222221111',
    '1111222222211111',
    '1111222222211111',
    '1112222112221111',
    '1112211111221111',
    '1122111111122111',
    '1221111111112211',
    '1111113111111111',
    '1111111111111111',
    '1111111111111111'
];

const MUSHROOM_ROWS: readonly string[] = [
    '1111111111111111',
    '1111111111111111',
    '1111112222111111',
    '1111222222221111',
    '1112223223222111',
    '1122222222222211',
    '1222322222232221',
    '1222222222222221',
    '1111224444221111',
    '1111114444111111',
    '1111114444111111',
    '1111114444111111',
    '1111114444111111',
    '1111144444411111',
    '1111144444411111',
    '1111111111111111'
];

const SMILE_ROWS: readonly string[] = [
    '1111111111111111',
    '1111122222211111',
    '1112222222222111',
    '1122222222222211',
    '1222222222222221',
    '1222322222322221',
    '1222322222322221',
    '1222222222222221',
    '1224222222224221',
    '1224222222224221',
    '1222233333322221',
    '1222223333222221',
    '1122222222222211',
    '1112222222222111',
    '1111122222211111',
    '1111111111111111'
];

const STRAWBERRY_ROWS: readonly string[] = [
    '1111112222111111',
    '1111122222211111',
    '1111222622221111',
    '1111266666621111',
    '1112633333362111',
    '1126334533336211',
    '1126333353336211',
    '1263335333533621',
    '1263343335333621',
    '1263333533333621',
    '1263353333533621',
    '1126333333336211',
    '1112633333362111',
    '1111263333621111',
    '1111126666211111',
    '1111111661111111'
];

const DUCK_ROWS: readonly string[] = [
    '1111111111111111',
    '1111111111111111',
    '1111113331111111',
    '1111133333111111',
    '1111333533311111',
    '1111333333361111',
    '4444333333331111',
    '1444333333333111',
    '1111333353333111',
    '1111133333331111',
    '1111133333344111',
    '1111144111441111',
    '1222222222222221',
    '2222222222222222',
    '1222212222122221',
    '1111111111111111'
];

const CAT_ROWS: readonly string[] = [
    '1111221111221111',
    '1112232113221111',
    '1112442444421111',
    '1124222222242111',
    '1242226222224211',
    '1422252225222411',
    '1422252225222411',
    '1422222332222411',
    '1422262222622411',
    '1422222222222411',
    '1242227772224211',
    '1124222222242111',
    '1112444444421111',
    '1111122222111111',
    '1111111111111111',
    '1111111111111111'
];

const POTTED_PLANT_ROWS: readonly string[] = [
    '1111115511111111',
    '1111155551111111',
    '1111115511111111',
    '1111133311111111',
    '1111333333111111',
    '1113334333311111',
    '1133343334331111',
    '1113333333311111',
    '1111133331111111',
    '1111113311111111',
    '1111166666111111',
    '1111622222611111',
    '1116222222261111',
    '1116222222261111',
    '1111666666611111',
    '1111111111111111'
];

const HOT_AIR_BALLOON_ROWS: readonly string[] = [
    '1111113311111111',
    '1111333333111111',
    '1111122222111111',
    '1111144444111111',
    '1114455555441111',
    '1145566666554411',
    '1456677777665541',
    '1456788888765541',
    '1456789998765541',
    '1145677777654411',
    '1114555555541111',
    '1111144444111111',
    '1111118811111111',
    '1111118811111111',
    '1111155555111111',
    '1111155555111111'
];

const LITTLE_HOUSE_ROWS: readonly string[] = [
    '1111111111111111',
    '1111118811111111',
    '1111188881111111',
    '1111884488111111',
    '1118844448811111',
    '1184444444488111',
    '1888888888888811',
    '1833333333333811',
    '1833663333663811',
    '1833663333663811',
    '1833333553333811',
    '1833333553333811',
    '1888888888888811',
    '2222277777222222',
    '2222777777722222',
    '2222222222222222'
];

const RAINBOW_CLOUD_ROWS: readonly string[] = [
    '1111222222221111',
    '1122333333322111',
    '1223444444432211',
    '1234555555543211',
    '1345666666654311',
    '1456777777765411',
    '1567111111176511',
    '1671111111117611',
    '1711111111111711',
    '1111111111111111',
    '1111188888111111',
    '1118888888888111',
    '1188889889888811',
    '1188899999888811',
    '1118888888888111',
    '1111188888111111'
];

const NIGHT_ISLAND_ROWS: readonly string[] = [
    '1111111331111111',
    '1112213333122141',
    '1122213333122211',
    '1142211331122211',
    '1112221111222111',
    '1111111999111111',
    '1111199999991111',
    '1119999999999111',
    '1111111881111111',
    '1111111881111111',
    '5555555665555555',
    '5555666666655555',
    '5556677777665555',
    '5555555555555555',
    '5566555555665555',
    '5555555555555555'
];

/** First complete pattern retained as the default until selection is wired. */
export const STARTER_HEART_PATTERN: StarterPatternCatalogEntry = createPattern({
    colorIds: ['cream', 'red', 'pink'],
    difficulty: 'beginner',
    difficultyDescription: '入门 · 大色块与清晰轮廓',
    estimatedMinutes: 5,
    name: '爱心',
    patternId: 'starter-heart',
    rows: HEART_ROWS
});

/** Stable, fully unlocked launch catalog in player-facing design order. */
export const STARTER_PATTERN_CATALOG: readonly StarterPatternCatalogEntry[] =
    Object.freeze([
        STARTER_HEART_PATTERN,
        createPattern({
            colorIds: ['blue', 'yellow', 'cream'],
            difficulty: 'beginner',
            difficultyDescription: '入门 · 对称轮廓与少量点缀',
            estimatedMinutes: 5,
            name: '五角星',
            patternId: 'starter-star',
            rows: STAR_ROWS
        }),
        createPattern({
            colorIds: ['cream', 'red', 'pink', 'orange'],
            difficulty: 'beginner',
            difficultyDescription: '入门 · 连续帽面与宽柄',
            estimatedMinutes: 6,
            name: '小蘑菇',
            patternId: 'starter-mushroom',
            rows: MUSHROOM_ROWS
        }),
        createPattern({
            colorIds: ['cyan', 'yellow', 'purple', 'pink'],
            difficulty: 'beginner',
            difficultyDescription: '入门 · 大面积圆形与表情细节',
            estimatedMinutes: 6,
            name: '笑脸',
            patternId: 'starter-smile',
            rows: SMILE_ROWS
        }),
        createPattern({
            colorIds: ['cream', 'green', 'red', 'pink', 'yellow', 'purple'],
            difficulty: 'standard',
            difficultyDescription: '普通 · 叶片轮廓、果实和分散籽点',
            estimatedMinutes: 8,
            name: '草莓',
            patternId: 'standard-strawberry',
            rows: STRAWBERRY_ROWS
        }),
        createPattern({
            colorIds: ['cyan', 'blue', 'yellow', 'orange', 'cream', 'pink'],
            difficulty: 'standard',
            difficultyDescription: '普通 · 水面、身体和脸部层次',
            estimatedMinutes: 9,
            name: '小鸭',
            patternId: 'standard-duck',
            rows: DUCK_ROWS
        }),
        createPattern({
            colorIds: ['cream', 'orange', 'pink', 'purple', 'green', 'yellow', 'blue'],
            difficulty: 'standard',
            difficultyDescription: '普通 · 对称脸型与七色局部细节',
            estimatedMinutes: 10,
            name: '猫脸',
            patternId: 'standard-cat-face',
            rows: CAT_ROWS
        }),
        createPattern({
            colorIds: ['cream', 'orange', 'green', 'yellow', 'pink', 'blue'],
            difficulty: 'standard',
            difficultyDescription: '普通 · 花叶、枝干和花盆分层',
            estimatedMinutes: 9,
            name: '盆栽',
            patternId: 'standard-potted-plant',
            rows: POTTED_PLANT_ROWS
        }),
        createPattern({
            colorIds: [
                'cyan', 'blue', 'cream', 'red', 'orange',
                'yellow', 'green', 'purple', 'pink'
            ],
            difficulty: 'advanced',
            difficultyDescription: '进阶 · 九色弧面、云朵和吊篮细节',
            estimatedMinutes: 13,
            name: '热气球',
            patternId: 'advanced-hot-air-balloon',
            rows: HOT_AIR_BALLOON_ROWS
        }),
        createPattern({
            colorIds: ['cyan', 'green', 'cream', 'red', 'orange', 'yellow', 'blue', 'purple'],
            difficulty: 'advanced',
            difficultyDescription: '进阶 · 八色屋顶、门窗与地面变化',
            estimatedMinutes: 12,
            name: '小房子',
            patternId: 'advanced-little-house',
            rows: LITTLE_HOUSE_ROWS
        }),
        createPattern({
            colorIds: [
                'blue', 'red', 'orange', 'yellow', 'green',
                'cyan', 'purple', 'cream', 'pink'
            ],
            difficulty: 'advanced',
            difficultyDescription: '进阶 · 九色连续彩带与云层阴影',
            estimatedMinutes: 14,
            name: '彩虹云',
            patternId: 'advanced-rainbow-cloud',
            rows: RAINBOW_CLOUD_ROWS
        }),
        createPattern({
            colorIds: [
                'blue', 'purple', 'cream', 'yellow', 'cyan',
                'green', 'orange', 'red', 'pink'
            ],
            difficulty: 'advanced',
            difficultyDescription: '进阶 · 夜空渐变、树冠与水面细节',
            estimatedMinutes: 15,
            name: '夜空小岛',
            patternId: 'advanced-night-island',
            rows: NIGHT_ISLAND_ROWS
        })
    ]);

/** Resolves one immutable starter entry without changing catalog order. */
export function findStarterPattern(patternId: string): StarterPatternCatalogEntry | null
{
    for (const pattern of STARTER_PATTERN_CATALOG)
    {
        if (pattern.patternId === patternId)
        {
            return pattern;
        }
    }

    return null;
}

/** Validates untrusted or bundled catalog content and identifies every bad entry. */
export function validateStarterPatternCatalog(
    value: unknown
): StarterPatternValidationResult
{
    const issues: StarterPatternValidationIssue[] = [];

    if (!Array.isArray(value))
    {
        issues.push(createIssue(
            'catalog-size',
            'catalog',
            'Starter pattern catalog must be an array of exactly 12 entries.'
        ));

        return rejectValidation(issues);
    }

    if (value.length !== EXPECTED_STARTER_PATTERN_COUNT)
    {
        issues.push(createIssue(
            'catalog-size',
            'catalog',
            `Starter pattern catalog has ${value.length.toString()} entries; expected 12.`
        ));
    }

    const patternIds = new Set<string>();
    const names = new Set<string>();
    const difficultyCounts: Record<StarterPatternDifficulty, number> = {
        advanced: 0,
        beginner: 0,
        standard: 0
    };

    const inspectedEntryCount = Math.min(
        value.length,
        EXPECTED_STARTER_PATTERN_COUNT
    );

    for (let index = 0; index < inspectedEntryCount; index += 1)
    {
        validateCatalogEntry(
            value[index],
            index,
            patternIds,
            names,
            difficultyCounts,
            issues
        );
    }

    if (difficultyCounts.beginner !== EXPECTED_PATTERNS_PER_DIFFICULTY
        || difficultyCounts.standard !== EXPECTED_PATTERNS_PER_DIFFICULTY
        || difficultyCounts.advanced !== EXPECTED_PATTERNS_PER_DIFFICULTY)
    {
        issues.push(createIssue(
            'invalid-difficulty-distribution',
            'catalog',
            'Starter catalog must contain exactly four beginner, standard, and advanced entries.'
        ));
    }

    return issues.length === 0
        ? Object.freeze({ accepted: true, issues: Object.freeze([]) })
        : rejectValidation(issues);
}

function createPattern(definition: StarterPatternDefinition): StarterPatternCatalogEntry
{
    const targetNumbers = Object.freeze(parseRows(definition.patternId, definition.rows));
    const palette = createPalette(definition.colorIds);

    return Object.freeze({
        colorCount: palette.length,
        difficulty: definition.difficulty,
        difficultyDescription: definition.difficultyDescription,
        estimatedMinutes: definition.estimatedMinutes,
        height: NUMBERED_BEAD_BOARD_HEIGHT,
        isAvailable: true,
        name: definition.name,
        palette,
        patternId: definition.patternId,
        targetNumbers,
        thumbnail: Object.freeze({
            colorNumbers: Object.freeze([...targetNumbers]),
            height: NUMBERED_BEAD_BOARD_HEIGHT,
            width: NUMBERED_BEAD_BOARD_WIDTH
        }),
        width: NUMBERED_BEAD_BOARD_WIDTH
    });
}

function createPalette(colorIds: readonly string[]): readonly NumberedBeadPaletteEntry[]
{
    return Object.freeze(colorIds.map((colorId, index) => Object.freeze({
        colorId,
        number: index + 1
    })));
}

function parseRows(patternId: string, rows: readonly string[]): number[]
{
    if (rows.length !== NUMBERED_BEAD_BOARD_HEIGHT)
    {
        throw new RangeError(`Starter pattern '${patternId}' must contain exactly 16 rows.`);
    }

    const targetNumbers: number[] = [];

    for (const row of rows)
    {
        if (!/^[1-9]{16}$/.test(row))
        {
            throw new RangeError(
                `Starter pattern '${patternId}' rows must contain exactly 16 color numbers.`
            );
        }

        for (const character of row)
        {
            targetNumbers.push(Number(character));
        }
    }

    return targetNumbers;
}

function validateCatalogEntry(
    value: unknown,
    index: number,
    patternIds: Set<string>,
    names: Set<string>,
    difficultyCounts: Record<StarterPatternDifficulty, number>,
    issues: StarterPatternValidationIssue[]
): void
{
    if (!isUnknownRecord(value))
    {
        issues.push(createIssue(
            'invalid-metadata',
            `catalog-index-${index.toString()}`,
            `Starter pattern at index ${index.toString()} is not an object.`
        ));

        return;
    }

    const visiblePatternId = readVisibleString(value.patternId);
    const patternId = visiblePatternId ?? `catalog-index-${index.toString()}`;
    const name = readVisibleString(value.name);

    if (visiblePatternId === null)
    {
        issues.push(createIssue(
            'invalid-metadata',
            patternId,
            `Starter pattern at index ${index.toString()} requires a visible ID.`
        ));
    }

    const entryDescription = name === null
        ? `catalog index ${index.toString()}`
        : `catalog index ${index.toString()} ('${name}')`;
    validateUniqueValue(
        patternId,
        patternIds,
        'duplicate-pattern-id',
        patternId,
        entryDescription,
        issues
    );

    if (name === null)
    {
        issues.push(createIssue(
            'invalid-metadata',
            patternId,
            `Starter pattern '${patternId}' requires a visible name.`
        ));
    }
    else
    {
        validateUniqueValue(
            name,
            names,
            'duplicate-pattern-name',
            patternId,
            entryDescription,
            issues
        );
    }

    const difficulty = isStarterDifficulty(value.difficulty)
        ? value.difficulty
        : null;

    if (difficulty === null)
    {
        issues.push(createIssue(
            'invalid-metadata',
            patternId,
            `Starter pattern '${patternId}' has an invalid difficulty.`
        ));
    }
    else
    {
        difficultyCounts[difficulty] += 1;
    }

    if (value.width !== NUMBERED_BEAD_BOARD_WIDTH
        || value.height !== NUMBERED_BEAD_BOARD_HEIGHT)
    {
        issues.push(createIssue(
            'invalid-dimensions',
            patternId,
            `Starter pattern '${patternId}' must declare a 16x16 board.`
        ));
    }

    if (value.isAvailable !== true)
    {
        issues.push(createIssue(
            'pattern-not-available',
            patternId,
            `Starter pattern '${patternId}' must be directly available.`
        ));
    }

    validateDescriptionAndDuration(value, patternId, issues);
    const paletteLength = validatePalette(value.palette, patternId, issues);
    const targetNumbers = validateTargetNumbers(
        value.targetNumbers,
        paletteLength,
        patternId,
        issues
    );
    validateColorCount(
        value.colorCount,
        difficulty,
        paletteLength,
        targetNumbers,
        patternId,
        issues
    );
    validateThumbnail(value.thumbnail, targetNumbers, patternId, issues);
}

function validateDescriptionAndDuration(
    value: Readonly<Record<string, unknown>>,
    patternId: string,
    issues: StarterPatternValidationIssue[]
): void
{
    const description = readVisibleString(value.difficultyDescription);
    const estimatedMinutes = value.estimatedMinutes;

    if (description === null
        || !Number.isInteger(estimatedMinutes)
        || typeof estimatedMinutes !== 'number'
        || estimatedMinutes < 5
        || estimatedMinutes > 15)
    {
        issues.push(createIssue(
            'invalid-metadata',
            patternId,
            `Starter pattern '${patternId}' requires a description and 5-15 minute estimate.`
        ));
    }
}

function validatePalette(
    value: unknown,
    patternId: string,
    issues: StarterPatternValidationIssue[]
): number
{
    if (!Array.isArray(value) || value.length < 1 || value.length > 9)
    {
        issues.push(createIssue(
            'invalid-palette',
            patternId,
            `Starter pattern '${patternId}' palette must contain 1-9 entries.`
        ));

        return 0;
    }

    const colorIds = new Set<string>();
    let isValid = true;

    for (let index = 0; index < value.length; index += 1)
    {
        const entry = value[index];

        if (!isUnknownRecord(entry)
            || entry.number !== index + 1
            || readVisibleString(entry.colorId) === null)
        {
            isValid = false;

            continue;
        }

        const colorId = readVisibleString(entry.colorId);

        if (colorId === null || colorIds.has(colorId))
        {
            isValid = false;
        }
        else
        {
            colorIds.add(colorId);
        }
    }

    if (!isValid)
    {
        issues.push(createIssue(
            'invalid-palette',
            patternId,
            `Starter pattern '${patternId}' palette numbers and color IDs must be unique.`
        ));
    }

    return value.length;
}

function validateTargetNumbers(
    value: unknown,
    paletteLength: number,
    patternId: string,
    issues: StarterPatternValidationIssue[]
): readonly number[] | null
{
    if (!Array.isArray(value)
        || value.length !== NUMBERED_BEAD_BOARD_WIDTH * NUMBERED_BEAD_BOARD_HEIGHT)
    {
        issues.push(createIssue(
            'invalid-cell-count',
            patternId,
            `Starter pattern '${patternId}' must contain exactly 256 target cells.`
        ));

        return null;
    }

    for (let index = 0; index < value.length; index += 1)
    {
        const targetNumber = value[index];

        if (!Number.isInteger(targetNumber)
            || typeof targetNumber !== 'number'
            || targetNumber < 1
            || targetNumber > 9
            || targetNumber > paletteLength)
        {
            issues.push(createIssue(
                'invalid-target-number',
                patternId,
                `Starter pattern '${patternId}' has invalid target ${String(targetNumber)} at cell ${index.toString()}.`
            ));

            return null;
        }
    }

    return value;
}

function validateColorCount(
    value: unknown,
    difficulty: StarterPatternDifficulty | null,
    paletteLength: number,
    targetNumbers: readonly number[] | null,
    patternId: string,
    issues: StarterPatternValidationIssue[]
): void
{
    const colorCount = typeof value === 'number' && Number.isInteger(value)
        ? value
        : 0;
    const actualColorCount = targetNumbers === null
        ? 0
        : new Set(targetNumbers).size;
    const range = difficulty === null ? null : getDifficultyColorRange(difficulty);

    if (colorCount !== paletteLength
        || colorCount !== actualColorCount
        || range === null
        || colorCount < range.minimum
        || colorCount > range.maximum)
    {
        issues.push(createIssue(
            'invalid-color-count',
            patternId,
            `Starter pattern '${patternId}' declares ${colorCount.toString()} colors but uses ${actualColorCount.toString()}.`
        ));
    }
}

function validateThumbnail(
    value: unknown,
    targetNumbers: readonly number[] | null,
    patternId: string,
    issues: StarterPatternValidationIssue[]
): void
{
    if (!isUnknownRecord(value) || !Array.isArray(value.colorNumbers))
    {
        issues.push(createIssue(
            'missing-thumbnail',
            patternId,
            `Starter pattern '${patternId}' is missing its completed-color thumbnail.`
        ));

        return;
    }

    const colorNumbers = value.colorNumbers;
    let matchesTarget = targetNumbers !== null
        && colorNumbers.length === targetNumbers.length;

    if (matchesTarget && targetNumbers !== null)
    {
        for (let index = 0; index < targetNumbers.length; index += 1)
        {
            if (colorNumbers[index] !== targetNumbers[index])
            {
                matchesTarget = false;

                break;
            }
        }
    }

    if (value.width !== NUMBERED_BEAD_BOARD_WIDTH
        || value.height !== NUMBERED_BEAD_BOARD_HEIGHT
        || !matchesTarget)
    {
        issues.push(createIssue(
            'thumbnail-mismatch',
            patternId,
            `Starter pattern '${patternId}' thumbnail must exactly match its 16x16 target.`
        ));
    }
}

function getDifficultyColorRange(
    difficulty: StarterPatternDifficulty
): { readonly maximum: number; readonly minimum: number }
{
    if (difficulty === 'beginner')
    {
        return { maximum: 4, minimum: 1 };
    }

    if (difficulty === 'standard')
    {
        return { maximum: 7, minimum: 5 };
    }

    return { maximum: 9, minimum: 8 };
}

function validateUniqueValue(
    value: string,
    values: Set<string>,
    code: 'duplicate-pattern-id' | 'duplicate-pattern-name',
    patternId: string,
    entryDescription: string,
    issues: StarterPatternValidationIssue[]
): void
{
    if (values.has(value))
    {
        issues.push(createIssue(
            code,
            patternId,
            code === 'duplicate-pattern-id'
                ? `Starter ${entryDescription} repeats pattern ID '${value}'.`
                : `Starter ${entryDescription} repeats pattern name '${value}'.`
        ));

        return;
    }

    values.add(value);
}

function createIssue(
    code: StarterPatternValidationCode,
    patternId: string,
    message: string
): StarterPatternValidationIssue
{
    return Object.freeze({ code, message, patternId });
}

function rejectValidation(
    issues: readonly StarterPatternValidationIssue[]
): StarterPatternValidationResult
{
    return Object.freeze({
        accepted: false,
        issues: Object.freeze([...issues])
    });
}

function isStarterDifficulty(value: unknown): value is StarterPatternDifficulty
{
    return value === 'beginner' || value === 'standard' || value === 'advanced';
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>>
{
    return typeof value === 'object' && value !== null;
}

function readVisibleString(value: unknown): string | null
{
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : null;
}
