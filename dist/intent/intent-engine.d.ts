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
import { ScreenId, DisplayBounds } from '../shared/types/focus';
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
export declare class IntentEngine extends EventEmitter {
    private config;
    private displays;
    private running;
    private pollTimer;
    private lastCursorX;
    private lastCursorY;
    private lastCursorTs;
    private hoverStartX;
    private hoverStartY;
    private hoverStartTs;
    private hoverEmitted;
    private getCursorPosition;
    constructor(displays: DisplayBounds[], getCursorPosition: () => {
        x: number;
        y: number;
    }, config?: Partial<IntentEngineConfig>);
    start(): void;
    stop(): void;
    /** Update display configuration at runtime */
    updateDisplays(displays: DisplayBounds[]): void;
    /** Called when user clicks or double-clicks */
    onMouseClick(x: number, y: number, isDouble?: boolean): void;
    /** Called when user starts dragging */
    onDragStart(x: number, y: number): void;
    /** Called when user stops dragging */
    onDragEnd(x: number, y: number): void;
    /** Called when keyboard activity is detected */
    onTyping(activeWindowScreenId?: ScreenId): void;
    /** Called when scroll activity is detected */
    onScroll(x: number, y: number): void;
    /** Called when OS window focus changes */
    onWindowFocusChange(windowScreenId: ScreenId): void;
    private pollCursor;
    private pointToScreen;
    private emitSignal;
}
//# sourceMappingURL=intent-engine.d.ts.map