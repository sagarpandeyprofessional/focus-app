"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioCaptureManager = exports.ScreenCaptureManager = void 0;
const focus_1 = require("../shared/types/focus");
const DEFAULT_CAPTURE_CONFIG = {
    maxScreens: 3,
    maxWidth: 1920,
    maxHeight: 1080,
    maxFrameRate: 30,
};
// ─────────────────────────────────────────────
// Screen Capture Manager
// ─────────────────────────────────────────────
class ScreenCaptureManager {
    config;
    captures = new Map();
    bitrateProfile;
    constructor(config = {}, bitrateProfile = focus_1.DEFAULT_BITRATE_PROFILE) {
        this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
        this.bitrateProfile = bitrateProfile;
    }
    // ─── Public API ──────────────────────────
    /**
     * Enumerate available displays.
     * Uses Electron's desktopCapturer to list screen sources.
     */
    async getAvailableDisplays() {
        // In Electron renderer, access desktopCapturer via preload
        const sources = await window.electronAPI.getDesktopSources();
        return sources
            .filter((s) => s.id.startsWith('screen:'))
            .map((s) => ({
            sourceId: s.id,
            name: s.name,
            displayId: s.display_id || s.id,
            thumbnail: s.thumbnail?.toDataURL?.() || '',
        }));
    }
    /**
     * Start capturing selected screens.
     * Each screen becomes an independent MediaStream with one video track.
     */
    async startCapture(selectedScreens) {
        if (selectedScreens.length > this.config.maxScreens) {
            throw new Error(`Cannot capture more than ${this.config.maxScreens} screens`);
        }
        // Stop any existing captures
        this.stopAllCaptures();
        const results = [];
        for (const screen of selectedScreens) {
            const stream = await this.captureDisplay(screen.sourceId);
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                throw new Error(`No video track for screen ${screen.screenId}`);
            }
            const captured = {
                screenId: screen.screenId,
                sourceId: screen.sourceId,
                label: screen.label,
                stream,
                videoTrack,
                bounds: screen.bounds,
            };
            this.captures.set(screen.screenId, captured);
            results.push(captured);
        }
        return results;
    }
    /**
     * Get all active captures.
     */
    getCaptures() {
        return Array.from(this.captures.values());
    }
    /**
     * Get a specific capture by screen ID.
     */
    getCapture(screenId) {
        return this.captures.get(screenId);
    }
    /**
     * Apply bitrate constraints based on active/inactive status.
     * Active screen gets high bitrate; inactive screens get low bitrate.
     * This does NOT renegotiate tracks — it only adjusts encoding parameters.
     */
    async applyBitrateStrategy(activeScreenId) {
        for (const [screenId, capture] of this.captures) {
            const isActive = screenId === activeScreenId;
            const constraints = {
                width: { max: this.config.maxWidth },
                height: { max: this.config.maxHeight },
                frameRate: {
                    max: isActive
                        ? this.bitrateProfile.activeMaxFps
                        : this.bitrateProfile.inactiveMaxFps,
                },
            };
            try {
                await capture.videoTrack.applyConstraints(constraints);
            }
            catch (err) {
                console.warn(`[ScreenCapture] Failed to apply constraints to ${screenId}:`, err);
            }
        }
    }
    /**
     * Stop capturing a specific screen.
     */
    stopCapture(screenId) {
        const capture = this.captures.get(screenId);
        if (capture) {
            capture.stream.getTracks().forEach((t) => t.stop());
            this.captures.delete(screenId);
        }
    }
    /**
     * Stop all captures.
     */
    stopAllCaptures() {
        for (const [screenId] of this.captures) {
            this.stopCapture(screenId);
        }
    }
    /**
     * Generate screen metadata for signaling.
     */
    getScreenMeta(activeScreenId) {
        return Array.from(this.captures.values()).map((c) => ({
            screenId: c.screenId,
            label: c.label,
            bounds: c.bounds,
            isActive: c.screenId === activeScreenId,
            bitrateKbps: c.screenId === activeScreenId
                ? this.bitrateProfile.activeMaxBitrateKbps
                : this.bitrateProfile.inactiveMaxBitrateKbps,
            fps: c.screenId === activeScreenId
                ? this.bitrateProfile.activeMaxFps
                : this.bitrateProfile.inactiveMaxFps,
        }));
    }
    // ─── Private ─────────────────────────────
    /**
     * Capture a single display using getUserMedia with chromeMediaSource.
     * This is the Electron-specific screen capture path.
     */
    async captureDisplay(sourceId) {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                // Electron-specific constraints for screen capture
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId,
                    maxWidth: this.config.maxWidth,
                    maxHeight: this.config.maxHeight,
                    maxFrameRate: this.config.maxFrameRate,
                },
            },
        });
        return stream;
    }
}
exports.ScreenCaptureManager = ScreenCaptureManager;
// ─────────────────────────────────────────────
// Audio Capture (single shared audio track)
// ─────────────────────────────────────────────
class AudioCaptureManager {
    stream = null;
    /**
     * Capture system audio (single shared track per spec).
     */
    async startCapture() {
        // In Electron, system audio capture requires loopback
        // This is a simplified version; production would use native audio API
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                // Electron system audio constraints
                mandatory: {
                    chromeMediaSource: 'desktop',
                },
            },
            video: false,
        });
        return this.stream;
    }
    getAudioTrack() {
        return this.stream?.getAudioTracks()[0] || null;
    }
    stop() {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
    }
}
exports.AudioCaptureManager = AudioCaptureManager;
//# sourceMappingURL=screen-capture.js.map