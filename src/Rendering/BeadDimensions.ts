export interface BeadDimensions
{
    readonly format: 'mini';
    readonly diameterMm: number;
    readonly heightMm: number;
    readonly holeDiameterMm: number;
    readonly pitchMm: number;
    readonly fusedHeightMm: number;
    readonly boardSizeMm: number;
    readonly boardThicknessMm: number;
    readonly pegHeightMm: number;
    readonly pegDiameterMm: number;
    readonly gridSize: number;
}

/** One Mini kit for every pattern. Published outside dimensions; bore and pitch are estimates. */
export const BEAD_DIMENSIONS: Readonly<BeadDimensions> = Object.freeze({
    format: 'mini',
    diameterMm: 2.61,
    heightMm: 2.8,
    holeDiameterMm: 1,
    pitchMm: 2.7,
    fusedHeightMm: 2,
    boardSizeMm: 145,
    boardThicknessMm: 2.5,
    pegHeightMm: 1.8,
    pegDiameterMm: 0.7,
    gridSize: 52
});

// Art direction scale: a 145 mm board spans 23% of the 3.8-unit workbench.
// This changes the craft's world size, never the size of an individual bead per pattern.
export const MILLIMETRES_TO_WORLD = 0.006;
export const METRES_TO_WORLD = MILLIMETRES_TO_WORLD * 1000;
export const BEAD_PITCH = BEAD_DIMENSIONS.pitchMm * MILLIMETRES_TO_WORLD;
export const BEAD_HEIGHT = BEAD_DIMENSIONS.heightMm * MILLIMETRES_TO_WORLD;
export const BOARD_SIZE = BEAD_DIMENSIONS.boardSizeMm * MILLIMETRES_TO_WORLD;
export const BOARD_THICKNESS = BEAD_DIMENSIONS.boardThicknessMm * MILLIMETRES_TO_WORLD;
export const BOARD_SURFACE_Y = 1.14 + BOARD_THICKNESS;
export const BEAD_TOP_Y = BOARD_SURFACE_Y + BEAD_HEIGHT;
export const PEG_HEIGHT = BEAD_DIMENSIONS.pegHeightMm * MILLIMETRES_TO_WORLD;

/** Center every pattern on actual pegs of the common 52-column board. */
export function patternGridOffset(size: number, gridSize = BEAD_DIMENSIONS.gridSize): number
{
    return Math.floor((gridSize - size) / 2) - (gridSize - 1) / 2;
}
