/**
 * @file    signaling/server.ts
 * @purpose WebSocket signaling server for FOCUS sessions.
 *          Handles session lifecycle, WebRTC offer/answer relay,
 *          ICE candidate exchange, and focus event distribution.
 * @owner   FOCUS Core Team
 * @depends ws, uuid, shared/types/focus.ts
 *
 * This server does NOT process media — it only relays signaling messages.
 * Focus events are forwarded to all session participants.
 * Latency target: <50ms (§6 Build Plan).
 */

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  SignalingMessage,
  SignalingMessageType,
  Session,
  FocusStateSnapshot,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
  role: 'presenter' | 'viewer' | null;
  joinedAt: number;
}

interface ManagedSession {
  session: Session;
  presenterId: string;
  viewerIds: Set<string>;
  lastFocusState: FocusStateSnapshot | null;
}

// ─────────────────────────────────────────────
// Signaling Server
// ─────────────────────────────────────────────

export class SignalingServer {
  private wss: WebSocket.Server | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private sessions: Map<string, ManagedSession> = new Map();
  private port: number;
  private host: string;

  constructor(port: number = 8080, host: string = '0.0.0.0') {
    this.port = port;
    this.host = host;
  }

  // ─── Lifecycle ───────────────────────────

  start(): void {
    this.wss = new WebSocket.Server({ port: this.port, host: this.host });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      const client: ConnectedClient = {
        id: clientId,
        ws,
        sessionId: null,
        role: null,
        joinedAt: Date.now(),
      };

      this.clients.set(clientId, client);

      // Send client their ID
      this.send(ws, {
        type: SignalingMessageType.SessionCreated,
        senderId: 'server',
        sessionId: '',
        payload: { clientId },
        timestampMs: Date.now(),
      });

      ws.on('message', (raw: WebSocket.Data) => {
        try {
          const msg = JSON.parse(raw.toString()) as SignalingMessage;
          this.handleMessage(clientId, msg);
        } catch (err) {
          console.error(`[Signaling] Invalid message from ${clientId}:`, err);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (err) => {
        console.error(`[Signaling] Client ${clientId} error:`, err);
      });

      console.log(`[Signaling] Client connected: ${clientId}`);
    });

    console.log(`[Signaling] Server started on ${this.host}:${this.port}`);
  }

  stop(): void {
    this.wss?.close();
    this.clients.clear();
    this.sessions.clear();
    console.log('[Signaling] Server stopped');
  }

  // ─── Message Handling ────────────────────

