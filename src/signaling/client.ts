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
import {
  SignalingMessage,
  SignalingMessageType,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export interface SignalingClientConfig {
  serverUrl: string;
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
}

const DEFAULT_CLIENT_CONFIG: SignalingClientConfig = {
  serverUrl: 'ws://localhost:8080',
  reconnectIntervalMs: 2000,
  maxReconnectAttempts: 10,
};

// ─────────────────────────────────────────────
// Signaling Client
// ─────────────────────────────────────────────

export class SignalingClient extends EventEmitter {
  private config: SignalingClientConfig;
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected: boolean = false;

  constructor(config: Partial<SignalingClientConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }

  // ─── Connection Lifecycle ────────────────

  connect(): void {
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
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as SignalingMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.warn('[SignalingClient] Invalid message:', err);
        }
      };
    } catch (err) {
      this.emit('error', err);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  // ─── Session Actions ─────────────────────

  createSession(): void {
    this.send({
      type: SignalingMessageType.CreateSession,
      senderId: this.clientId || '',
      sessionId: '',
      payload: {},
      timestampMs: Date.now(),
    });
  }

  joinSession(sessionId: string): void {
    this.send({
      type: SignalingMessageType.JoinSession,
      senderId: this.clientId || '',
      sessionId,
      payload: {},
      timestampMs: Date.now(),
    });
  }

  leaveSession(): void {
    if (!this.sessionId) return;

    this.send({
      type: SignalingMessageType.LeaveSession,
      senderId: this.clientId || '',
      sessionId: this.sessionId,
      payload: {},
      timestampMs: Date.now(),
    });

    this.sessionId = null;
  }

  // ─── WebRTC Signaling ────────────────────

  sendOffer(offer: RTCSessionDescriptionInit, targetId?: string): void {
    this.send({
      type: SignalingMessageType.Offer,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload: { offer, targetId },
      timestampMs: Date.now(),
    });
  }

  sendAnswer(answer: RTCSessionDescriptionInit, targetId?: string): void {
    this.send({
      type: SignalingMessageType.Answer,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload: { answer, targetId },
      timestampMs: Date.now(),
    });
  }

  sendIceCandidate(candidate: RTCIceCandidateInit, targetId?: string): void {
    this.send({
      type: SignalingMessageType.IceCandidate,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload: { candidate, targetId },
      timestampMs: Date.now(),
    });
  }

  // ─── Focus Events ────────────────────────

  sendFocusEvent(payload: unknown): void {
    this.send({
      type: SignalingMessageType.FocusChange,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload,
      timestampMs: Date.now(),
    });
  }

  sendFocusState(payload: unknown): void {
    this.send({
      type: SignalingMessageType.FocusState,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload,
      timestampMs: Date.now(),
    });
  }

  sendViewerOverride(payload: unknown): void {
    this.send({
      type: SignalingMessageType.ViewerOverride,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload,
      timestampMs: Date.now(),
    });
  }

  sendScreenMetaUpdate(payload: unknown): void {
    this.send({
      type: SignalingMessageType.ScreenMetaUpdate,
      senderId: this.clientId || '',
      sessionId: this.sessionId || '',
      payload,
      timestampMs: Date.now(),
    });
  }

  // ─── Getters ─────────────────────────────

  getClientId(): string | null {
    return this.clientId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── Private ─────────────────────────────

  private handleMessage(msg: SignalingMessage): void {
    switch (msg.type) {
      case SignalingMessageType.SessionCreated:
        if ((msg.payload as any)?.clientId) {
          this.clientId = (msg.payload as any).clientId;
        }
        if ((msg.payload as any)?.sessionId) {
          this.sessionId = (msg.payload as any).sessionId;
        }
        this.emit('session-created', msg.payload);
        break;

      case SignalingMessageType.SessionJoined:
        this.sessionId = (msg.payload as any)?.sessionId;
        this.emit('session-joined', msg.payload);
        break;

      case SignalingMessageType.SessionError:
        this.emit('session-error', msg.payload);
        break;

      case SignalingMessageType.Offer:
        this.emit('offer', msg.payload);
        break;

      case SignalingMessageType.Answer:
        this.emit('answer', msg.payload);
        break;

      case SignalingMessageType.IceCandidate:
        this.emit('ice-candidate', msg.payload);
        break;

      case SignalingMessageType.FocusChange:
        this.emit('focus-change', msg.payload);
        break;

      case SignalingMessageType.FocusState:
        this.emit('focus-state', msg.payload);
        break;

      case SignalingMessageType.ViewerOverride:
        this.emit('viewer-override', msg.payload);
        break;

      case SignalingMessageType.ScreenMetaUpdate:
        this.emit('screen-meta-update', msg.payload);
        break;

      case SignalingMessageType.JoinSession:
        this.emit('viewer-joined', msg.payload);
        break;

      case SignalingMessageType.LeaveSession:
        this.emit('participant-left', msg.payload);
        break;

      default:
        this.emit('message', msg);
    }
  }

  private send(msg: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[SignalingClient] Cannot send — not connected');
    }
  }

  private attemptReconnect(): void {
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
