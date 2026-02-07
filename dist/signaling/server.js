"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingServer = void 0;
const ws_1 = __importDefault(require("ws"));
const uuid_1 = require("uuid");
const focus_1 = require("../shared/types/focus");
// ─────────────────────────────────────────────
// Signaling Server
// ─────────────────────────────────────────────
class SignalingServer {
    wss = null;
    clients = new Map();
    sessions = new Map();
    port;
    constructor(port = 8080) {
        this.port = port;
    }
    // ─── Lifecycle ───────────────────────────
    start() {
        this.wss = new ws_1.default.Server({ port: this.port });
        this.wss.on('connection', (ws) => {
            const clientId = (0, uuid_1.v4)();
            const client = {
                id: clientId,
                ws,
                sessionId: null,
                role: null,
                joinedAt: Date.now(),
            };
            this.clients.set(clientId, client);
            // Send client their ID
            this.send(ws, {
                type: focus_1.SignalingMessageType.SessionCreated,
                senderId: 'server',
                sessionId: '',
                payload: { clientId },
                timestampMs: Date.now(),
            });
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    this.handleMessage(clientId, msg);
                }
                catch (err) {
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
        console.log(`[Signaling] Server started on port ${this.port}`);
    }
    stop() {
        this.wss?.close();
        this.clients.clear();
        this.sessions.clear();
        console.log('[Signaling] Server stopped');
    }
    // ─── Message Handling ────────────────────
    handleMessage(clientId, msg) {
        const client = this.clients.get(clientId);
        if (!client)
            return;
        switch (msg.type) {
            case focus_1.SignalingMessageType.CreateSession:
                this.handleCreateSession(client, msg);
                break;
            case focus_1.SignalingMessageType.JoinSession:
                this.handleJoinSession(client, msg);
                break;
            case focus_1.SignalingMessageType.LeaveSession:
                this.handleLeaveSession(client);
                break;
            case focus_1.SignalingMessageType.Offer:
            case focus_1.SignalingMessageType.Answer:
            case focus_1.SignalingMessageType.IceCandidate:
                this.relayToSession(client, msg);
                break;
            case focus_1.SignalingMessageType.FocusChange:
            case focus_1.SignalingMessageType.FocusState:
                this.handleFocusEvent(client, msg);
                break;
            case focus_1.SignalingMessageType.PresenterControl:
                this.relayToSession(client, msg);
                break;
            case focus_1.SignalingMessageType.ViewerOverride:
                this.relayToPresenter(client, msg);
                break;
            case focus_1.SignalingMessageType.ScreenMetaUpdate:
                this.relayToSession(client, msg);
                break;
            default:
                console.warn(`[Signaling] Unknown message type: ${msg.type}`);
        }
    }
    // ─── Session Management ──────────────────
    handleCreateSession(client, msg) {
        const sessionId = (0, uuid_1.v4)();
        const session = {
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
            type: focus_1.SignalingMessageType.SessionCreated,
            senderId: 'server',
            sessionId,
            payload: { sessionId, role: 'presenter' },
            timestampMs: Date.now(),
        });
        console.log(`[Signaling] Session created: ${sessionId} by ${client.id}`);
    }
    handleJoinSession(client, msg) {
        const sessionId = msg.sessionId;
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.send(client.ws, {
                type: focus_1.SignalingMessageType.SessionError,
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
            type: focus_1.SignalingMessageType.SessionJoined,
            senderId: 'server',
            sessionId,
            payload: { sessionId, role: 'viewer' },
            timestampMs: Date.now(),
        });
        // Send current focus state for late joiner sync (§9 Edge Cases)
        if (session.lastFocusState) {
            this.send(client.ws, {
                type: focus_1.SignalingMessageType.FocusState,
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
                type: focus_1.SignalingMessageType.JoinSession,
                senderId: client.id,
                sessionId,
                payload: { viewerId: client.id },
                timestampMs: Date.now(),
            });
        }
        console.log(`[Signaling] Viewer ${client.id} joined session ${sessionId}`);
    }
    handleLeaveSession(client) {
        if (!client.sessionId)
            return;
        const session = this.sessions.get(client.sessionId);
        if (!session)
            return;
        if (client.role === 'presenter') {
            // End session when presenter leaves
            this.broadcastToSession(client.sessionId, {
                type: focus_1.SignalingMessageType.LeaveSession,
                senderId: 'server',
                sessionId: client.sessionId,
                payload: { reason: 'presenter_left' },
                timestampMs: Date.now(),
            });
            this.sessions.delete(client.sessionId);
            console.log(`[Signaling] Session ended: ${client.sessionId}`);
        }
        else {
            session.viewerIds.delete(client.id);
            // Notify presenter
            const presenter = this.clients.get(session.presenterId);
            if (presenter) {
                this.send(presenter.ws, {
                    type: focus_1.SignalingMessageType.LeaveSession,
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
    handleFocusEvent(client, msg) {
        if (!client.sessionId)
            return;
        const session = this.sessions.get(client.sessionId);
        if (!session)
            return;
        // Only presenter can emit focus events
        if (client.id !== session.presenterId)
            return;
        // Cache focus state for late joiners
        if (msg.type === focus_1.SignalingMessageType.FocusState || msg.type === focus_1.SignalingMessageType.FocusChange) {
            session.lastFocusState = msg.payload;
        }
        // Broadcast to all viewers
        this.broadcastToViewers(client.sessionId, msg);
    }
    // ─── Message Relay ───────────────────────
    relayToSession(sender, msg) {
        if (!sender.sessionId)
            return;
        this.broadcastToSession(sender.sessionId, msg, sender.id);
    }
    relayToPresenter(sender, msg) {
        if (!sender.sessionId)
            return;
        const session = this.sessions.get(sender.sessionId);
        if (!session)
            return;
        const presenter = this.clients.get(session.presenterId);
        if (presenter) {
            this.send(presenter.ws, msg);
        }
    }
    broadcastToSession(sessionId, msg, excludeId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        // Send to presenter (if not excluded)
        if (session.presenterId !== excludeId) {
            const presenter = this.clients.get(session.presenterId);
            if (presenter)
                this.send(presenter.ws, msg);
        }
        // Send to all viewers (if not excluded)
        for (const viewerId of session.viewerIds) {
            if (viewerId !== excludeId) {
                const viewer = this.clients.get(viewerId);
                if (viewer)
                    this.send(viewer.ws, msg);
            }
        }
    }
    broadcastToViewers(sessionId, msg) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        for (const viewerId of session.viewerIds) {
            const viewer = this.clients.get(viewerId);
            if (viewer)
                this.send(viewer.ws, msg);
        }
    }
    // ─── Disconnect Handling (§7) ────────────
    handleDisconnect(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            this.handleLeaveSession(client);
            this.clients.delete(clientId);
        }
        console.log(`[Signaling] Client disconnected: ${clientId}`);
    }
    // ─── Utilities ───────────────────────────
    send(ws, msg) {
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }
    /** Get server stats */
    getStats() {
        return {
            clients: this.clients.size,
            sessions: this.sessions.size,
            sessionDetails: Array.from(this.sessions.entries()).map(([id, session]) => ({
                id,
                viewers: session.viewerIds.size,
            })),
        };
    }
}
exports.SignalingServer = SignalingServer;
// ─────────────────────────────────────────────
// Entry point: run as standalone
// ─────────────────────────────────────────────
if (require.main === module) {
    const port = parseInt(process.env.SIGNAL_PORT || '8080', 10);
    const server = new SignalingServer(port);
    server.start();
    process.on('SIGINT', () => {
        server.stop();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        server.stop();
        process.exit(0);
    });
}
//# sourceMappingURL=server.js.map