export const NUMBERED_BEAD_BOARD_HEIGHT = 16;
export const NUMBERED_BEAD_BOARD_WIDTH = 16;
export const NUMBERED_BEAD_CELL_COUNT = NUMBERED_BEAD_BOARD_HEIGHT * NUMBERED_BEAD_BOARD_WIDTH;
export const MAXIMUM_PATTERN_COLOR_COUNT = 9;
export const MAXIMUM_NUMBERED_BEAD_BOARD_SIZE = 36;
export const NO_TARGET_COLOR_NUMBER = 0;
export const UNFILLED_COLOR_NUMBER = 0;

export interface NumberedBeadPaletteEntry
{
    readonly colorId: string;
    readonly number: number;
}

export interface NumberedBeadPattern
{
    readonly height: number;
    readonly name: string;
    readonly palette: readonly NumberedBeadPaletteEntry[];
    readonly patternId: string;
    readonly targetNumbers: readonly number[];
    readonly width: number;
}

export interface NumberedBeadBoardReadModel
{
    readonly cells: readonly number[];
    readonly correctCellCount: number;
    readonly errorCellCount: number;
    readonly height: number;
    readonly isCompleted: boolean;
    readonly patternId: string;
    readonly progressRatio: number;
    readonly remainingCellCounts: readonly number[];
    readonly revision: number;
    readonly targetCellCount: number;
    readonly unfilledCellCount: number;
    readonly width: number;
}

export type NumberedBeadFillOutcome = 'filled' | 'overwritten' | 'unchanged';

export type NumberedBeadFillResult =
    | {
        readonly accepted: false;
        readonly code: 'board-completed' | 'invalid-color-number' | 'out-of-bounds';
    }
    | {
        readonly accepted: true;
        readonly colorNumber: number;
        readonly completionTriggered: boolean;
        readonly isCorrect: boolean;
        readonly outcome: NumberedBeadFillOutcome;
        readonly previousColorNumber: number;
        readonly requiredColorNumber: number;
        readonly revision: number;
        readonly x: number;
        readonly y: number;
    };

/** Owns deterministic variable-size numbered-coloring rules without engine dependencies. */
export class NumberedBeadBoard
{
    private readonly cells: number[];
    private readonly pattern: NumberedBeadPattern;
    private readonly remainingCellCounts: number[];
    private readonly targetCellCount: number;
    private correctCellCount = 0;
    private errorCellCount = 0;
    private revision = 0;

    public constructor(pattern: NumberedBeadPattern, initialCells?: readonly number[])
    {
        validatePattern(pattern);
        this.pattern = clonePattern(pattern);
        this.targetCellCount = countTargetCells(this.pattern);
        this.cells = initialCells === undefined
            ? createUnfilledCells(this.pattern.width * this.pattern.height)
            : validateAndCloneCells(
                initialCells,
                this.pattern.palette.length,
                this.pattern.width * this.pattern.height
            );
        this.remainingCellCounts = Array.from<number>({
            length: this.pattern.palette.length
        }).fill(0);
        this.recalculateProgress();
    }