  private handleMessage(clientId: string, msg: SignalingMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case SignalingMessageType.CreateSession:
        this.handleCreateSession(client, msg);
        break;

      case SignalingMessageType.JoinSession:
        this.handleJoinSession(client, msg);
        break;

      case SignalingMessageType.LeaveSession:
        this.handleLeaveSession(client);
        break;

      case SignalingMessageType.Offer:
      case SignalingMessageType.Answer:
      case SignalingMessageType.IceCandidate:
        this.relayToSession(client, msg);
        break;

      case SignalingMessageType.FocusChange:
      case SignalingMessageType.FocusState:
        this.handleFocusEvent(client, msg);
        break;

      case SignalingMessageType.PresenterControl:
        this.relayToSession(client, msg);
        break;

      case SignalingMessageType.ViewerOverride:
        this.relayToPresenter(client, msg);
        break;

      case SignalingMessageType.ScreenMetaUpdate:
        this.relayToSession(client, msg);
        break;

      default:
        console.warn(`[Signaling] Unknown message type: ${msg.type}`);
    }
  }

  // ─── Session Management ──────────────────

  private handleCreateSession(
    client: ConnectedClient,
    msg: SignalingMessage,
  ): void {
    const sessionId = uuidv4();

    const session: ManagedSession = {
      session: {
        sessionId,
        presenterId: client.id,
        screens: [],
        viewers: [],
        createdAt: Date.now(),
      },
      presenterId: client.id,
      viewerIds: new Set(),
      lastFocusState: null,
    };

    this.sessions.set(sessionId, session);
    client.sessionId = sessionId;
    client.role = 'presenter';

    this.send(client.ws, {
      type: SignalingMessageType.SessionCreated,
      senderId: 'server',
      sessionId,
      payload: { sessionId, role: 'presenter' },
      timestampMs: Date.now(),
    });

    console.log(`[Signaling] Session created: ${sessionId} by ${client.id}`);
  }

  private handleJoinSession(
    client: ConnectedClient,
    msg: SignalingMessage,
  ): void {
    const sessionId = msg.sessionId;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.send(client.ws, {
        type: SignalingMessageType.SessionError,
        senderId: 'server',
        sessionId,
        payload: { error: 'Session not found' },
        timestampMs: Date.now(),
      });
      return;
    }

    session.viewerIds.add(client.id);
    client.sessionId = sessionId;
    client.role = 'viewer';

    // Send join confirmation
    this.send(client.ws, {
      type: SignalingMessageType.SessionJoined,
      senderId: 'server',
      sessionId,
      payload: { sessionId, role: 'viewer' },
      timestampMs: Date.now(),
    });

    // Send current focus state for late joiner sync (§9 Edge Cases)
    if (session.lastFocusState) {
      this.send(client.ws, {
        type: SignalingMessageType.FocusState,
        senderId: session.presenterId,
        sessionId,
        payload: session.lastFocusState,
        timestampMs: Date.now(),
      });
    }

    // Notify presenter of new viewer
    const presenter = this.clients.get(session.presenterId);
    if (presenter) {
      this.send(presenter.ws, {
        type: SignalingMessageType.JoinSession,
        senderId: client.id,
        sessionId,
        payload: { viewerId: client.id },
        timestampMs: Date.now(),
      });
    }

    console.log(
      `[Signaling] Viewer ${client.id} joined session ${sessionId}`,
    );
  }

  private handleLeaveSession(client: ConnectedClient): void {
    if (!client.sessionId) return;

    const session = this.sessions.get(client.sessionId);
    if (!session) return;

    if (client.role === 'presenter') {
      // End session when presenter leaves
      this.broadcastToSession(client.sessionId, {
        type: SignalingMessageType.LeaveSession,
        senderId: 'server',
        sessionId: client.sessionId,
        payload: { reason: 'presenter_left' },
        timestampMs: Date.now(),
      });
      this.sessions.delete(client.sessionId);
      console.log(`[Signaling] Session ended: ${client.sessionId}`);
    } else {
      session.viewerIds.delete(client.id);

      // Notify presenter
      const presenter = this.clients.get(session.presenterId);
      if (presenter) {
        this.send(presenter.ws, {
          type: SignalingMessageType.LeaveSession,
          senderId: client.id,
          sessionId: client.sessionId,
          payload: { viewerId: client.id },
          timestampMs: Date.now(),
        });
      }
    }

    client.sessionId = null;
    client.role = null;
  }

  // ─── Focus Event Handling ────────────────

  private handleFocusEvent(
    client: ConnectedClient,
    msg: SignalingMessage,
  ): void {
    if (!client.sessionId) return;
    const session = this.sessions.get(client.sessionId);
    if (!session) return;

    // Only presenter can emit focus events
    if (client.id !== session.presenterId) return;

    // Cache focus state for late joiners
    if (msg.type === SignalingMessageType.FocusState || msg.type === SignalingMessageType.FocusChange) {
      session.lastFocusState = msg.payload as FocusStateSnapshot;
    }

    // Broadcast to all viewers
    this.broadcastToViewers(client.sessionId, msg);
  }

  // ─── Message Relay ───────────────────────

  private relayToSession(
    sender: ConnectedClient,
    msg: SignalingMessage,
  ): void {
    if (!sender.sessionId) return;
    this.broadcastToSession(sender.sessionId, msg, sender.id);
  }

  private relayToPresenter(
    sender: ConnectedClient,
    msg: SignalingMessage,
  ): void {
    if (!sender.sessionId) return;
    const session = this.sessions.get(sender.sessionId);
    if (!session) return;

    const presenter = this.clients.get(session.presenterId);
    if (presenter) {
      this.send(presenter.ws, msg);
    }
  }

  private broadcastToSession(
    sessionId: string,
    msg: SignalingMessage,
    excludeId?: string,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Send to presenter (if not excluded)
    if (session.presenterId !== excludeId) {
      const presenter = this.clients.get(session.presenterId);
      if (presenter) this.send(presenter.ws, msg);
    }

    // Send to all viewers (if not excluded)
    for (const viewerId of session.viewerIds) {
      if (viewerId !== excludeId) {
        const viewer = this.clients.get(viewerId);
        if (viewer) this.send(viewer.ws, msg);
      }
    }
  }

  private broadcastToViewers(
    sessionId: string,
    msg: SignalingMessage,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const viewerId of session.viewerIds) {
      const viewer = this.clients.get(viewerId);
      if (viewer) this.send(viewer.ws, msg);
    }
  }

  // ─── Disconnect Handling (§7) ────────────

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.handleLeaveSession(client);
      this.clients.delete(clientId);
    }
    console.log(`[Signaling] Client disconnected: ${clientId}`);
  }

  // ─── Utilities ───────────────────────────

  private send(ws: WebSocket, msg: SignalingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Get server stats */
  getStats(): {
    clients: number;
    sessions: number;
    sessionDetails: Array<{ id: string; viewers: number }>;
  } {
    return {
      clients: this.clients.size,
      sessions: this.sessions.size,
      sessionDetails: Array.from(this.sessions.entries()).map(
        ([id, session]) => ({
          id,
          viewers: session.viewerIds.size,
        }),
      ),
    };
  }
}

// ─────────────────────────────────────────────
// Entry point: run as standalone
// ─────────────────────────────────────────────

if (require.main === module) {
  const port = parseInt(process.env.SIGNAL_PORT || '8080', 10);
  const host = process.env.SIGNAL_HOST || '0.0.0.0';
  const server = new SignalingServer(port, host);
  server.start();

  console.log(`[Signaling] Tip: Clients connect via ws://<YOUR_PUBLIC_IP>:${port}`);
  console.log(`[Signaling] For remote access: use ngrok, Cloudflare Tunnel, or deploy to a VPS.`);

  process.on('SIGINT', () => {
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });
}
