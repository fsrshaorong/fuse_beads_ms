/** The three stable player activity modes inside the Workshop. */
export type WorkshopActivityMode = 'workshop' | 'tabletop' | 'beadwork';

/** Orthogonal UI overlays that never replace the underlying Workshop activity. */
export type WorkshopOverlayKind = 'none' | 'chat' | 'pause';

/** The only camera/activity transitions allowed by the first playable version. */
export type WorkshopTransitionKind =
    | 'sit'
    | 'focus-board'
    | 'unfocus-board'
    | 'stand';

/** Declarative Application effect performed around one transition phase. */
export type WorkshopTransitionSideEffect =
    | 'none'
    | 'claim-seat'
    | 'release-seat'
    | 'reset-beadwork-zoom';

/** Shared metadata consumed by Application without executing session side effects. */
export interface IWorkshopTransitionMetadata
{
    readonly beginSideEffect: WorkshopTransitionSideEffect;
    readonly completeSideEffect: WorkshopTransitionSideEffect;
    readonly from: WorkshopActivityMode;
    readonly kind: WorkshopTransitionKind;
    readonly requiresOccupiedSeat: boolean;
    readonly to: WorkshopActivityMode;
}

/** Player and system intents that compete for control of Workshop input. */
export type WorkshopInputIntent =
    | 'character-move'
    | 'camera-orbit'
    | 'seat-interact'
    | 'stand'
    | 'tabletop-pointer'
    | 'enter-beadwork'
    | 'exit-beadwork'
    | 'beadwork-zoom'
    | 'beadwork-pointer'
    | 'color-shortcut'
    | 'open-chat'
    | 'open-pause'
    | 'cancel-beadwork'
    | 'window-blur'
    | 'leave-room';

/** The single input owner selected after applying the activity priority rules. */
export type WorkshopInputConsumer =
    | WorkshopActivityMode
    | Exclude<WorkshopOverlayKind, 'none'>
    | 'system';

/** A settled interaction state with no camera transition in progress. */
export interface WorkshopStableInteractionState
{
    readonly mode: WorkshopActivityMode;
    readonly overlay: WorkshopOverlayKind;
}

/** Immutable description of one active camera/activity transition. */
export interface WorkshopTransition
{
    readonly kind: WorkshopTransitionKind;
    readonly from: WorkshopActivityMode;
    readonly to: WorkshopActivityMode;
}

/** The transient state that exclusively owns ordinary player input. */
export interface WorkshopTransitionInteractionState
{
    readonly mode: 'transition';
    readonly overlay: WorkshopOverlayKind;
    readonly transition: WorkshopTransition;
}

/** Immutable Workshop activity state used by rules, input and presentation adapters. */
export type WorkshopInteractionState =
    | WorkshopStableInteractionState
    | WorkshopTransitionInteractionState;

/** Stable reasons why a requested state transition was rejected. */
export type WorkshopTransitionRejectCode =
    | 'transition-in-progress'
    | 'transition-not-allowed'
    | 'not-transitioning';

/** Accepted next state or a stable rejection that preserves the current state. */
export type WorkshopTransitionResult =
    | {
        readonly accepted: true;
        readonly state: WorkshopInteractionState;
    }
    | {
        readonly accepted: false;
        readonly code: WorkshopTransitionRejectCode;
        readonly state: WorkshopInteractionState;
    };

/** Routing decision for one intent after applying input priority. */
export interface WorkshopInputRoute
{
    readonly accepted: boolean;
    readonly consumer: WorkshopInputConsumer | null;
}

/** Higher-priority owners that suppress a local color shortcut. */
export interface WorkshopInputOwnership
{
    readonly isModalOpen?: boolean;
    readonly isPaused?: boolean;
    readonly isPointerActive?: boolean;
    readonly isTextEntryFocused?: boolean;
}

const TRANSITION_METADATA: Readonly<
    Record<WorkshopTransitionKind, IWorkshopTransitionMetadata>
