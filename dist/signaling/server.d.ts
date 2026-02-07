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
export declare class SignalingServer {
    private wss;
    private clients;
    private sessions;
    private port;
    constructor(port?: number);
    start(): void;
    stop(): void;
    private handleMessage;
    private handleCreateSession;
    private handleJoinSession;
    private handleLeaveSession;
    private handleFocusEvent;
    private relayToSession;
    private relayToPresenter;
    private broadcastToSession;
    private broadcastToViewers;
    private handleDisconnect;
    private send;
    /** Get server stats */
    getStats(): {
        clients: number;
        sessions: number;
        sessionDetails: Array<{
            id: string;
            viewers: number;
        }>;
    };
}
//# sourceMappingURL=server.d.ts.map