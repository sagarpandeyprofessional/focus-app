/**
 * @file    signaling/client.ts
 * @purpose WebSocket signaling client for FOCUS sessions.
 *          Connects to the signaling server and handles message routing.
 * @owner   FOCUS Core Team
 * @depends shared/types/focus.ts
 *
 * Implements WebSocket fallback from WebRTC_Implementation.md §5.
 * Handles reconnection without renegotiating tracks (§7).
 */
import { EventEmitter } from 'events';
export interface SignalingClientConfig {
    serverUrl: string;
    reconnectIntervalMs: number;
    maxReconnectAttempts: number;
}
export declare class SignalingClient extends EventEmitter {
    private config;
    private ws;
    private clientId;
    private sessionId;
    private reconnectAttempts;
    private reconnectTimer;
    private connected;
    constructor(config?: Partial<SignalingClientConfig>);
    connect(): void;
    disconnect(): void;
    createSession(): void;
    joinSession(sessionId: string): void;
    leaveSession(): void;
    sendOffer(offer: RTCSessionDescriptionInit, targetId?: string): void;
    sendAnswer(answer: RTCSessionDescriptionInit, targetId?: string): void;
    sendIceCandidate(candidate: RTCIceCandidateInit, targetId?: string): void;
    sendFocusEvent(payload: unknown): void;
    sendFocusState(payload: unknown): void;
    sendViewerOverride(payload: unknown): void;
    sendScreenMetaUpdate(payload: unknown): void;
    getClientId(): string | null;
    getSessionId(): string | null;
    isConnected(): boolean;
    private handleMessage;
    private send;
    private attemptReconnect;
}
//# sourceMappingURL=client.d.ts.map