/**
 * @file    transport/webrtc-transport.ts
 * @purpose WebRTC media transport with multi-track support.
 *          SFU-based topology, no MCU, no server-side compositing.
 * @owner   FOCUS Core Team
 * @depends shared/types/focus.ts
 *
 * Key constraints from WebRTC_Implementation.md:
 *   - Each screen = independent video track
 *   - One shared audio track
 *   - No video renegotiation on focus change
 *   - Data Channel for control plane (focus events, overrides)
 *   - DTLS-SRTP encryption
 */

import { EventEmitter } from 'events';
import {
  ScreenId,
  TrackMeta,
  BitrateProfile,
  DEFAULT_BITRATE_PROFILE,
  FocusChangeEvent,
  FocusStateSnapshot,
  ViewerOverride,
  SignalingMessage,
  SignalingMessageType,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export interface WebRTCTransportConfig {
  iceServers: RTCIceServer[];
  /** Use data channel for control plane (§5) */
  useDataChannel: boolean;
  /** Simulcast encoding layers for active screen */
  enableSimulcast: boolean;
}

const DEFAULT_TRANSPORT_CONFIG: WebRTCTransportConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN relay — required when both peers are behind symmetric NAT.
    // Replace with your own TURN credentials (Metered.ca free tier, Twilio, or self-hosted coturn).
    // Without TURN, cross-network connections fail ~30-40% of the time.
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
      credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
      credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
    },
    {
      urls: 'turns:a.relay.metered.ca:443',
      username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
      credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
    },
  ],
  useDataChannel: true,
  enableSimulcast: true,
};

// ─────────────────────────────────────────────
// Track Info (internal)
// ─────────────────────────────────────────────

interface ManagedTrack {
  screenId: ScreenId;
  track: MediaStreamTrack;
  sender: RTCRtpSender | null;
  isActive: boolean;
}

// ─────────────────────────────────────────────
// Presenter Transport
// ─────────────────────────────────────────────

export class PresenterTransport extends EventEmitter {
  private config: WebRTCTransportConfig;
  private bitrateProfile: BitrateProfile;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private tracks: Map<ScreenId, ManagedTrack> = new Map();
  private audioSender: RTCRtpSender | null = null;

  constructor(
    config: Partial<WebRTCTransportConfig> = {},
    bitrateProfile: BitrateProfile = DEFAULT_BITRATE_PROFILE,
  ) {
    super();
    this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.bitrateProfile = bitrateProfile;
  }

  // ─── Connection Lifecycle (§6) ───────────

