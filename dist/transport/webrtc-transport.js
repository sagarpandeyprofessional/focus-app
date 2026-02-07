"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewerTransport = exports.PresenterTransport = void 0;
const events_1 = require("events");
const focus_1 = require("../shared/types/focus");
const DEFAULT_TRANSPORT_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
    useDataChannel: true,
    enableSimulcast: true,
};
// ─────────────────────────────────────────────
// Presenter Transport
// ─────────────────────────────────────────────
class PresenterTransport extends events_1.EventEmitter {
    config;
    bitrateProfile;
    peerConnection = null;
    dataChannel = null;
    tracks = new Map();
    audioSender = null;
    constructor(config = {}, bitrateProfile = focus_1.DEFAULT_BITRATE_PROFILE) {
        super();
        this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
        this.bitrateProfile = bitrateProfile;
    }
    // ─── Connection Lifecycle (§6) ───────────
    /**
     * Initialize peer connection and data channel.
     * Step 1-2 of WebRTC_Implementation.md §6.
     */
    async initialize() {
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
    async addScreenTracks(screens) {
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
                }
                catch (err) {
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
    async addAudioTrack(audioTrack) {
        if (!this.peerConnection) {
            throw new Error('PeerConnection not initialized');
        }
        this.audioSender = this.peerConnection.addTrack(audioTrack);
    }
    /**
     * Update bitrate/FPS for active vs inactive screens.
     * NO renegotiation — only encoding parameter changes (§4).
     */
    async updateActiveScreen(activeScreenId) {
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
                }
                catch (err) {
                    // Non-fatal: encoding update failed
                    console.warn(`[Transport] Bitrate update failed for ${screenId}:`, err);
                }
            }
        }
    }
    /**
     * Send focus event via data channel (§5).
     */
    sendFocusEvent(event) {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(event));
        }
    }
    /**
     * Create SDP offer for signaling.
     */
    async createOffer() {
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
    async applyAnswer(answer) {
        if (!this.peerConnection) {
            throw new Error('PeerConnection not initialized');
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
    /**
     * Add remote ICE candidate.
     */
    async addIceCandidate(candidate) {
        if (!this.peerConnection)
            return;
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    /**
     * Get track metadata for signaling.
     */
    getTrackMeta() {
        return Array.from(this.tracks.values()).map((t) => ({
            trackId: t.track.id,
            screenId: t.screenId,
            kind: 'video',
            isActive: t.isActive,
        }));
    }
    /**
     * Close connection and release resources.
     */
    close() {
        this.dataChannel?.close();
        this.peerConnection?.close();
        this.tracks.clear();
        this.peerConnection = null;
        this.dataChannel = null;
        this.audioSender = null;
    }
    // ─── Private ─────────────────────────────
    getEncodings(screenId, isActive) {
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
exports.PresenterTransport = PresenterTransport;
// ─────────────────────────────────────────────
// Viewer Transport
// ─────────────────────────────────────────────
class ViewerTransport extends events_1.EventEmitter {
    config;
    peerConnection = null;
    dataChannel = null;
    receivedTracks = new Map();
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    }
    /**
     * Initialize viewer peer connection.
     * Subscribes to all screen tracks — no reconnection on focus change (§7.1).
     */
    async initialize() {
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
                }
                catch (err) {
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
    async handleOffer(offer) {
        if (!this.peerConnection) {
            throw new Error('PeerConnection not initialized');
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        return answer;
    }
    /**
     * Add remote ICE candidate.
     */
    async addIceCandidate(candidate) {
        if (!this.peerConnection)
            return;
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    /**
     * Send viewer override via data channel.
     */
    sendViewerOverride(override) {
        if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({
                type: focus_1.SignalingMessageType.ViewerOverride,
                payload: override,
            }));
        }
    }
    /**
     * Map received track ID to screen ID (from screen metadata).
     */
    mapTrackToScreen(trackId, screenId) {
        const entry = this.receivedTracks.get(trackId);
        if (entry) {
            entry.screenId = screenId;
        }
    }
    /**
     * Get all received tracks with screen mapping.
     */
    getReceivedTracks() {
        return Array.from(this.receivedTracks.entries()).map(([id, entry]) => ({
            trackId: id,
            track: entry.track,
            screenId: entry.screenId,
        }));
    }
    /**
     * Close connection.
     */
    close() {
        this.dataChannel?.close();
        this.peerConnection?.close();
        this.receivedTracks.clear();
        this.peerConnection = null;
        this.dataChannel = null;
    }
}
exports.ViewerTransport = ViewerTransport;
//# sourceMappingURL=webrtc-transport.js.map