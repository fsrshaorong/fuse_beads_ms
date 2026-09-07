import { NumberedBeadBoard } from './NumberedBeadBoard';
import type {
    NumberedBeadBoardReadModel,
    NumberedBeadPattern
} from './NumberedBeadBoard';

/** Presentation-ready board state with one persistent current color. */
export interface NumberedBeadPaintingReadModel extends NumberedBeadBoardReadModel
{
    readonly selectedColorNumber: number;
}

/** Result of changing the current painting color. */
export type NumberedBeadColorSelectionResult =
    | {
        readonly accepted: false;
        readonly code: 'invalid-color-number';
        readonly selectedColorNumber: number;
    }
    | {
        readonly accepted: true;
        readonly changed: boolean;
        readonly selectedColorNumber: number;
    };

/** Stable failure codes shared by click and drag painting input. */
export type NumberedBeadStrokeRejectCode =
    | 'board-completed'
    | 'invalid-color-number'
    | 'out-of-bounds'
    | 'stroke-not-active';

/** Aggregate result for one pointer sample after interpolation and deduplication. */
export type NumberedBeadStrokeResult =
    | {
        readonly accepted: false;
        readonly code: NumberedBeadStrokeRejectCode;
    }
    | {
        readonly accepted: true;
        readonly appliedCellCount: number;
        readonly completionTriggered: boolean;
        readonly revision: number;
    };

interface BoardCoordinate
{
    readonly x: number;
    readonly y: number;
}

interface ActivePaintingStroke
{
    lastCoordinate: BoardCoordinate | null;
    readonly visitedCellIndices: Set<number>;
}

/** Owns selected-color and pointer-stroke rules around one numbered bead board. */
export class NumberedBeadPaintingSession
{
    private readonly board: NumberedBeadBoard;
    private readonly height: number;
    private readonly paletteLength: number;
    private readonly width: number;
    private activeStroke: ActivePaintingStroke | null = null;
    private selectedColorNumber: number;

    public constructor(
        pattern: NumberedBeadPattern,
        initialCells?: readonly number[],
        initialColorNumber = 1
    )
    {
        this.paletteLength = pattern.palette.length;
        this.width = pattern.width;
        this.height = pattern.height;

        if (!this.isColorNumberValid(initialColorNumber))
        {
            throw new RangeError('Painting session requires a valid initial color number.');
        }

        this.board = new NumberedBeadBoard(pattern, initialCells);
        this.selectedColorNumber = initialColorNumber;
    }

    /** Keeps exactly one valid color selected; selecting it again never clears it. */
    public selectColor(colorNumber: number): NumberedBeadColorSelectionResult
    {
        if (!this.isColorNumberValid(colorNumber))
        {
            return {
                accepted: false,
                code: 'invalid-color-number',
                selectedColorNumber: this.selectedColorNumber
            };
        }

        const changed = colorNumber !== this.selectedColorNumber;
        this.selectedColorNumber = colorNumber;

        return {
            accepted: true,
            changed,
            selectedColorNumber: this.selectedColorNumber
        };
    }

    /** Starts a click or drag and paints its first cell immediately. */
    public beginStroke(x: number, y: number): NumberedBeadStrokeResult
    {
        const coordinate = { x, y };

        if (!isBoardCoordinate(coordinate, this.width, this.height))
        {
            return rejectStroke('out-of-bounds');
        }

        if (this.board.getReadModel().isCompleted)
        {
            return rejectStroke('board-completed');
        }

        this.activeStroke = {
            lastCoordinate: coordinate,
            visitedCellIndices: new Set<number>()
        };

        return this.paintCoordinates([coordinate]);
    }

