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

import {
  ScreenId,
  DisplayBounds,
  SignalType,
  IntentSignal,
  FocusChangeEvent,
  FocusStateSnapshot,
  FocusConfig,
  FocusAlgorithmState,
  PresenterControl,
  PresenterControlAction,
  DEFAULT_FOCUS_CONFIG,
  BASE_CONFIDENCE,
  SIGNAL_PRIORITY,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Observability counters (§14)
// ─────────────────────────────────────────────

export interface FocusMetrics {
  focusChanges: number;
  cooldownBlocks: number;
  dwellResets: number;
  idleBlocks: number;
  signalCounts: Record<string, number>;
}

// ─────────────────────────────────────────────
// Focus Algorithm Engine
// ─────────────────────────────────────────────

export class FocusAlgorithm {
  private state: FocusAlgorithmState;
  private config: FocusConfig;
  private displays: Map<ScreenId, DisplayBounds>;
  private sessionId: string;
  private metrics: FocusMetrics;

  // Callbacks
  private onFocusChange: ((event: FocusChangeEvent) => void) | null = null;
  private onFocusState: ((snapshot: FocusStateSnapshot) => void) | null = null;

  constructor(
    sessionId: string,
    displays: DisplayBounds[],
    config: Partial<FocusConfig> = {},
  ) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_FOCUS_CONFIG, ...config };
    this.displays = new Map(displays.map((d) => [d.screenId, d]));

    this.state = {
      activeScreenId: displays.length > 0 ? displays[0].screenId : null,
      frozen: false,
      autoEnabled: true,
      manualOverride: null,
      lastSwitchTs: 0,
      candidateScreenId: null,
      candidateSinceTs: 0,
      lastActivityTs: 0,
      sequence: 0,
    };

    this.metrics = {
      focusChanges: 0,
      cooldownBlocks: 0,
      dwellResets: 0,
      idleBlocks: 0,
      signalCounts: {},
    };
  }

  // ─── Public API ──────────────────────────

  /** Register callback for focus change events */
  setOnFocusChange(cb: (event: FocusChangeEvent) => void): void {
    this.onFocusChange = cb;
  }

  /** Register callback for focus state snapshots */
  setOnFocusState(cb: (snapshot: FocusStateSnapshot) => void): void {
    this.onFocusState = cb;
  }

  /** Process an incoming intent signal. Core entry point. */
  processSignal(signal: IntentSignal): void {
    const now = signal.timestampMs;

    // Track metrics
    this.metrics.signalCounts[signal.type] =
      (this.metrics.signalCounts[signal.type] || 0) + 1;

    // Update activity timestamp for non-movement signals
    if (this.isActivitySignal(signal.type)) {
      this.state.lastActivityTs = now;
    }

    // §11: Precedence — frozen blocks all auto switching
    if (this.state.frozen) {
      return;
    }

    // §11: Auto-focus OFF — no auto focus changes
    if (!this.state.autoEnabled) {
      return;
    }

    // §11: Manual override always wins
    if (this.state.manualOverride !== null) {
      if (this.state.activeScreenId !== this.state.manualOverride) {
        this.setActive(this.state.manualOverride, SignalType.Manual, 1.0, now);
      }
      return;
    }

    // §6: Attribute signal to screen
    const candidateScreen = this.attributeToScreen(signal);
    if (candidateScreen === null) {
      return;
    }

    // §7: Compute confidence
    let confidence = this.computeConfidence(signal, candidateScreen, now);

    // §10: Idle detection
    if (this.isIdle(now)) {
      this.metrics.idleBlocks++;
      return;
    }

    // §8.2: Cooldown penalty
    if (
      now - this.state.lastSwitchTs <= this.config.cooldownMs &&
      signal.type !== SignalType.Manual
    ) {
      confidence -= 0.15;
      if (confidence < 0) confidence = 0;
      this.metrics.cooldownBlocks++;
    }

    // §9: If candidate changed, reset dwell timer
    if (candidateScreen !== this.state.candidateScreenId) {
      this.state.candidateScreenId = candidateScreen;
      this.state.candidateSinceTs = now;
      this.metrics.dwellResets++;
    }

    // §8.1: Dwell threshold check
    const dwellNeeded = this.getDwellMs(signal.type);
    const dwellElapsed = now - this.state.candidateSinceTs;
    if (dwellElapsed < dwellNeeded) {
      return;
    }

    // §8.3: Hysteresis — switching vs staying
    if (candidateScreen !== this.state.activeScreenId) {
      // Switching: require high confidence
      if (confidence >= this.config.switchThreshold) {
        this.setActive(candidateScreen, signal.type, confidence, now);
      }
    } else {
      // Staying: allow state refresh at lower threshold
      if (confidence >= this.config.stayThreshold) {
        this.emitFocusStateRefresh(now);
      }
    }
  }

  /** Handle presenter control actions (§11) */
  handlePresenterControl(control: PresenterControl): void {
    const now = control.timestampMs;

    switch (control.action) {
      case PresenterControlAction.ToggleAutoFocus:
        this.state.autoEnabled = !this.state.autoEnabled;
        this.emitFocusStateRefresh(now);
        break;

      case PresenterControlAction.ToggleFreeze:
        this.state.frozen = !this.state.frozen;
        if (!this.state.frozen) {
          // §11: Resume with grace period — movement-only candidates ignored
          this.state.candidateSinceTs = now;
        }
        this.emitFocusStateRefresh(now);
        break;

      case PresenterControlAction.ManualSelect:
        if (control.screenId && this.displays.has(control.screenId)) {
          this.state.manualOverride = control.screenId;
          this.setActive(control.screenId, SignalType.Manual, 1.0, now);
        }
        break;

      case PresenterControlAction.ClearManual:
        this.state.manualOverride = null;
        this.emitFocusStateRefresh(now);
        break;
    }
  }

  /** Get current focus state snapshot (for late joiners) */
  getState(): FocusStateSnapshot {
    return {
      type: 'focus_state',
      activeScreenId: this.state.activeScreenId || 'screen_1',
      mode: this.state.manualOverride
        ? 'manual'
        : this.state.frozen
          ? 'frozen'
          : 'auto',
      frozen: this.state.frozen,
      sequence: this.state.sequence,
      timestampMs: Date.now(),
    };
  }

  /** Get observability metrics */
  getMetrics(): FocusMetrics {
    return { ...this.metrics };
  }

  /** Update display configuration */
  updateDisplays(displays: DisplayBounds[]): void {
    this.displays = new Map(displays.map((d) => [d.screenId, d]));
  }

  /** Get raw internal state (for debugging) */
  getInternalState(): Readonly<FocusAlgorithmState> {
    return { ...this.state };
  }

  // ─── Private: Signal Attribution (§6) ────

  /**
   * §6.1: Map signal to the display whose bounds contain the point.
   * §6.2: Window focus events use window display ID if available.
   */
  private attributeToScreen(signal: IntentSignal): ScreenId | null {
    // Direct screen ID provided (manual, window focus with known display)
    if (signal.screenId && this.displays.has(signal.screenId)) {
      return signal.screenId;
    }

    // Window focus attribution (§6.2)
    if (
      signal.type === SignalType.WindowFocus &&
      signal.windowDisplayId &&
      this.displays.has(signal.windowDisplayId)
    ) {
      return signal.windowDisplayId;
    }

    // Pointer-based attribution (§6.1)
    const { x, y } = signal;
    let bestMatch: ScreenId | null = null;
    let bestOverlap = -1;

    for (const [screenId, bounds] of this.displays) {
      if (
        x >= bounds.x &&
        x < bounds.x + bounds.width &&
        y >= bounds.y &&
        y < bounds.y + bounds.height
      ) {
        // Point is fully inside — immediate match
        return screenId;
      }

      // Boundary case: compute overlap proximity
      const dx = Math.max(bounds.x - x, 0, x - (bounds.x + bounds.width));
      const dy = Math.max(bounds.y - y, 0, y - (bounds.y + bounds.height));
      const dist = Math.sqrt(dx * dx + dy * dy);
      const proximity = 1 / (1 + dist);

      if (proximity > bestOverlap) {
        bestOverlap = proximity;
        bestMatch = screenId;
      }
    }

    return bestMatch;
  }

  // ─── Private: Confidence Model (§7) ──────

  private computeConfidence(
    signal: IntentSignal,
    candidateScreen: ScreenId,
    now: number,
  ): number {
    let conf = BASE_CONFIDENCE[signal.type] ?? 0.40;

    // §7.2: +0.05 if focused window display matches candidate
    if (signal.windowDisplayId === candidateScreen) {
      conf += 0.05;
    }

    // §7.2: +0.05 if signal repeated consistently within short window
    if (
      this.state.candidateScreenId === candidateScreen &&
      now - this.state.candidateSinceTs < 1000
    ) {
      conf += 0.05;
    }

    // §7.2: -0.10 if only movement and speed is high (likely transit)
    if (
      signal.type === SignalType.PointerMove &&
      signal.speedPxPerS !== undefined &&
      signal.speedPxPerS > this.config.movementSpeedHighPxPerS
    ) {
      conf -= 0.10;
    }

    // §7.2: -0.15 if candidate differs from active and within cooldown
    if (
      candidateScreen !== this.state.activeScreenId &&
      now - this.state.lastSwitchTs <= this.config.cooldownMs
    ) {
      conf -= 0.15;
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, conf));
  }

  // ─── Private: Dwell Thresholds (§8.1) ────

  private getDwellMs(signalType: SignalType): number {
    switch (signalType) {
      case SignalType.Manual:
        return 0; // Manual is immediate
      case SignalType.Click:
      case SignalType.DoubleClick:
      case SignalType.DragStart:
        return this.config.clickDwellMs;
      case SignalType.Typing:
      case SignalType.WindowFocus:
        return this.config.typingDwellMs;
      case SignalType.Scroll:
      case SignalType.Gesture:
        return this.config.scrollDwellMs;
      case SignalType.Hover:
        return this.config.hoverDwellMs;
      case SignalType.PointerMove:
        return this.config.movementDwellMs;
      default:
        return this.config.movementDwellMs;
    }
  }

  // ─── Private: Idle Detection (§10) ───────

  private isIdle(now: number): boolean {
    // No activity for idle_ms
    return now - this.state.lastActivityTs > this.config.idleMs;
  }

  /** Activity signals: anything that isn't just pointer movement */
  private isActivitySignal(type: SignalType): boolean {
    return type !== SignalType.PointerMove && type !== SignalType.Hover;
  }

  // ─── Private: State Transitions ──────────

  private setActive(
    screenId: ScreenId,
    reason: SignalType,
    confidence: number,
    now: number,
  ): void {
    this.state.sequence++;
    const dwellMs = now - this.state.candidateSinceTs;

    this.state.activeScreenId = screenId;
    this.state.lastSwitchTs = now;
    this.metrics.focusChanges++;

    const event: FocusChangeEvent = {
      type: 'focus_change',
      sessionId: this.sessionId,
      screenId,
      reason,
      confidence: Math.round(confidence * 100) / 100,
      dwellMs,
      sequence: this.state.sequence,
      timestampMs: now,
    };

    this.onFocusChange?.(event);
  }

  private emitFocusStateRefresh(now: number): void {
    const snapshot = this.getState();
    this.onFocusState?.(snapshot);
  }
}

// ─────────────────────────────────────────────
// Conflict Resolution Utility (§9)
// ─────────────────────────────────────────────

/**
 * When multiple signals occur close together, resolve which should win.
 * 1. Highest priority (lowest SIGNAL_PRIORITY number)
 * 2. Highest confidence
 * 3. Most recent
 */
export function resolveConflict(signals: IntentSignal[]): IntentSignal | null {
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];

  return signals.sort((a, b) => {
    // 1. Priority (lower number = higher priority)
    const priA = SIGNAL_PRIORITY[a.type] ?? 99;
    const priB = SIGNAL_PRIORITY[b.type] ?? 99;
    if (priA !== priB) return priA - priB;

    // 2. Confidence (higher = better) — use base confidence as proxy
    const confA = BASE_CONFIDENCE[a.type] ?? 0;
    const confB = BASE_CONFIDENCE[b.type] ?? 0;
    if (confA !== confB) return confB - confA;

    // 3. Most recent
    return b.timestampMs - a.timestampMs;
  })[0];
}