    /** Fills one cell or directly overwrites its previous color. */
    public fillCell(x: number, y: number, colorNumber: number): NumberedBeadFillResult
    {
        if (!isBoardCoordinate(x, y, this.pattern.width, this.pattern.height))
        {
            return { accepted: false, code: 'out-of-bounds' };
        }

        if (!isColorNumber(colorNumber, this.pattern.palette.length))
        {
            return { accepted: false, code: 'invalid-color-number' };
        }

        const cellIndex = y * this.pattern.width + x;
        const previousColorNumber = this.cells[cellIndex];
        const requiredColorNumber = this.pattern.targetNumbers[cellIndex];

        if (requiredColorNumber !== NO_TARGET_COLOR_NUMBER && this.isCompleted())
        {
            return { accepted: false, code: 'board-completed' };
        }

        if (previousColorNumber === colorNumber)
        {
            return {
                accepted: true,
                colorNumber,
                completionTriggered: false,
                isCorrect: colorNumber === requiredColorNumber,
                outcome: 'unchanged',
                previousColorNumber,
                requiredColorNumber,
                revision: this.revision,
                x,
                y
            };
        }

        this.removeProgressContribution(previousColorNumber, requiredColorNumber);
        this.cells[cellIndex] = colorNumber;
        this.addProgressContribution(colorNumber, requiredColorNumber);
        this.revision += 1;
        const completionTriggered = this.isCompleted();

        return {
            accepted: true,
            colorNumber,
            completionTriggered,
            isCorrect: colorNumber === requiredColorNumber,
            outcome: previousColorNumber === UNFILLED_COLOR_NUMBER ? 'filled' : 'overwritten',
            previousColorNumber,
            requiredColorNumber,
            revision: this.revision,
            x,
            y
        };
    }

    /** Returns an immutable snapshot suitable for presentation and local persistence. */
    public getReadModel(): NumberedBeadBoardReadModel
    {
        return Object.freeze({
            cells: Object.freeze([...this.cells]),
            correctCellCount: this.correctCellCount,
            errorCellCount: this.errorCellCount,
            height: this.pattern.height,
            isCompleted: this.isCompleted(),
            patternId: this.pattern.patternId,
            progressRatio: this.correctCellCount / this.targetCellCount,
            remainingCellCounts: Object.freeze([...this.remainingCellCounts]),
            revision: this.revision,
            targetCellCount: this.targetCellCount,
            unfilledCellCount: this.targetCellCount
                - this.correctCellCount
                - this.errorCellCount,
            width: this.pattern.width
        });
    }

    private addProgressContribution(colorNumber: number, requiredColorNumber: number): void
    {
        if (requiredColorNumber === NO_TARGET_COLOR_NUMBER)
        {
            return;
        }

        if (colorNumber === requiredColorNumber)
        {
            this.correctCellCount += 1;
            this.remainingCellCounts[requiredColorNumber - 1] -= 1;
        }
        else
        {
            this.errorCellCount += 1;
        }
    }

    private isCompleted(): boolean
    {
        return this.correctCellCount === this.targetCellCount;
    }

    private recalculateProgress(): void
    {
        this.correctCellCount = 0;
        this.errorCellCount = 0;
        this.remainingCellCounts.fill(0);

        for (const targetNumber of this.pattern.targetNumbers)
        {
            if (targetNumber !== NO_TARGET_COLOR_NUMBER)
            {
                this.remainingCellCounts[targetNumber - 1] += 1;
            }
        }

        for (let cellIndex = 0; cellIndex < this.cells.length; cellIndex += 1)
        {
            const colorNumber = this.cells[cellIndex];

            if (colorNumber !== UNFILLED_COLOR_NUMBER)
            {
                this.addProgressContribution(colorNumber, this.pattern.targetNumbers[cellIndex]);
            }
        }
    }

    private removeProgressContribution(colorNumber: number, requiredColorNumber: number): void
    {
        if (colorNumber === UNFILLED_COLOR_NUMBER
            || requiredColorNumber === NO_TARGET_COLOR_NUMBER)
        {
            return;
        }

        if (colorNumber === requiredColorNumber)
        {
            this.correctCellCount -= 1;
            this.remainingCellCounts[requiredColorNumber - 1] += 1;
        }
        else
        {
            this.errorCellCount -= 1;
        }
    }
}

function clonePattern(pattern: NumberedBeadPattern): NumberedBeadPattern
{
    return Object.freeze({
        height: pattern.height,
        name: pattern.name,
        palette: Object.freeze(pattern.palette.map((entry) => Object.freeze({ ...entry }))),
        patternId: pattern.patternId,
        targetNumbers: Object.freeze([...pattern.targetNumbers]),
        width: pattern.width
    });
}

