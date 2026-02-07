"use strict";
/**
 * @file    intent/intent-engine.ts
 * @purpose Capture OS-level interaction signals and emit IntentSignal events.
 *          Runs locally on the presenter device.
 * @owner   FOCUS Core Team
 * @depends shared/types/focus.ts, intent/focus-algorithm.ts
 *
 * In Electron, this runs in the main process with access to:
 *   - screen.getCursorScreenPoint() for pointer position
 *   - globalShortcut for hotkeys
 *   - BrowserWindow.getFocusedWindow() for window focus
 *   - Native modules for advanced input (phase 2)
 *
 * For MVP, we use Electron APIs + polling for cursor tracking,
 * plus IPC events for click/type/scroll from the renderer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentEngine = void 0;
const events_1 = require("events");
const focus_1 = require("../shared/types/focus");
const DEFAULT_INTENT_CONFIG = {
    cursorPollIntervalMs: 50, // 20 Hz polling
    movementThresholdPx: 3,
    hoverRadiusPx: 8,
    hoverThresholdMs: 300,
};
// ─────────────────────────────────────────────
// Intent Detection Engine
// ─────────────────────────────────────────────
class IntentEngine extends events_1.EventEmitter {
    config;
    displays;
    running = false;
    pollTimer = null;
    // Cursor tracking state
    lastCursorX = 0;
    lastCursorY = 0;
    lastCursorTs = 0;
    hoverStartX = 0;
    hoverStartY = 0;
    hoverStartTs = 0;
    hoverEmitted = false;
    // Cursor position provider (injected — Electron screen API)
    getCursorPosition;
    constructor(displays, getCursorPosition, config = {}) {
        super();
        this.config = { ...DEFAULT_INTENT_CONFIG, ...config };
        this.displays = new Map(displays.map((d) => [d.screenId, d]));
        this.getCursorPosition = getCursorPosition;
    }
    // ─── Lifecycle ───────────────────────────
    start() {
        if (this.running)
            return;
        this.running = true;
        // Start cursor polling
        this.pollTimer = setInterval(() => {
            this.pollCursor();
        }, this.config.cursorPollIntervalMs);
        this.emit('started');
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.emit('stopped');
    }
    /** Update display configuration at runtime */
    updateDisplays(displays) {
        this.displays = new Map(displays.map((d) => [d.screenId, d]));
    }
    // ─── External Signal Injection ───────────
    // These are called from Electron IPC when renderer detects interactions
    /** Called when user clicks or double-clicks */
    onMouseClick(x, y, isDouble = false) {
        const screenId = this.pointToScreen(x, y);
        if (!screenId)
            return;
        this.emitSignal({
            type: isDouble ? focus_1.SignalType.DoubleClick : focus_1.SignalType.Click,
            screenId,
            x,
            y,
            timestampMs: Date.now(),
        });
    }
    /** Called when user starts dragging */
    onDragStart(x, y) {
        const screenId = this.pointToScreen(x, y);
        if (!screenId)
            return;
        this.emitSignal({
            type: focus_1.SignalType.DragStart,
            screenId,
            x,
            y,
            timestampMs: Date.now(),
        });
    }
    /** Called when user stops dragging */
    onDragEnd(x, y) {
        const screenId = this.pointToScreen(x, y);
        if (!screenId)
            return;
        this.emitSignal({
            type: focus_1.SignalType.DragEnd,
            screenId,
            x,
            y,
            timestampMs: Date.now(),
        });
    }
    /** Called when keyboard activity is detected */
    onTyping(activeWindowScreenId) {
        const cursor = this.getCursorPosition();
        const screenId = activeWindowScreenId || this.pointToScreen(cursor.x, cursor.y);
        if (!screenId)
            return;
        this.emitSignal({
            type: focus_1.SignalType.Typing,
            screenId,
            x: cursor.x,
            y: cursor.y,
            timestampMs: Date.now(),
            windowDisplayId: activeWindowScreenId,
        });
    }
    /** Called when scroll activity is detected */
    onScroll(x, y) {
        const screenId = this.pointToScreen(x, y);
        if (!screenId)
            return;
        this.emitSignal({
            type: focus_1.SignalType.Scroll,
            screenId,
            x,
            y,
            timestampMs: Date.now(),
        });
    }
    /** Called when OS window focus changes */
    onWindowFocusChange(windowScreenId) {
        const cursor = this.getCursorPosition();
        this.emitSignal({
            type: focus_1.SignalType.WindowFocus,
            screenId: windowScreenId,
            x: cursor.x,
            y: cursor.y,
            timestampMs: Date.now(),
            windowDisplayId: windowScreenId,
        });
    }
    // ─── Private: Cursor Polling ─────────────
    pollCursor() {
        const now = Date.now();
        const pos = this.getCursorPosition();
        const dx = pos.x - this.lastCursorX;
        const dy = pos.y - this.lastCursorY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dt = now - this.lastCursorTs;
        const speed = dt > 0 ? (dist / dt) * 1000 : 0; // px/s
        const screenId = this.pointToScreen(pos.x, pos.y);
        if (!screenId) {
            this.lastCursorX = pos.x;
            this.lastCursorY = pos.y;
            this.lastCursorTs = now;
            return;
        }
        // Check for hover (§3.2 low priority: sustained hover ≥ 300ms)
        const hoverDist = Math.sqrt(Math.pow(pos.x - this.hoverStartX, 2) +
            Math.pow(pos.y - this.hoverStartY, 2));
        if (hoverDist > this.config.hoverRadiusPx) {
            // Moved out of hover zone — reset
            this.hoverStartX = pos.x;
            this.hoverStartY = pos.y;
            this.hoverStartTs = now;
            this.hoverEmitted = false;
        }
        else if (!this.hoverEmitted &&
            now - this.hoverStartTs >= this.config.hoverThresholdMs) {
            // Hover detected
            this.hoverEmitted = true;
            this.emitSignal({
                type: focus_1.SignalType.Hover,
                screenId,
                x: pos.x,
                y: pos.y,
                timestampMs: now,
            });
        }
        // Emit pointer movement if significant
        if (dist >= this.config.movementThresholdPx) {
            this.emitSignal({
                type: focus_1.SignalType.PointerMove,
                screenId,
                x: pos.x,
                y: pos.y,
                timestampMs: now,
                speedPxPerS: Math.round(speed),
            });
        }
        this.lastCursorX = pos.x;
        this.lastCursorY = pos.y;
        this.lastCursorTs = now;
    }
    // ─── Private: Screen Attribution (§6.1) ──
    pointToScreen(x, y) {
        for (const [screenId, bounds] of this.displays) {
            if (x >= bounds.x &&
                x < bounds.x + bounds.width &&
                y >= bounds.y &&
                y < bounds.y + bounds.height) {
                return screenId;
            }
        }
        // Boundary fallback: closest display
        let closest = null;
        let minDist = Infinity;
        for (const [screenId, bounds] of this.displays) {
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;
            const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
            if (dist < minDist) {
                minDist = dist;
                closest = screenId;
            }
        }
        return closest;
    }
    // ─── Private: Signal Emission ────────────
    emitSignal(signal) {
        this.emit('signal', signal);
    }
}
exports.IntentEngine = IntentEngine;
//# sourceMappingURL=intent-engine.js.map