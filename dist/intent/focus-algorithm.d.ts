/**
 * @file    intent/focus-algorithm.ts
 * @purpose Deterministic presenter-intent inference engine for multi-screen focus.
 *          Implements the state machine from Focus_Algorithm.md exactly.
 * @owner   FOCUS Core Team
 * @depends shared/types/focus.ts
 *
 * Key invariants (from spec):
 *   - Never thrash between screens due to micro-movement
 *   - Never switch on raw pointer movement alone unless sustained
 *   - Manual and freeze always win
 *   - Every focus change is explainable via reason + confidence + dwell
 */
import { DisplayBounds, IntentSignal, FocusChangeEvent, FocusStateSnapshot, FocusConfig, FocusAlgorithmState, PresenterControl } from '../shared/types/focus';
export interface FocusMetrics {
    focusChanges: number;
    cooldownBlocks: number;
    dwellResets: number;
    idleBlocks: number;
    signalCounts: Record<string, number>;
}
export declare class FocusAlgorithm {
    private state;
    private config;
    private displays;
    private sessionId;
    private metrics;
    private onFocusChange;
    private onFocusState;
    constructor(sessionId: string, displays: DisplayBounds[], config?: Partial<FocusConfig>);
    /** Register callback for focus change events */
    setOnFocusChange(cb: (event: FocusChangeEvent) => void): void;
    /** Register callback for focus state snapshots */
    setOnFocusState(cb: (snapshot: FocusStateSnapshot) => void): void;
    /** Process an incoming intent signal. Core entry point. */
    processSignal(signal: IntentSignal): void;
    /** Handle presenter control actions (§11) */
    handlePresenterControl(control: PresenterControl): void;
    /** Get current focus state snapshot (for late joiners) */
    getState(): FocusStateSnapshot;
    /** Get observability metrics */
    getMetrics(): FocusMetrics;
    /** Update display configuration */
    updateDisplays(displays: DisplayBounds[]): void;
    /** Get raw internal state (for debugging) */
    getInternalState(): Readonly<FocusAlgorithmState>;
    /**
     * §6.1: Map signal to the display whose bounds contain the point.
     * §6.2: Window focus events use window display ID if available.
     */
    private attributeToScreen;
    private computeConfidence;
    private getDwellMs;
    private isIdle;
    /** Activity signals: anything that isn't just pointer movement */
    private isActivitySignal;
    private setActive;
    private emitFocusStateRefresh;
}
/**
 * When multiple signals occur close together, resolve which should win.
 * 1. Highest priority (lowest SIGNAL_PRIORITY number)
 * 2. Highest confidence
 * 3. Most recent
 */
export declare function resolveConflict(signals: IntentSignal[]): IntentSignal | null;
//# sourceMappingURL=focus-algorithm.d.ts.map