    /** Interpolates every grid cell between pointer samples and paints each once per stroke. */
    public continueStroke(x: number, y: number): NumberedBeadStrokeResult
    {
        const activeStroke = this.activeStroke;

        if (activeStroke === null)
        {
            return rejectStroke('stroke-not-active');
        }

        const coordinate = { x, y };

        if (!isBoardCoordinate(coordinate, this.width, this.height))
        {
            return rejectStroke('out-of-bounds');
        }

        if (this.board.getReadModel().isCompleted)
        {
            return rejectStroke('board-completed');
        }

        const coordinates = activeStroke.lastCoordinate === null
            ? [coordinate]
            : rasterizeGridLine(activeStroke.lastCoordinate, coordinate);
        activeStroke.lastCoordinate = coordinate;

        return this.paintCoordinates(coordinates);
    }

    /** Breaks interpolation across an out-of-board gap without ending the held stroke. */
    public pauseStroke(): boolean
    {
        if (this.activeStroke === null)
        {
            return false;
        }

        this.activeStroke.lastCoordinate = null;

        return true;
    }

    /** Ends the current pointer stroke without changing any board cells. */
    public endStroke(): boolean
    {
        if (this.activeStroke === null)
        {
            return false;
        }

        this.activeStroke = null;

        return true;
    }

    /** Reports the held-stroke gate without exposing mutable pointer state. */
    public isStrokeActive(): boolean
    {
        return this.activeStroke !== null;
    }

    /** Returns one immutable snapshot for UI, persistence and completion feedback. */
    public getReadModel(): NumberedBeadPaintingReadModel
    {
        return Object.freeze({
            ...this.board.getReadModel(),
            selectedColorNumber: this.selectedColorNumber
        });
    }

    private isColorNumberValid(colorNumber: number): boolean
    {
        return Number.isInteger(colorNumber)
            && colorNumber >= 1
            && colorNumber <= this.paletteLength;
    }

    private paintCoordinates(
        coordinates: readonly BoardCoordinate[]
    ): NumberedBeadStrokeResult
    {
        const activeStroke = this.activeStroke;

        if (activeStroke === null)
        {
            return rejectStroke('stroke-not-active');
        }

        let appliedCellCount = 0;
        let completionTriggered = false;

        for (const coordinate of coordinates)
        {
            const cellIndex = coordinate.y * this.width + coordinate.x;

            if (activeStroke.visitedCellIndices.has(cellIndex))
            {
                continue;
            }

            activeStroke.visitedCellIndices.add(cellIndex);
            const fillResult = this.board.fillCell(
                coordinate.x,
                coordinate.y,
                this.selectedColorNumber
            );

            if (fillResult.accepted === false)
            {
                return rejectStroke(fillResult.code);
            }

            if (fillResult.outcome !== 'unchanged')
            {
                appliedCellCount += 1;
            }

            completionTriggered = fillResult.completionTriggered;

            if (completionTriggered)
            {
                break;
            }
        }

        return {
            accepted: true,
            appliedCellCount,
            completionTriggered,
            revision: this.board.getReadModel().revision
        };
    }
}

function isBoardCoordinate(coordinate: BoardCoordinate, width: number, height: number): boolean
{
    return Number.isInteger(coordinate.x)
        && Number.isInteger(coordinate.y)
        && coordinate.x >= 0
        && coordinate.x < width
        && coordinate.y >= 0
        && coordinate.y < height;
}

function rasterizeGridLine(
    start: BoardCoordinate,
    end: BoardCoordinate
): readonly BoardCoordinate[]
{
    let x = start.x;
    let y = start.y;
    const distanceX = Math.abs(end.x - start.x);
    const stepX = start.x < end.x ? 1 : -1;
    const distanceY = -Math.abs(end.y - start.y);
    const stepY = start.y < end.y ? 1 : -1;
    let error = distanceX + distanceY;
    const coordinates: BoardCoordinate[] = [];

    while (true)
    {
        coordinates.push({ x, y });

        if (x === end.x && y === end.y)
        {
            break;
        }

        const doubledError = 2 * error;

        if (doubledError >= distanceY)
        {
            error += distanceY;
            x += stepX;
        }

        if (doubledError <= distanceX)
        {
            error += distanceX;
            y += stepY;
        }
    }

    return coordinates;
}

function rejectStroke(code: NumberedBeadStrokeRejectCode): NumberedBeadStrokeResult
{
    return {
        accepted: false,
        code
    };
}