> = Object.freeze({
    sit: Object.freeze({
        beginSideEffect: 'claim-seat',
        completeSideEffect: 'none',
        from: 'workshop',
        kind: 'sit',
        requiresOccupiedSeat: false,
        to: 'tabletop'
    }),
    'focus-board': Object.freeze({
        beginSideEffect: 'reset-beadwork-zoom',
        completeSideEffect: 'none',
        from: 'tabletop',
        kind: 'focus-board',
        requiresOccupiedSeat: true,
        to: 'beadwork'
    }),
    'unfocus-board': Object.freeze({
        beginSideEffect: 'none',
        completeSideEffect: 'none',
        from: 'beadwork',
        kind: 'unfocus-board',
        requiresOccupiedSeat: true,
        to: 'tabletop'
    }),
    stand: Object.freeze({
        beginSideEffect: 'none',
        completeSideEffect: 'release-seat',
        from: 'tabletop',
        kind: 'stand',
        requiresOccupiedSeat: true,
        to: 'workshop'
    })
});

const INPUTS_BY_MODE: Readonly<Record<WorkshopActivityMode, ReadonlySet<WorkshopInputIntent>>> = {
    workshop: new Set<WorkshopInputIntent>([
        'character-move',
        'camera-orbit',
        'seat-interact',
        'open-chat',
        'open-pause'
    ]),
    tabletop: new Set<WorkshopInputIntent>([
        'stand',
        'tabletop-pointer',
        'enter-beadwork',
        'open-chat',
        'open-pause'
    ]),
    beadwork: new Set<WorkshopInputIntent>([
        'exit-beadwork',
        'beadwork-zoom',
        'beadwork-pointer',
        'color-shortcut',
        'open-chat',
        'cancel-beadwork'
    ])
};

const SYSTEM_INPUTS = new Set<WorkshopInputIntent>([
    'window-blur',
    'leave-room'
]);
const EMPTY_WORKSHOP_INPUT_OWNERSHIP: WorkshopInputOwnership = Object.freeze({});
const OVERLAY_INPUTS: Readonly<Record<
    Exclude<WorkshopOverlayKind, 'none'>,
    WorkshopInputIntent
>> = {
    chat: 'open-chat',
    pause: 'open-pause'
};

/**
 * Gives a final-cell completion exclusive ownership of later inputs in the same frame.
 * The presentation owner releases the gate only after color and zoom queues are consumed.
 */
export class WorkshopCompletionInputGate
{
    private completionOwnsFrame = false;

    /** Claims the rest of the current input frame for a completed board. */
    public claimCompletion(): void
    {
        this.completionOwnsFrame = true;
    }

    /** Reports whether queued lower-priority input must be consumed without applying it. */
    public isCompletionOwner(): boolean
    {
        return this.completionOwnsFrame;
    }

    /** Releases completion ownership after every input source has observed the frame. */
    public releaseFrame(): void
    {
        this.completionOwnsFrame = false;
    }
}

/** Creates the only valid initial state when a player enters the Workshop. */
export function createWorkshopInteractionState(): WorkshopInteractionState
{
    return {
        mode: 'workshop',
        overlay: 'none'
    };
}

/** Opens or replaces one overlay without changing the underlying activity or transition. */
export function openOverlay(
    state: WorkshopInteractionState,
    kind: Exclude<WorkshopOverlayKind, 'none'>
): WorkshopInteractionState
{
    if (state.overlay === kind)
    {
        return state;
    }

    return {
        ...state,
        overlay: kind
    };
}

/** Closes the current overlay without changing the underlying activity or transition. */
export function closeOverlay(
    state: WorkshopInteractionState
): WorkshopInteractionState
{
    if (state.overlay === 'none')
    {
        return state;
    }

    return {
        ...state,
        overlay: 'none'
    };
}

