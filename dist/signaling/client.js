"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingClient = void 0;
const events_1 = require("events");
const focus_1 = require("../shared/types/focus");
const DEFAULT_CLIENT_CONFIG = {
    serverUrl: 'ws://localhost:8080',
    reconnectIntervalMs: 2000,
    maxReconnectAttempts: 10,
};
// ─────────────────────────────────────────────
// Signaling Client
// ─────────────────────────────────────────────
class SignalingClient extends events_1.EventEmitter {
    config;
    ws = null;
    clientId = null;
    sessionId = null;
    reconnectAttempts = 0;
    reconnectTimer = null;
    connected = false;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
    }
    // ─── Connection Lifecycle ────────────────
    connect() {
        try {
            this.ws = new WebSocket(this.config.serverUrl);
            this.ws.onopen = () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                this.emit('connected');
            };
            this.ws.onclose = () => {
                this.connected = false;
                this.emit('disconnected');
                this.attemptReconnect();
            };
            this.ws.onerror = (err) => {
                this.emit('error', err);
            };
            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                    this.handleMessage(msg);
                }
                catch (err) {
                    console.warn('[SignalingClient] Invalid message:', err);
                }
            };
        }
        catch (err) {
            this.emit('error', err);
            this.attemptReconnect();
        }
    }
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }
    // ─── Session Actions ─────────────────────
    createSession() {
        this.send({
            type: focus_1.SignalingMessageType.CreateSession,
            senderId: this.clientId || '',
            sessionId: '',
            payload: {},
            timestampMs: Date.now(),
        });
    }
    joinSession(sessionId) {
        this.send({
            type: focus_1.SignalingMessageType.JoinSession,
            senderId: this.clientId || '',
            sessionId,
            payload: {},
            timestampMs: Date.now(),
        });
    }
    leaveSession() {
        if (!this.sessionId)
            return;
        this.send({
            type: focus_1.SignalingMessageType.LeaveSession,
            senderId: this.clientId || '',
            sessionId: this.sessionId,
            payload: {},
            timestampMs: Date.now(),
        });
        this.sessionId = null;
    }
    // ─── WebRTC Signaling ────────────────────
    sendOffer(offer, targetId) {
        this.send({
            type: focus_1.SignalingMessageType.Offer,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload: { offer, targetId },
            timestampMs: Date.now(),
        });
    }
    sendAnswer(answer, targetId) {
        this.send({
            type: focus_1.SignalingMessageType.Answer,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload: { answer, targetId },
            timestampMs: Date.now(),
        });
    }
    sendIceCandidate(candidate, targetId) {
        this.send({
            type: focus_1.SignalingMessageType.IceCandidate,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload: { candidate, targetId },
            timestampMs: Date.now(),
        });
    }
    // ─── Focus Events ────────────────────────
    sendFocusEvent(payload) {
        this.send({
            type: focus_1.SignalingMessageType.FocusChange,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload,
            timestampMs: Date.now(),
        });
    }
    sendFocusState(payload) {
        this.send({
            type: focus_1.SignalingMessageType.FocusState,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload,
            timestampMs: Date.now(),
        });
    }
    sendViewerOverride(payload) {
        this.send({
            type: focus_1.SignalingMessageType.ViewerOverride,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload,
            timestampMs: Date.now(),
        });
    }
    sendScreenMetaUpdate(payload) {
        this.send({
            type: focus_1.SignalingMessageType.ScreenMetaUpdate,
            senderId: this.clientId || '',
            sessionId: this.sessionId || '',
            payload,
            timestampMs: Date.now(),
        });
    }
    // ─── Getters ─────────────────────────────
    getClientId() {
        return this.clientId;
    }
    getSessionId() {
        return this.sessionId;
    }
    isConnected() {
        return this.connected;
    }
    // ─── Private ─────────────────────────────
    handleMessage(msg) {
        switch (msg.type) {
            case focus_1.SignalingMessageType.SessionCreated:
                if (msg.payload?.clientId) {
                    this.clientId = msg.payload.clientId;
                }
                if (msg.payload?.sessionId) {
                    this.sessionId = msg.payload.sessionId;
                }
                this.emit('session-created', msg.payload);
                break;
            case focus_1.SignalingMessageType.SessionJoined:
                this.sessionId = msg.payload?.sessionId;
                this.emit('session-joined', msg.payload);
                break;
            case focus_1.SignalingMessageType.SessionError:
                this.emit('session-error', msg.payload);
                break;
            case focus_1.SignalingMessageType.Offer:
                this.emit('offer', msg.payload);
                break;
            case focus_1.SignalingMessageType.Answer:
                this.emit('answer', msg.payload);
                break;
            case focus_1.SignalingMessageType.IceCandidate:
                this.emit('ice-candidate', msg.payload);
                break;
            case focus_1.SignalingMessageType.FocusChange:
                this.emit('focus-change', msg.payload);
                break;
            case focus_1.SignalingMessageType.FocusState:
                this.emit('focus-state', msg.payload);
                break;
            case focus_1.SignalingMessageType.ViewerOverride:
                this.emit('viewer-override', msg.payload);
                break;
            case focus_1.SignalingMessageType.ScreenMetaUpdate:
                this.emit('screen-meta-update', msg.payload);
                break;
            case focus_1.SignalingMessageType.JoinSession:
                this.emit('viewer-joined', msg.payload);
                break;
            case focus_1.SignalingMessageType.LeaveSession:
                this.emit('participant-left', msg.payload);
                break;
            default:
                this.emit('message', msg);
        }
    }
    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
        else {
            console.warn('[SignalingClient] Cannot send — not connected');
        }
    }
    attemptReconnect() {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.emit('reconnect-failed');
            return;
        }
        this.reconnectAttempts++;
        this.emit('reconnecting', this.reconnectAttempts);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.config.reconnectIntervalMs);
    }
}
exports.SignalingClient = SignalingClient;
//# sourceMappingURL=client.js.map