  /**
   * Initialize peer connection and data channel.
   * Step 1-2 of WebRTC_Implementation.md §6.
   */
  async initialize(): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers,
      // @ts-ignore — encodedInsertableStreams for E2EE extension (§8)
      encodedInsertableStreams: false,
    });

    // ICE candidate handling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('ice-candidate', event.candidate);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      this.emit('connection-state', state);

      if (state === 'disconnected' || state === 'failed') {
        this.emit('connection-lost');
      }
    };

    // Data channel for control plane (§5)
    if (this.config.useDataChannel) {
      this.dataChannel = this.peerConnection.createDataChannel('focus-control', {
        ordered: true,
        maxRetransmits: 3,
      });

      this.dataChannel.onopen = () => this.emit('data-channel-open');
      this.dataChannel.onclose = () => this.emit('data-channel-close');
    }
  }

  /**
   * Add video tracks for all shared screens.
   * Step 3 of WebRTC_Implementation.md §6: Publish multiple video tracks.
   * Each screen is a separate track — NEVER renegotiated on focus change.
   */
  async addScreenTracks(
    screens: Array<{ screenId: ScreenId; track: MediaStreamTrack }>,
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    for (const { screenId, track } of screens) {
      const encodings = this.getEncodings(screenId, false);

      const sender = this.peerConnection.addTrack(track);

      // Apply encoding parameters (simulcast / SVC per §4)
      if (this.config.enableSimulcast && sender.setParameters) {
        try {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate =
              this.bitrateProfile.inactiveMaxBitrateKbps * 1000;
            params.encodings[0].maxFramerate =
              this.bitrateProfile.inactiveMaxFps;
          }
          await sender.setParameters(params);
        } catch (err) {
          console.warn(`[Transport] Failed to set encoding for ${screenId}:`, err);
        }
      }

      this.tracks.set(screenId, {
        screenId,
        track,
        sender,
        isActive: false,
      });
    }
  }

  /**
   * Add shared audio track.
   */
  async addAudioTrack(audioTrack: MediaStreamTrack): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    this.audioSender = this.peerConnection.addTrack(audioTrack);
  }

  /**
   * Update bitrate/FPS for active vs inactive screens.
   * NO renegotiation — only encoding parameter changes (§4).
   */
  async updateActiveScreen(activeScreenId: ScreenId): Promise<void> {
    for (const [screenId, managed] of this.tracks) {
      const isActive = screenId === activeScreenId;
      managed.isActive = isActive;

      if (managed.sender) {
        try {
          const params = managed.sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = isActive
              ? this.bitrateProfile.activeMaxBitrateKbps * 1000
              : this.bitrateProfile.inactiveMaxBitrateKbps * 1000;
            params.encodings[0].maxFramerate = isActive
              ? this.bitrateProfile.activeMaxFps
              : this.bitrateProfile.inactiveMaxFps;
          }
          await managed.sender.setParameters(params);
        } catch (err) {
          // Non-fatal: encoding update failed
          console.warn(`[Transport] Bitrate update failed for ${screenId}:`, err);
        }
      }
    }
  }

  /**
   * Send focus event via data channel (§5).
   */
  sendFocusEvent(event: FocusChangeEvent | FocusStateSnapshot): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(event));
    }
  }

  /**
   * Create SDP offer for signaling.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Apply remote SDP answer.
   */
  async applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer),
    );
  }

  /**
   * Add remote ICE candidate.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Get track metadata for signaling.
   */
  getTrackMeta(): TrackMeta[] {
    return Array.from(this.tracks.values()).map((t) => ({
      trackId: t.track.id,
      screenId: t.screenId,
      kind: 'video' as const,
      isActive: t.isActive,
    }));
  }

  /**
   * Close connection and release resources.
   */
  close(): void {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.tracks.clear();
    this.peerConnection = null;
    this.dataChannel = null;
    this.audioSender = null;
  }

  // ─── Private ─────────────────────────────

  private getEncodings(
    screenId: ScreenId,
    isActive: boolean,
  ): RTCRtpEncodingParameters[] {
    return [
      {
        maxBitrate: isActive
          ? this.bitrateProfile.activeMaxBitrateKbps * 1000
          : this.bitrateProfile.inactiveMaxBitrateKbps * 1000,
        maxFramerate: isActive
          ? this.bitrateProfile.activeMaxFps
          : this.bitrateProfile.inactiveMaxFps,
      },
    ];
  }
}

// ─────────────────────────────────────────────
// Viewer Transport
// ─────────────────────────────────────────────

export class ViewerTransport extends EventEmitter {
  private config: WebRTCTransportConfig;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private receivedTracks: Map<string, { track: MediaStreamTrack; screenId?: ScreenId }> = new Map();

  constructor(config: Partial<WebRTCTransportConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
  }

  /**
   * Initialize viewer peer connection.
   * Subscribes to all screen tracks — no reconnection on focus change (§7.1).
   */
  async initialize(): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers,
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('ice-candidate', event.candidate);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      this.emit('connection-state', state);
    };

    // Receive tracks from presenter
    this.peerConnection.ontrack = (event) => {
      const track = event.track;
      this.receivedTracks.set(track.id, { track });
      this.emit('track-received', {
        trackId: track.id,
        track,
        streams: event.streams,
      });
    };

    // Receive data channel for focus events
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;

      this.dataChannel.onmessage = (msgEvent) => {
        try {
          const data = JSON.parse(msgEvent.data);
          this.emit('focus-event', data);
        } catch (err) {
          console.warn('[ViewerTransport] Invalid data channel message:', err);
        }
      };

      this.dataChannel.onopen = () => this.emit('data-channel-open');
      this.dataChannel.onclose = () => this.emit('data-channel-close');
    };
  }

  /**
   * Apply remote SDP offer and create answer.
   */
  async handleOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer),
    );
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  /**
   * Add remote ICE candidate.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Send viewer override via data channel.
   */
  sendViewerOverride(override: ViewerOverride): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(
        JSON.stringify({
          type: SignalingMessageType.ViewerOverride,
          payload: override,
        }),
      );
    }
  }

  /**
   * Map received track ID to screen ID (from screen metadata).
   */
  mapTrackToScreen(trackId: string, screenId: ScreenId): void {
    const entry = this.receivedTracks.get(trackId);
    if (entry) {
      entry.screenId = screenId;
    }
  }

  /**
   * Get all received tracks with screen mapping.
   */
  getReceivedTracks(): Array<{ trackId: string; track: MediaStreamTrack; screenId?: ScreenId }> {
    return Array.from(this.receivedTracks.entries()).map(([id, entry]) => ({
      trackId: id,
      track: entry.track,
      screenId: entry.screenId,
    }));
  }

  /**
   * Close connection.
   */
  close(): void {
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.receivedTracks.clear();
    this.peerConnection = null;
    this.dataChannel = null;
  }
}
