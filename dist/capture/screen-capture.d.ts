/**
 * @file    capture/screen-capture.ts
 * @purpose Capture each display as a separate video track.
 *          Each screen = independent MediaStream with one video track.
 * @owner   FOCUS Core Team
 * @depends Electron desktopCapturer API, shared/types/focus.ts
 *
 * Architecture constraint: max 3 displays (configurable).
 * Each track has independent resolution and bitrate.
 * Runs in the renderer process (requires desktopCapturer access).
 */
import { ScreenId, ScreenMeta, DisplayBounds, BitrateProfile } from '../shared/types/focus';
export interface CapturedScreen {
    readonly screenId: ScreenId;
    readonly sourceId: string;
    readonly label: string;
    readonly stream: MediaStream;
    readonly videoTrack: MediaStreamTrack;
    readonly bounds: DisplayBounds;
}
export interface CaptureConfig {
    maxScreens: number;
    maxWidth: number;
    maxHeight: number;
    maxFrameRate: number;
}
export declare class ScreenCaptureManager {
    private config;
    private captures;
    private bitrateProfile;
    constructor(config?: Partial<CaptureConfig>, bitrateProfile?: BitrateProfile);
    /**
     * Enumerate available displays.
     * Uses Electron's desktopCapturer to list screen sources.
     */
    getAvailableDisplays(): Promise<Array<{
        sourceId: string;
        name: string;
        displayId: string;
        thumbnail: string;
    }>>;
    /**
     * Start capturing selected screens.
     * Each screen becomes an independent MediaStream with one video track.
     */
    startCapture(selectedScreens: Array<{
        screenId: ScreenId;
        sourceId: string;
        label: string;
        bounds: DisplayBounds;
    }>): Promise<CapturedScreen[]>;
    /**
     * Get all active captures.
     */
    getCaptures(): CapturedScreen[];
    /**
     * Get a specific capture by screen ID.
     */
    getCapture(screenId: ScreenId): CapturedScreen | undefined;
    /**
     * Apply bitrate constraints based on active/inactive status.
     * Active screen gets high bitrate; inactive screens get low bitrate.
     * This does NOT renegotiate tracks — it only adjusts encoding parameters.
     */
    applyBitrateStrategy(activeScreenId: ScreenId): Promise<void>;
    /**
     * Stop capturing a specific screen.
     */
    stopCapture(screenId: ScreenId): void;
    /**
     * Stop all captures.
     */
    stopAllCaptures(): void;
    /**
     * Generate screen metadata for signaling.
     */
    getScreenMeta(activeScreenId: ScreenId): ScreenMeta[];
    /**
     * Capture a single display using getUserMedia with chromeMediaSource.
     * This is the Electron-specific screen capture path.
     */
    private captureDisplay;
}
export declare class AudioCaptureManager {
    private stream;
    /**
     * Capture system audio (single shared track per spec).
     */
    startCapture(): Promise<MediaStream>;
    getAudioTrack(): MediaStreamTrack | null;
    stop(): void;
}
//# sourceMappingURL=screen-capture.d.ts.map