"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BITRATE_PROFILE = exports.SignalingMessageType = exports.ViewerMode = exports.PresenterControlAction = exports.DEFAULT_FOCUS_CONFIG = exports.BASE_CONFIDENCE = exports.SIGNAL_PRIORITY = exports.SignalType = void 0;
// ─────────────────────────────────────────────
// Intent Signals (from Focus_Algorithm.md §3)
// ─────────────────────────────────────────────
/** Signal types ordered by priority (high → low) */
var SignalType;
(function (SignalType) {
    SignalType["Manual"] = "manual";
    SignalType["Click"] = "click";
    SignalType["DragStart"] = "drag_start";
    SignalType["DragEnd"] = "drag_end";
    SignalType["DoubleClick"] = "double_click";
    SignalType["WindowFocus"] = "window_focus";
    SignalType["Typing"] = "typing";
    SignalType["Scroll"] = "scroll";
    SignalType["Gesture"] = "gesture";
    SignalType["Hover"] = "hover";
    SignalType["PointerMove"] = "pointer_move";
})(SignalType || (exports.SignalType = SignalType = {}));
/** Priority ranking: lower number = higher priority */
exports.SIGNAL_PRIORITY = {
    [SignalType.Manual]: 0,
    [SignalType.Click]: 1,
    [SignalType.DragStart]: 1,
    [SignalType.DragEnd]: 2,
    [SignalType.DoubleClick]: 1,
    [SignalType.WindowFocus]: 3,
    [SignalType.Typing]: 4,
    [SignalType.Scroll]: 5,
    [SignalType.Gesture]: 6,
    [SignalType.Hover]: 7,
    [SignalType.PointerMove]: 8,
};
/** Base confidence values from Focus_Algorithm.md §7.1 */
exports.BASE_CONFIDENCE = {
    [SignalType.Manual]: 1.00,
    [SignalType.Click]: 0.95,
    [SignalType.DragStart]: 0.95,
    [SignalType.DragEnd]: 0.85,
    [SignalType.DoubleClick]: 0.95,
    [SignalType.WindowFocus]: 0.90,
    [SignalType.Typing]: 0.90,
    [SignalType.Scroll]: 0.85,
    [SignalType.Gesture]: 0.85,
    [SignalType.Hover]: 0.70,
    [SignalType.PointerMove]: 0.40,
};
exports.DEFAULT_FOCUS_CONFIG = {
    maxScreens: 3,
    switchThreshold: 0.80,
    stayThreshold: 0.50,
    cooldownMs: 500,
    idleMs: 2000,
    idleMotionPxPerS: 5,
    clickDwellMs: 300,
    typingDwellMs: 300,
    scrollDwellMs: 300,
    hoverDwellMs: 500,
    movementDwellMs: 800,
    movementSpeedHighPxPerS: 1200,
    hoverRadiusPx: 8,
    resumeGraceMs: 300,
};
// ─────────────────────────────────────────────
// Presenter Controls (from §11)
// ─────────────────────────────────────────────
var PresenterControlAction;
(function (PresenterControlAction) {
    PresenterControlAction["ToggleAutoFocus"] = "toggle_auto_focus";
    PresenterControlAction["ToggleFreeze"] = "toggle_freeze";
    PresenterControlAction["ManualSelect"] = "manual_select";
    PresenterControlAction["ClearManual"] = "clear_manual";
})(PresenterControlAction || (exports.PresenterControlAction = PresenterControlAction = {}));
// ─────────────────────────────────────────────
// Viewer State (from UX_Flows.md)
// ─────────────────────────────────────────────
var ViewerMode;
(function (ViewerMode) {
    ViewerMode["AutoFollow"] = "auto_follow";
    ViewerMode["Pinned"] = "pinned";
})(ViewerMode || (exports.ViewerMode = ViewerMode = {}));
// ─────────────────────────────────────────────
// Signaling Messages
// ─────────────────────────────────────────────
var SignalingMessageType;
(function (SignalingMessageType) {
    // Session lifecycle
    SignalingMessageType["CreateSession"] = "create_session";
    SignalingMessageType["JoinSession"] = "join_session";
    SignalingMessageType["LeaveSession"] = "leave_session";
    SignalingMessageType["SessionCreated"] = "session_created";
    SignalingMessageType["SessionJoined"] = "session_joined";
    SignalingMessageType["SessionError"] = "session_error";
    // WebRTC negotiation
    SignalingMessageType["Offer"] = "offer";
    SignalingMessageType["Answer"] = "answer";
    SignalingMessageType["IceCandidate"] = "ice_candidate";
    // Focus control
    SignalingMessageType["FocusChange"] = "focus_change";
    SignalingMessageType["FocusState"] = "focus_state";
    SignalingMessageType["PresenterControl"] = "presenter_control";
    SignalingMessageType["ViewerOverride"] = "viewer_override";
    // Screen metadata
    SignalingMessageType["ScreenMetaUpdate"] = "screen_meta_update";
})(SignalingMessageType || (exports.SignalingMessageType = SignalingMessageType = {}));
exports.DEFAULT_BITRATE_PROFILE = {
    activeMaxBitrateKbps: 4000,
    activeMaxFps: 30,
    inactiveMaxBitrateKbps: 500,
    inactiveMaxFps: 5,
};
//# sourceMappingURL=focus.js.map