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

import { EventEmitter } from 'events';
import {
  ScreenId,
  DisplayBounds,
  SignalType,
  IntentSignal,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export interface IntentEngineConfig {
  /** Polling interval for cursor position (ms) */
  cursorPollIntervalMs: number;
  /** Minimum movement to register pointer move (px) */
  movementThresholdPx: number;
  /** Hover detection: max movement to consider "hovering" (px) */
  hoverRadiusPx: number;
  /** Hover detection: time to register hover (ms) */
  hoverThresholdMs: number;
}

const DEFAULT_INTENT_CONFIG: IntentEngineConfig = {
  cursorPollIntervalMs: 50,  // 20 Hz polling
  movementThresholdPx: 3,
  hoverRadiusPx: 8,
  hoverThresholdMs: 300,
};

// ─────────────────────────────────────────────
// Intent Detection Engine
// ─────────────────────────────────────────────

export class IntentEngine extends EventEmitter {
  private config: IntentEngineConfig;
  private displays: Map<ScreenId, DisplayBounds>;
  private running: boolean = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Cursor tracking state
  private lastCursorX: number = 0;
  private lastCursorY: number = 0;
  private lastCursorTs: number = 0;
  private hoverStartX: number = 0;
  private hoverStartY: number = 0;
  private hoverStartTs: number = 0;
  private hoverEmitted: boolean = false;

  // Cursor position provider (injected — Electron screen API)
  private getCursorPosition: () => { x: number; y: number };

  constructor(
    displays: DisplayBounds[],
    getCursorPosition: () => { x: number; y: number },
    config: Partial<IntentEngineConfig> = {},
  ) {
    super();
    this.config = { ...DEFAULT_INTENT_CONFIG, ...config };
    this.displays = new Map(displays.map((d) => [d.screenId, d]));
    this.getCursorPosition = getCursorPosition;
  }

  // ─── Lifecycle ───────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Start cursor polling
    this.pollTimer = setInterval(() => {
      this.pollCursor();
    }, this.config.cursorPollIntervalMs);

    this.emit('started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit('stopped');
  }

  /** Update display configuration at runtime */
  updateDisplays(displays: DisplayBounds[]): void {
    this.displays = new Map(displays.map((d) => [d.screenId, d]));
  }

  // ─── External Signal Injection ───────────
  // These are called from Electron IPC when renderer detects interactions

  /** Called when user clicks or double-clicks */
  onMouseClick(x: number, y: number, isDouble: boolean = false): void {
    const screenId = this.pointToScreen(x, y);
    if (!screenId) return;

    this.emitSignal({
      type: isDouble ? SignalType.DoubleClick : SignalType.Click,
      screenId,
      x,
      y,
      timestampMs: Date.now(),
    });
  }

  /** Called when user starts dragging */
  onDragStart(x: number, y: number): void {
    const screenId = this.pointToScreen(x, y);
    if (!screenId) return;

    this.emitSignal({
      type: SignalType.DragStart,
      screenId,
      x,
      y,
      timestampMs: Date.now(),
    });
  }

  /** Called when user stops dragging */
  onDragEnd(x: number, y: number): void {
    const screenId = this.pointToScreen(x, y);
    if (!screenId) return;

    this.emitSignal({
      type: SignalType.DragEnd,
      screenId,
      x,
      y,
      timestampMs: Date.now(),
    });
  }

  /** Called when keyboard activity is detected */
  onTyping(activeWindowScreenId?: ScreenId): void {
    const cursor = this.getCursorPosition();
    const screenId = activeWindowScreenId || this.pointToScreen(cursor.x, cursor.y);
    if (!screenId) return;

    this.emitSignal({
      type: SignalType.Typing,
      screenId,
      x: cursor.x,
      y: cursor.y,
      timestampMs: Date.now(),
      windowDisplayId: activeWindowScreenId,
    });
  }

  /** Called when scroll activity is detected */
  onScroll(x: number, y: number): void {
    const screenId = this.pointToScreen(x, y);
    if (!screenId) return;

    this.emitSignal({
      type: SignalType.Scroll,
      screenId,
      x,
      y,
      timestampMs: Date.now(),
    });
  }

  /** Called when OS window focus changes */
  onWindowFocusChange(windowScreenId: ScreenId): void {
    const cursor = this.getCursorPosition();

    this.emitSignal({
      type: SignalType.WindowFocus,
      screenId: windowScreenId,
      x: cursor.x,
      y: cursor.y,
      timestampMs: Date.now(),
      windowDisplayId: windowScreenId,
    });
  }

  // ─── Private: Cursor Polling ─────────────

  private pollCursor(): void {
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
    const hoverDist = Math.sqrt(
      Math.pow(pos.x - this.hoverStartX, 2) +
      Math.pow(pos.y - this.hoverStartY, 2),
    );

    if (hoverDist > this.config.hoverRadiusPx) {
      // Moved out of hover zone — reset
      this.hoverStartX = pos.x;
      this.hoverStartY = pos.y;
      this.hoverStartTs = now;
      this.hoverEmitted = false;
    } else if (
      !this.hoverEmitted &&
      now - this.hoverStartTs >= this.config.hoverThresholdMs
    ) {
      // Hover detected
      this.hoverEmitted = true;
      this.emitSignal({
        type: SignalType.Hover,
        screenId,
        x: pos.x,
        y: pos.y,
        timestampMs: now,
      });
    }

    // Emit pointer movement if significant
    if (dist >= this.config.movementThresholdPx) {
      this.emitSignal({
        type: SignalType.PointerMove,
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

  private pointToScreen(x: number, y: number): ScreenId | null {
    for (const [screenId, bounds] of this.displays) {
      if (
        x >= bounds.x &&
        x < bounds.x + bounds.width &&
        y >= bounds.y &&
        y < bounds.y + bounds.height
      ) {
        return screenId;
      }
    }

    // Boundary fallback: closest display
    let closest: ScreenId | null = null;
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

  private emitSignal(signal: IntentSignal): void {
    this.emit('signal', signal);
  }
}
