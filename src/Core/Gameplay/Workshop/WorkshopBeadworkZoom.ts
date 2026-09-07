const WHEEL_NOTCH_DELTA = 120;
const ZOOM_PER_NOTCH = 0.05;
const EXIT_NOTCH_THRESHOLD = 1;
const ZOOM_SETTLED_EPSILON = 0.001;
const ZOOM_RESPONSE_PER_SECOND = 6;
const FULL_BOARD_EXIT_IDLE_SECONDS = 0.12;
const PAN_SPEED_BOARD_EXTENTS_PER_SECOND = 1.25;
const PAN_MAXIMUM_BOARD_EXTENT_RATIO = 0.82;

/** Continuous beadwork camera position between the full board and maximum close-up. */
export interface WorkshopBeadworkZoomState
{
    readonly currentZoom: number;
    readonly targetZoom: number;
    readonly exitWheelProgress: number;
    readonly fullBoardIdleSeconds: number;
}

/** Result of one normalized mouse-wheel or touchpad input sample. */
export interface WorkshopBeadworkWheelResult
{
    readonly state: WorkshopBeadworkZoomState;
    readonly exitRequested: boolean;
}

/** Screen-relative camera offset retained while inspecting a zoomed bead board. */
export interface WorkshopBeadworkPanState
{
    readonly horizontal: number;
    readonly vertical: number;
}

/** Retained beadwork pan state used by allocation-free presentation updates. */
export interface MutableWorkshopBeadworkPanState
{
    horizontal: number;
    vertical: number;
}

/** Maps character left/right input to camera translation so board content follows A/D. */
export function mapWorkshopBeadworkHorizontalPanInput(moveX: number): number
{
    if (!Number.isFinite(moveX))
    {
        throw new RangeError('Workshop beadwork horizontal movement input must be finite.');
    }

    return -moveX;
}

/** Creates a centered beadwork camera pan state. */
export function createWorkshopBeadworkPanState(): WorkshopBeadworkPanState
{
    return createPanState(0, 0);
}

/** Creates one mutable centered pan state for a presentation adapter to retain. */
export function createMutableWorkshopBeadworkPanState(): MutableWorkshopBeadworkPanState
{
    return { horizontal: 0, vertical: 0 };
}

/** Advances bounded screen-relative WASD camera movement over the visible board. */
export function advanceWorkshopBeadworkPan(
    state: WorkshopBeadworkPanState,
    horizontalInput: number,
    verticalInput: number,
    deltaTimeSeconds: number,
    zoom: number,
    boardHalfExtent: number
): WorkshopBeadworkPanState
{
    const output = createMutableWorkshopBeadworkPanState();
    advanceWorkshopBeadworkPanInto(
        state,
        horizontalInput,
        verticalInput,
        deltaTimeSeconds,
        zoom,
        boardHalfExtent,
        output
    );

    return Object.freeze(output);
}

/** Advances bounded pan into a retained mutable state without frame allocations. */
export function advanceWorkshopBeadworkPanInto(
    state: WorkshopBeadworkPanState,
    horizontalInput: number,
    verticalInput: number,
    deltaTimeSeconds: number,
    zoom: number,
    boardHalfExtent: number,
    output: MutableWorkshopBeadworkPanState
): void
{
    validatePanState(state);

    if (!Number.isFinite(horizontalInput)
        || !Number.isFinite(verticalInput)
        || !Number.isFinite(deltaTimeSeconds)
        || !Number.isFinite(zoom)
        || !Number.isFinite(boardHalfExtent)
        || deltaTimeSeconds < 0
        || zoom < 0
        || zoom > 1
        || boardHalfExtent <= 0)
    {
        throw new RangeError('Workshop beadwork camera pan input is invalid.');
    }

    const inputLength = Math.sqrt(
        horizontalInput * horizontalInput + verticalInput * verticalInput
    );
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const distance = boardHalfExtent
        * PAN_SPEED_BOARD_EXTENTS_PER_SECOND
        * deltaTimeSeconds;
    const maximumOffset = boardHalfExtent * PAN_MAXIMUM_BOARD_EXTENT_RATIO * zoom;

    output.horizontal = clamp(
        state.horizontal + horizontalInput * inputScale * distance,
        -maximumOffset,
        maximumOffset
    );
    output.vertical = clamp(
        state.vertical + verticalInput * inputScale * distance,
        -maximumOffset,
        maximumOffset
    );
}

/** Creates a validated zoom state, optionally at a stable initial zoom level. */
export function createWorkshopBeadworkZoomState(
    initialZoom = 0
): WorkshopBeadworkZoomState
{
    if (!Number.isFinite(initialZoom) || initialZoom < 0 || initialZoom > 1)
    {
        throw new RangeError('Workshop beadwork zoom must be between zero and one.');
    }

    return createState(
        initialZoom,
        initialZoom,
        0,
        initialZoom === 0 ? FULL_BOARD_EXIT_IDLE_SECONDS : 0
    );
}

