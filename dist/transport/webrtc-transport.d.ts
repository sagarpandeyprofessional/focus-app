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
import { ScreenId, TrackMeta, BitrateProfile, FocusChangeEvent, FocusStateSnapshot, ViewerOverride } from '../shared/types/focus';
export interface WebRTCTransportConfig {
    iceServers: RTCIceServer[];
    /** Use data channel for control plane (§5) */
    useDataChannel: boolean;
    /** Simulcast encoding layers for active screen */
    enableSimulcast: boolean;
}
export declare class PresenterTransport extends EventEmitter {
    private config;
    private bitrateProfile;
    private peerConnection;
    private dataChannel;
    private tracks;
    private audioSender;
    constructor(config?: Partial<WebRTCTransportConfig>, bitrateProfile?: BitrateProfile);
    /**
     * Initialize peer connection and data channel.
     * Step 1-2 of WebRTC_Implementation.md §6.
     */
    initialize(): Promise<void>;
    /**
     * Add video tracks for all shared screens.
     * Step 3 of WebRTC_Implementation.md §6: Publish multiple video tracks.
     * Each screen is a separate track — NEVER renegotiated on focus change.
     */
    addScreenTracks(screens: Array<{
        screenId: ScreenId;
        track: MediaStreamTrack;
    }>): Promise<void>;
    /**
     * Add shared audio track.
     */
    addAudioTrack(audioTrack: MediaStreamTrack): Promise<void>;
    /**
     * Update bitrate/FPS for active vs inactive screens.
     * NO renegotiation — only encoding parameter changes (§4).
     */
    updateActiveScreen(activeScreenId: ScreenId): Promise<void>;
    /**
     * Send focus event via data channel (§5).
     */
    sendFocusEvent(event: FocusChangeEvent | FocusStateSnapshot): void;
    /**
     * Create SDP offer for signaling.
     */
    createOffer(): Promise<RTCSessionDescriptionInit>;
    /**
     * Apply remote SDP answer.
     */
    applyAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
    /**
     * Add remote ICE candidate.
     */
    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
    /**
     * Get track metadata for signaling.
     */
    getTrackMeta(): TrackMeta[];
    /**
     * Close connection and release resources.
     */
    close(): void;
    private getEncodings;
}
export declare class ViewerTransport extends EventEmitter {
    private config;
    private peerConnection;
    private dataChannel;
    private receivedTracks;
    constructor(config?: Partial<WebRTCTransportConfig>);
    /**
     * Initialize viewer peer connection.
     * Subscribes to all screen tracks — no reconnection on focus change (§7.1).
     */
    initialize(): Promise<void>;
    /**
     * Apply remote SDP offer and create answer.
     */
    handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
    /**
     * Add remote ICE candidate.
     */
    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
    /**
     * Send viewer override via data channel.
     */
    sendViewerOverride(override: ViewerOverride): void;
    /**
     * Map received track ID to screen ID (from screen metadata).
     */
    mapTrackToScreen(trackId: string, screenId: ScreenId): void;
    /**
     * Get all received tracks with screen mapping.
     */
    getReceivedTracks(): Array<{
        trackId: string;
        track: MediaStreamTrack;
        screenId?: ScreenId;
    }>;
    /**
     * Close connection.
     */
    close(): void;
}
//# sourceMappingURL=webrtc-transport.d.ts.map