/** Returns immutable metadata for one legal Workshop transition kind. */
export function getWorkshopTransitionMetadata(
    kind: WorkshopTransitionKind
): IWorkshopTransitionMetadata
{
    return TRANSITION_METADATA[kind];
}

/**
 * Starts one allowed transition without mutating the current state.
 * Rejected requests return the original state so callers cannot partially advance.
 */
export function tryBeginWorkshopTransition(
    state: WorkshopInteractionState,
    kind: WorkshopTransitionKind
): WorkshopTransitionResult
{
    if (state.mode === 'transition')
    {
        return rejectTransition(state, 'transition-in-progress');
    }

    const definition = getWorkshopTransitionMetadata(kind);

    if (state.mode !== definition.from)
    {
        return rejectTransition(state, 'transition-not-allowed');
    }

    return {
        accepted: true,
        state: {
            mode: 'transition',
            overlay: state.overlay,
            transition: {
                kind,
                from: definition.from,
                to: definition.to
            }
        }
    };
}

/** Completes the active transition at its declared target mode. */
export function completeWorkshopTransition(
    state: WorkshopInteractionState
): WorkshopTransitionResult
{
    if (state.mode !== 'transition')
    {
        return rejectTransition(state, 'not-transitioning');
    }

    return {
        accepted: true,
        state: {
            mode: state.transition.to,
            overlay: state.overlay
        }
    };
}

/**
 * Settles an interrupted short camera transition at its target.
 * This prevents reconnect or lifecycle recovery from replaying half an animation.
 */
export function settleInterruptedWorkshopTransition(
    state: WorkshopInteractionState
): WorkshopInteractionState
{
    if (state.mode !== 'transition')
    {
        return state;
    }

    return {
        mode: state.transition.to,
        overlay: state.overlay
    };
}

/**
 * Routes one intent to exactly one activity owner, or ignores it.
 * System lifecycle intents remain available in every mode, including transitions.
 */
export function routeWorkshopInput(
    state: WorkshopInteractionState,
    intent: WorkshopInputIntent,
    ownership: WorkshopInputOwnership = EMPTY_WORKSHOP_INPUT_OWNERSHIP
): WorkshopInputRoute
{
    const consumer = getWorkshopInputConsumer(state, intent, ownership);

    return {
        accepted: consumer !== null,
        consumer
    };
}

/** Checks one input owner without allocating a route result on pointer hot paths. */
export function isWorkshopInputAccepted(
    state: WorkshopInteractionState,
    intent: WorkshopInputIntent,
    ownership: WorkshopInputOwnership = EMPTY_WORKSHOP_INPUT_OWNERSHIP
): boolean
{
    return getWorkshopInputConsumer(state, intent, ownership) !== null;
}

/** Resolves one input owner without allocating a route result. */
export function getWorkshopInputConsumer(
    state: WorkshopInteractionState,
    intent: WorkshopInputIntent,
    ownership: WorkshopInputOwnership = EMPTY_WORKSHOP_INPUT_OWNERSHIP
): WorkshopInputConsumer | null
{
    if (SYSTEM_INPUTS.has(intent))
    {
        return 'system';
    }

    if (state.overlay !== 'none')
    {
        return OVERLAY_INPUTS[state.overlay] === intent ? state.overlay : null;
    }

    if (state.mode === 'transition'
        || !INPUTS_BY_MODE[state.mode].has(intent)
        || (intent === 'color-shortcut' && isColorShortcutOwned(ownership)))
    {
        return null;
    }

    return state.mode;
}

function isColorShortcutOwned(ownership: WorkshopInputOwnership): boolean
{
    return ownership.isModalOpen === true
        || ownership.isPaused === true
        || ownership.isPointerActive === true
        || ownership.isTextEntryFocused === true;
}

function rejectTransition(
    state: WorkshopInteractionState,
    code: WorkshopTransitionRejectCode
): WorkshopTransitionResult
{
    return {
        accepted: false,
        code,
        state
    };
}