/** Applies raw vertical wheel movement; positive values move closer to the board. */
export function applyWorkshopBeadworkWheel(
    state: WorkshopBeadworkZoomState,
    wheelDelta: number
): WorkshopBeadworkWheelResult
{
    validateState(state);

    if (!Number.isFinite(wheelDelta))
    {
        throw new RangeError('Workshop beadwork wheel input must be finite.');
    }

    const normalizedWheel = clamp(wheelDelta / WHEEL_NOTCH_DELTA, -5, 5);

    if (normalizedWheel === 0)
    {
        return createWheelResult(state, false);
    }

    if (normalizedWheel > 0)
    {
        return createWheelResult(createState(
            state.currentZoom,
            clamp01(state.targetZoom + normalizedWheel * ZOOM_PER_NOTCH),
            0,
            0
        ), false);
    }

    if (state.targetZoom > 0 || state.currentZoom > ZOOM_SETTLED_EPSILON)
    {
        return createWheelResult(createState(
            state.currentZoom,
            clamp01(state.targetZoom + normalizedWheel * ZOOM_PER_NOTCH),
            0,
            0
        ), false);
    }

    if (state.fullBoardIdleSeconds < FULL_BOARD_EXIT_IDLE_SECONDS)
    {
        return createWheelResult(createState(0, 0, 0, 0), false);
    }

    const exitWheelProgress = state.exitWheelProgress - normalizedWheel;
    const exitRequested = exitWheelProgress >= EXIT_NOTCH_THRESHOLD - Number.EPSILON;

    return createWheelResult(createState(
        0,
        0,
        exitRequested ? 0 : exitWheelProgress,
        state.fullBoardIdleSeconds
    ), exitRequested);
}

/** Advances the visual zoom with frame-rate-independent exponential smoothing. */
export function advanceWorkshopBeadworkZoom(
    state: WorkshopBeadworkZoomState,
    deltaTimeSeconds: number
): WorkshopBeadworkZoomState
{
    validateState(state);

    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0)
    {
        throw new RangeError('Workshop beadwork zoom time must be finite and non-negative.');
    }

    if (deltaTimeSeconds === 0)
    {
        return state;
    }

    if (state.currentZoom === 0 && state.targetZoom === 0)
    {
        return createState(
            0,
            0,
            state.exitWheelProgress,
            Math.min(
                state.fullBoardIdleSeconds + deltaTimeSeconds,
                FULL_BOARD_EXIT_IDLE_SECONDS
            )
        );
    }

    if (state.currentZoom === state.targetZoom)
    {
        return state;
    }

    const progress = 1 - Math.exp(-ZOOM_RESPONSE_PER_SECOND * deltaTimeSeconds);
    const nextZoom = state.currentZoom
        + (state.targetZoom - state.currentZoom) * progress;
    const currentZoom = Math.abs(nextZoom - state.targetZoom) <= ZOOM_SETTLED_EPSILON
        ? state.targetZoom
        : nextZoom;

    return createState(currentZoom, state.targetZoom, state.exitWheelProgress, 0);
}

function createWheelResult(
    state: WorkshopBeadworkZoomState,
    exitRequested: boolean
): WorkshopBeadworkWheelResult
{
    return Object.freeze({
        state,
        exitRequested
    });
}

function createState(
    currentZoom: number,
    targetZoom: number,
    exitWheelProgress: number,
    fullBoardIdleSeconds: number
): WorkshopBeadworkZoomState
{
    return Object.freeze({
        currentZoom: snapZoomBoundary(currentZoom),
        targetZoom: snapZoomBoundary(targetZoom),
        exitWheelProgress,
        fullBoardIdleSeconds
    });
}

function snapZoomBoundary(value: number): number
{
    if (value <= ZOOM_SETTLED_EPSILON)
    {
        return 0;
    }

    if (value >= 1 - ZOOM_SETTLED_EPSILON)
    {
        return 1;
    }

    return value;
}

function validateState(state: WorkshopBeadworkZoomState): void
{
    if (!Number.isFinite(state.currentZoom)
        || !Number.isFinite(state.targetZoom)
        || !Number.isFinite(state.exitWheelProgress)
        || !Number.isFinite(state.fullBoardIdleSeconds)
        || state.currentZoom < 0
        || state.currentZoom > 1
        || state.targetZoom < 0
        || state.targetZoom > 1
        || state.exitWheelProgress < 0
        || state.fullBoardIdleSeconds < 0)
    {
        throw new RangeError('Workshop beadwork zoom state is invalid.');
    }
}

function createPanState(horizontal: number, vertical: number): WorkshopBeadworkPanState
{
    return Object.freeze({ horizontal, vertical });
}

function validatePanState(state: WorkshopBeadworkPanState): void
{
    if (!Number.isFinite(state.horizontal) || !Number.isFinite(state.vertical))
    {
        throw new RangeError('Workshop beadwork camera pan state is invalid.');
    }
}

function clamp01(value: number): number
{
    return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number
{
    return Math.max(minimum, Math.min(maximum, value));
}
