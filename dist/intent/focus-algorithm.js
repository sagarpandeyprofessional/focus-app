"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FocusAlgorithm = void 0;
exports.resolveConflict = resolveConflict;
const focus_1 = require("../shared/types/focus");
// ─────────────────────────────────────────────
// Focus Algorithm Engine
// ─────────────────────────────────────────────
class FocusAlgorithm {
    state;
    config;
    displays;
    sessionId;
    metrics;
    // Callbacks
    onFocusChange = null;
    onFocusState = null;
    constructor(sessionId, displays, config = {}) {
        this.sessionId = sessionId;
        this.config = { ...focus_1.DEFAULT_FOCUS_CONFIG, ...config };
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
    setOnFocusChange(cb) {
        this.onFocusChange = cb;
    }
    /** Register callback for focus state snapshots */
    setOnFocusState(cb) {
        this.onFocusState = cb;
    }
    /** Process an incoming intent signal. Core entry point. */
    processSignal(signal) {
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
                this.setActive(this.state.manualOverride, focus_1.SignalType.Manual, 1.0, now);
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
        if (now - this.state.lastSwitchTs < this.config.cooldownMs &&
            signal.type !== focus_1.SignalType.Manual) {
            confidence -= 0.15;
            if (confidence < 0)
                confidence = 0;
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
        }
        else {
            // Staying: allow state refresh at lower threshold
            if (confidence >= this.config.stayThreshold) {
                this.emitFocusStateRefresh(now);
            }
        }
    }
    /** Handle presenter control actions (§11) */
    handlePresenterControl(control) {
        const now = control.timestampMs;
        switch (control.action) {
            case focus_1.PresenterControlAction.ToggleAutoFocus:
                this.state.autoEnabled = !this.state.autoEnabled;
                this.emitFocusStateRefresh(now);
                break;
            case focus_1.PresenterControlAction.ToggleFreeze:
                this.state.frozen = !this.state.frozen;
                if (!this.state.frozen) {
                    // §11: Resume with grace period — movement-only candidates ignored
                    this.state.candidateSinceTs = now;
                }
                this.emitFocusStateRefresh(now);
                break;
            case focus_1.PresenterControlAction.ManualSelect:
                if (control.screenId && this.displays.has(control.screenId)) {
                    this.state.manualOverride = control.screenId;
                    this.setActive(control.screenId, focus_1.SignalType.Manual, 1.0, now);
                }
                break;
            case focus_1.PresenterControlAction.ClearManual:
                this.state.manualOverride = null;
                this.emitFocusStateRefresh(now);
                break;
        }
    }
    /** Get current focus state snapshot (for late joiners) */
    getState() {
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
    getMetrics() {
        return { ...this.metrics };
    }
    /** Update display configuration */
    updateDisplays(displays) {
        this.displays = new Map(displays.map((d) => [d.screenId, d]));
    }
    /** Get raw internal state (for debugging) */
    getInternalState() {
        return { ...this.state };
    }
    // ─── Private: Signal Attribution (§6) ────
    /**
     * §6.1: Map signal to the display whose bounds contain the point.
     * §6.2: Window focus events use window display ID if available.
     */
    attributeToScreen(signal) {
        // Direct screen ID provided (manual, window focus with known display)
        if (signal.screenId && this.displays.has(signal.screenId)) {
            return signal.screenId;
        }
        // Window focus attribution (§6.2)
        if (signal.type === focus_1.SignalType.WindowFocus &&
            signal.windowDisplayId &&
            this.displays.has(signal.windowDisplayId)) {
            return signal.windowDisplayId;
        }
        // Pointer-based attribution (§6.1)
        const { x, y } = signal;
        let bestMatch = null;
        let bestOverlap = -1;
        for (const [screenId, bounds] of this.displays) {
            if (x >= bounds.x &&
                x < bounds.x + bounds.width &&
                y >= bounds.y &&
                y < bounds.y + bounds.height) {
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
    computeConfidence(signal, candidateScreen, now) {
        let conf = focus_1.BASE_CONFIDENCE[signal.type] ?? 0.40;
        // §7.2: +0.05 if focused window display matches candidate
        if (signal.windowDisplayId === candidateScreen) {
            conf += 0.05;
        }
        // §7.2: +0.05 if signal repeated consistently within short window
        if (this.state.candidateScreenId === candidateScreen &&
            now - this.state.candidateSinceTs < 1000) {
            conf += 0.05;
        }
        // §7.2: -0.10 if only movement and speed is high (likely transit)
        if (signal.type === focus_1.SignalType.PointerMove &&
            signal.speedPxPerS !== undefined &&
            signal.speedPxPerS > this.config.movementSpeedHighPxPerS) {
            conf -= 0.10;
        }
        // §7.2: -0.15 if candidate differs from active and within cooldown
        if (candidateScreen !== this.state.activeScreenId &&
            now - this.state.lastSwitchTs < this.config.cooldownMs) {
            conf -= 0.15;
        }
        // Clamp to [0, 1]
        return Math.max(0, Math.min(1, conf));
    }
    // ─── Private: Dwell Thresholds (§8.1) ────
    getDwellMs(signalType) {
        switch (signalType) {
            case focus_1.SignalType.Manual:
                return 0; // Manual is immediate
            case focus_1.SignalType.Click:
            case focus_1.SignalType.DoubleClick:
            case focus_1.SignalType.DragStart:
                return this.config.clickDwellMs;
            case focus_1.SignalType.Typing:
            case focus_1.SignalType.WindowFocus:
                return this.config.typingDwellMs;
            case focus_1.SignalType.Scroll:
            case focus_1.SignalType.Gesture:
                return this.config.scrollDwellMs;
            case focus_1.SignalType.Hover:
                return this.config.hoverDwellMs;
            case focus_1.SignalType.PointerMove:
                return this.config.movementDwellMs;
            default:
                return this.config.movementDwellMs;
        }
    }
    // ─── Private: Idle Detection (§10) ───────
    isIdle(now) {
        // No activity for idle_ms
        return now - this.state.lastActivityTs > this.config.idleMs;
    }
    /** Activity signals: anything that isn't just pointer movement */
    isActivitySignal(type) {
        return type !== focus_1.SignalType.PointerMove && type !== focus_1.SignalType.Hover;
    }
    // ─── Private: State Transitions ──────────
    setActive(screenId, reason, confidence, now) {
        this.state.sequence++;
        const dwellMs = now - this.state.candidateSinceTs;
        this.state.activeScreenId = screenId;
        this.state.lastSwitchTs = now;
        this.metrics.focusChanges++;
        const event = {
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
    emitFocusStateRefresh(now) {
        const snapshot = this.getState();
        this.onFocusState?.(snapshot);
    }
}
exports.FocusAlgorithm = FocusAlgorithm;
// ─────────────────────────────────────────────
// Conflict Resolution Utility (§9)
// ─────────────────────────────────────────────
/**
 * When multiple signals occur close together, resolve which should win.
 * 1. Highest priority (lowest SIGNAL_PRIORITY number)
 * 2. Highest confidence
 * 3. Most recent
 */
function resolveConflict(signals) {
    if (signals.length === 0)
        return null;
    if (signals.length === 1)
        return signals[0];
    return signals.sort((a, b) => {
        // 1. Priority (lower number = higher priority)
        const priA = focus_1.SIGNAL_PRIORITY[a.type] ?? 99;
        const priB = focus_1.SIGNAL_PRIORITY[b.type] ?? 99;
        if (priA !== priB)
            return priA - priB;
        // 2. Confidence (higher = better) — use base confidence as proxy
        const confA = focus_1.BASE_CONFIDENCE[a.type] ?? 0;
        const confB = focus_1.BASE_CONFIDENCE[b.type] ?? 0;
        if (confA !== confB)
            return confB - confA;
        // 3. Most recent
        return b.timestampMs - a.timestampMs;
    })[0];
}
//# sourceMappingURL=focus-algorithm.js.map