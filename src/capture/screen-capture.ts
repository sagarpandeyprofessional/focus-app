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

import {
  ScreenId,
  ScreenMeta,
  DisplayBounds,
  BitrateProfile,
  DEFAULT_BITRATE_PROFILE,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CapturedScreen {
  readonly screenId: ScreenId;
  readonly sourceId: string;     // Electron source ID
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

const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  maxScreens: 3,
  maxWidth: 1920,
  maxHeight: 1080,
  maxFrameRate: 30,
};

// ─────────────────────────────────────────────
// Screen Capture Manager
// ─────────────────────────────────────────────

export class ScreenCaptureManager {
  private config: CaptureConfig;
  private captures: Map<ScreenId, CapturedScreen> = new Map();
  private bitrateProfile: BitrateProfile;

  constructor(
    config: Partial<CaptureConfig> = {},
    bitrateProfile: BitrateProfile = DEFAULT_BITRATE_PROFILE,
  ) {
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
    this.bitrateProfile = bitrateProfile;
  }

  // ─── Public API ──────────────────────────

  /**
   * Enumerate available displays.
   * Uses Electron's desktopCapturer to list screen sources.
   */
  async getAvailableDisplays(): Promise<Array<{
    sourceId: string;
    name: string;
    displayId: string;
    thumbnail: string; // base64 data URL
  }>> {
    // In Electron renderer, access desktopCapturer via preload
    const sources = await (window as any).electronAPI.getDesktopSources();

    return sources
      .filter((s: any) => s.id.startsWith('screen:'))
      .map((s: any) => ({
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
  async startCapture(
    selectedScreens: Array<{
      screenId: ScreenId;
      sourceId: string;
      label: string;
      bounds: DisplayBounds;
    }>,
  ): Promise<CapturedScreen[]> {
    if (selectedScreens.length > this.config.maxScreens) {
      throw new Error(
        `Cannot capture more than ${this.config.maxScreens} screens`,
      );
    }

    // Stop any existing captures
    this.stopAllCaptures();

    const results: CapturedScreen[] = [];

    for (const screen of selectedScreens) {
      const stream = await this.captureDisplay(screen.sourceId);
      const videoTrack = stream.getVideoTracks()[0];

      if (!videoTrack) {
        throw new Error(`No video track for screen ${screen.screenId}`);
      }

      const captured: CapturedScreen = {
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
  getCaptures(): CapturedScreen[] {
    return Array.from(this.captures.values());
  }

  /**
   * Get a specific capture by screen ID.
   */
  getCapture(screenId: ScreenId): CapturedScreen | undefined {
    return this.captures.get(screenId);
  }

  /**
   * Apply bitrate constraints based on active/inactive status.
   * Active screen gets high bitrate; inactive screens get low bitrate.
   * This does NOT renegotiate tracks — it only adjusts encoding parameters.
   */
  async applyBitrateStrategy(activeScreenId: ScreenId): Promise<void> {
    for (const [screenId, capture] of this.captures) {
      const isActive = screenId === activeScreenId;
      const constraints: MediaTrackConstraints = {
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
      } catch (err) {
        console.warn(
          `[ScreenCapture] Failed to apply constraints to ${screenId}:`,
          err,
        );
      }
    }
  }

  /**
   * Stop capturing a specific screen.
   */
  stopCapture(screenId: ScreenId): void {
    const capture = this.captures.get(screenId);
    if (capture) {
      capture.stream.getTracks().forEach((t) => t.stop());
      this.captures.delete(screenId);
    }
  }

  /**
   * Stop all captures.
   */
  stopAllCaptures(): void {
    for (const [screenId] of this.captures) {
      this.stopCapture(screenId);
    }
  }

  /**
   * Generate screen metadata for signaling.
   */
  getScreenMeta(activeScreenId: ScreenId): ScreenMeta[] {
    return Array.from(this.captures.values()).map((c) => ({
      screenId: c.screenId,
      label: c.label,
      bounds: c.bounds,
      isActive: c.screenId === activeScreenId,
      bitrateKbps:
        c.screenId === activeScreenId
          ? this.bitrateProfile.activeMaxBitrateKbps
          : this.bitrateProfile.inactiveMaxBitrateKbps,
      fps:
        c.screenId === activeScreenId
          ? this.bitrateProfile.activeMaxFps
          : this.bitrateProfile.inactiveMaxFps,
    }));
  }

  // ─── Private ─────────────────────────────

  /**
   * Capture a single display using getUserMedia with chromeMediaSource.
   * This is the Electron-specific screen capture path.
   */
  private async captureDisplay(sourceId: string): Promise<MediaStream> {
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
      } as any,
    });

    return stream;
  }
}

// ─────────────────────────────────────────────
// Audio Capture (single shared audio track)
// ─────────────────────────────────────────────

export class AudioCaptureManager {
  private stream: MediaStream | null = null;

  /**
   * Capture system audio (single shared track per spec).
   */
  async startCapture(): Promise<MediaStream> {
    // In Electron, system audio capture requires loopback
    // This is a simplified version; production would use native audio API
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Electron system audio constraints
        mandatory: {
          chromeMediaSource: 'desktop',
        },
      } as any,
      video: false,
    });

    return this.stream;
  }

  getAudioTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] || null;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
