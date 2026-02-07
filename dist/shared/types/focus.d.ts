/**
 * @file    types/focus.ts
 * @purpose Core domain types for the FOCUS multi-screen sharing system.
 * @owner   FOCUS Core Team
 * @depends None (leaf module)
 *
 * All types here are derived from the authoritative spec documents:
 *   - Focus_Algorithm.md (signal types, confidence, events)
 *   - MVP_PRD.md (session, presenter, viewer)
 *   - WebRTC_Implementation.md (track metadata)
 *   - UX_Flows.md (viewer modes, transitions)
 */
/** Stable identifier for a captured display track (e.g., "screen_1") */
export type ScreenId = string;
/** Physical display geometry in unified coordinate space */
export interface DisplayBounds {
    readonly screenId: ScreenId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly dpiScale: number;
}
/** Metadata about a shared screen */
export interface ScreenMeta {
    readonly screenId: ScreenId;
    readonly label: string;
    readonly bounds: DisplayBounds;
    readonly isActive: boolean;
    readonly bitrateKbps: number;
    readonly fps: number;
}
/** Signal types ordered by priority (high → low) */
export declare enum SignalType {
    Manual = "manual",
    Click = "click",
    DragStart = "drag_start",
    DragEnd = "drag_end",
    DoubleClick = "double_click",
    WindowFocus = "window_focus",
    Typing = "typing",
    Scroll = "scroll",
    Gesture = "gesture",
    Hover = "hover",
    PointerMove = "pointer_move"
}
/** Priority ranking: lower number = higher priority */
export declare const SIGNAL_PRIORITY: Record<SignalType, number>;
/** Base confidence values from Focus_Algorithm.md §7.1 */
export declare const BASE_CONFIDENCE: Record<SignalType, number>;
/** Raw interaction event from the OS */
export interface IntentSignal {
    readonly type: SignalType;
    readonly screenId: ScreenId;
    readonly x: number;
    readonly y: number;
    readonly timestampMs: number;
    /** Optional: speed in px/s for pointer movement */
    readonly speedPxPerS?: number;
    /** Optional: associated window display for window focus events */
    readonly windowDisplayId?: ScreenId;
}
/** Emitted when the active screen changes */
export interface FocusChangeEvent {
    readonly type: 'focus_change';
    readonly sessionId: string;
    readonly screenId: ScreenId;
    readonly reason: SignalType;
    readonly confidence: number;
    readonly dwellMs: number;
    readonly sequence: number;
    readonly timestampMs: number;
}
/** Snapshot for late joiners / resync */
export interface FocusStateSnapshot {
    readonly type: 'focus_state';
    readonly activeScreenId: ScreenId;
    readonly mode: 'auto' | 'manual' | 'frozen';
    readonly frozen: boolean;
    readonly sequence: number;
    readonly timestampMs: number;
}
export interface FocusConfig {
    readonly maxScreens: number;
    readonly switchThreshold: number;
    readonly stayThreshold: number;
    readonly cooldownMs: number;
    readonly idleMs: number;
    readonly idleMotionPxPerS: number;
    readonly clickDwellMs: number;
    readonly typingDwellMs: number;
    readonly scrollDwellMs: number;
    readonly hoverDwellMs: number;
    readonly movementDwellMs: number;
    readonly movementSpeedHighPxPerS: number;
    readonly hoverRadiusPx: number;
    readonly resumeGraceMs: number;
}
export declare const DEFAULT_FOCUS_CONFIG: FocusConfig;
export interface FocusAlgorithmState {
    activeScreenId: ScreenId | null;
    frozen: boolean;
    autoEnabled: boolean;
    manualOverride: ScreenId | null;
    lastSwitchTs: number;
    candidateScreenId: ScreenId | null;
    candidateSinceTs: number;
    lastActivityTs: number;
    sequence: number;
}
export declare enum PresenterControlAction {
    ToggleAutoFocus = "toggle_auto_focus",
    ToggleFreeze = "toggle_freeze",
    ManualSelect = "manual_select",
    ClearManual = "clear_manual"
}
export interface PresenterControl {
    readonly action: PresenterControlAction;
    readonly screenId?: ScreenId;
    readonly timestampMs: number;
}
export declare enum ViewerMode {
    AutoFollow = "auto_follow",
    Pinned = "pinned"
}
export interface ViewerOverride {
    readonly viewerId: string;
    readonly mode: ViewerMode;
    readonly pinnedScreenId?: ScreenId;
    readonly timestampMs: number;
}
export interface Session {
    readonly sessionId: string;
    readonly presenterId: string;
    readonly screens: ScreenMeta[];
    readonly viewers: string[];
    readonly createdAt: number;
}
export declare enum SignalingMessageType {
    CreateSession = "create_session",
    JoinSession = "join_session",
    LeaveSession = "leave_session",
    SessionCreated = "session_created",
    SessionJoined = "session_joined",
    SessionError = "session_error",
    Offer = "offer",
    Answer = "answer",
    IceCandidate = "ice_candidate",
    FocusChange = "focus_change",
    FocusState = "focus_state",
    PresenterControl = "presenter_control",
    ViewerOverride = "viewer_override",
    ScreenMetaUpdate = "screen_meta_update"
}
export interface SignalingMessage {
    readonly type: SignalingMessageType;
    readonly senderId: string;
    readonly sessionId: string;
    readonly payload: unknown;
    readonly timestampMs: number;
}
export interface TrackMeta {
    readonly trackId: string;
    readonly screenId: ScreenId;
    readonly kind: 'video' | 'audio';
    readonly isActive: boolean;
}
export interface BitrateProfile {
    readonly activeMaxBitrateKbps: number;
    readonly activeMaxFps: number;
    readonly inactiveMaxBitrateKbps: number;
    readonly inactiveMaxFps: number;
}
export declare const DEFAULT_BITRATE_PROFILE: BitrateProfile;
//# sourceMappingURL=focus.d.ts.map