function createUnfilledCells(cellCount: number): number[]
{
    return Array.from<number>({ length: cellCount }).fill(UNFILLED_COLOR_NUMBER);
}

function isBoardCoordinate(x: number, y: number, width: number, height: number): boolean
{
    return Number.isInteger(x)
        && Number.isInteger(y)
        && x >= 0
        && x < width
        && y >= 0
        && y < height;
}

function isColorNumber(value: number, paletteLength: number): boolean
{
    return Number.isInteger(value) && value >= 1 && value <= paletteLength;
}

function validateAndCloneCells(
    cells: readonly number[],
    paletteLength: number,
    cellCount: number
): number[]
{
    if (cells.length !== cellCount)
    {
        throw new RangeError('Numbered bead board restore data does not match its pattern size.');
    }

    const clonedCells = [...cells];

    for (const colorNumber of clonedCells)
    {
        if (colorNumber !== UNFILLED_COLOR_NUMBER && !isColorNumber(colorNumber, paletteLength))
        {
            throw new RangeError('Numbered bead board restore data contains an invalid color number.');
        }
    }

    return clonedCells;
}

function validatePattern(pattern: NumberedBeadPattern): void
{
    if (pattern.patternId.trim().length === 0 || pattern.name.trim().length === 0)
    {
        throw new RangeError('Numbered bead pattern requires a visible identifier and name.');
    }

    if (pattern.palette.length < 1 || pattern.palette.length > MAXIMUM_PATTERN_COLOR_COUNT)
    {
        throw new RangeError('Numbered bead pattern palette must contain between 1 and 9 colors.');
    }

    for (let paletteIndex = 0; paletteIndex < pattern.palette.length; paletteIndex += 1)
    {
        const entry = pattern.palette[paletteIndex];

        if (entry.number !== paletteIndex + 1 || entry.colorId.trim().length === 0)
        {
            throw new RangeError('Numbered bead pattern palette numbers must be continuous from 1.');
        }
    }

    if (!Number.isInteger(pattern.width)
        || !Number.isInteger(pattern.height)
        || pattern.width < 1
        || pattern.height < 1
        || pattern.width > MAXIMUM_NUMBERED_BEAD_BOARD_SIZE
        || pattern.height > MAXIMUM_NUMBERED_BEAD_BOARD_SIZE
        || pattern.targetNumbers.length !== pattern.width * pattern.height)
    {
        throw new RangeError('Numbered bead pattern dimensions or target cell count are invalid.');
    }

    const usedColorNumbers = Array.from<boolean>({ length: pattern.palette.length }).fill(false);

    for (const targetNumber of pattern.targetNumbers)
    {
        if (targetNumber !== NO_TARGET_COLOR_NUMBER
            && !isColorNumber(targetNumber, pattern.palette.length))
        {
            throw new RangeError('Numbered bead pattern contains a target outside its palette.');
        }

        if (targetNumber !== NO_TARGET_COLOR_NUMBER)
        {
            usedColorNumbers[targetNumber - 1] = true;
        }
    }

    let foundUnusedColorNumber = false;

    for (const isUsed of usedColorNumbers)
    {
        if (!isUsed)
        {
            foundUnusedColorNumber = true;
        }
        else if (foundUnusedColorNumber)
        {
            throw new RangeError(
                'Numbered bead pattern used color numbers must be continuous from 1.'
            );
        }
    }

    if (!usedColorNumbers.some((isUsed) => isUsed))
    {
        throw new RangeError('Numbered bead pattern must contain at least one target cell.');
    }
}

function countTargetCells(pattern: NumberedBeadPattern): number
{
    let count = 0;

    for (const targetNumber of pattern.targetNumbers)
    {
        if (targetNumber !== NO_TARGET_COLOR_NUMBER)
        {
            count += 1;
        }
    }

    return count;
}
