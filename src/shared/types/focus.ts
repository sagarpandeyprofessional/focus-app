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

// ─────────────────────────────────────────────
// Screen & Display
// ─────────────────────────────────────────────

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
  readonly label: string;          // e.g., "Main Monitor", "External Left"
  readonly bounds: DisplayBounds;
  readonly isActive: boolean;      // currently the focused screen
  readonly bitrateKbps: number;
  readonly fps: number;
}

// ─────────────────────────────────────────────
// Intent Signals (from Focus_Algorithm.md §3)
// ─────────────────────────────────────────────

/** Signal types ordered by priority (high → low) */
export enum SignalType {
  Manual        = 'manual',
  Click         = 'click',
  DragStart     = 'drag_start',
  DragEnd       = 'drag_end',
  DoubleClick   = 'double_click',
  WindowFocus   = 'window_focus',
  Typing        = 'typing',
  Scroll        = 'scroll',
  Gesture       = 'gesture',
  Hover         = 'hover',
  PointerMove   = 'pointer_move',
}

/** Priority ranking: lower number = higher priority */
export const SIGNAL_PRIORITY: Record<SignalType, number> = {
  [SignalType.Manual]:      0,
  [SignalType.Click]:       1,
  [SignalType.DragStart]:   1,
  [SignalType.DragEnd]:     2,
  [SignalType.DoubleClick]: 1,
  [SignalType.WindowFocus]: 3,
  [SignalType.Typing]:      4,
  [SignalType.Scroll]:      5,
  [SignalType.Gesture]:     6,
  [SignalType.Hover]:       7,
  [SignalType.PointerMove]: 8,
};

/** Base confidence values from Focus_Algorithm.md §7.1 */
export const BASE_CONFIDENCE: Record<SignalType, number> = {
  [SignalType.Manual]:      1.00,
  [SignalType.Click]:       0.95,
  [SignalType.DragStart]:   0.95,
  [SignalType.DragEnd]:     0.85,
  [SignalType.DoubleClick]: 0.95,
  [SignalType.WindowFocus]: 0.90,
  [SignalType.Typing]:      0.90,
  [SignalType.Scroll]:      0.85,
  [SignalType.Gesture]:     0.85,
  [SignalType.Hover]:       0.70,
  [SignalType.PointerMove]: 0.40,
};

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

// ─────────────────────────────────────────────
// Focus Events (from Focus_Algorithm.md §4)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Focus Algorithm Configuration (§12)
// ─────────────────────────────────────────────

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

export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
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
// Focus Algorithm Internal State (§13)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Presenter Controls (from §11)
// ─────────────────────────────────────────────

export enum PresenterControlAction {
  ToggleAutoFocus  = 'toggle_auto_focus',
  ToggleFreeze     = 'toggle_freeze',
  ManualSelect     = 'manual_select',
  ClearManual      = 'clear_manual',
}

export interface PresenterControl {
  readonly action: PresenterControlAction;
  readonly screenId?: ScreenId;
  readonly timestampMs: number;
}

// ─────────────────────────────────────────────
// Viewer State (from UX_Flows.md)
// ─────────────────────────────────────────────

export enum ViewerMode {
  AutoFollow = 'auto_follow',
  Pinned     = 'pinned',
}

export interface ViewerOverride {
  readonly viewerId: string;
  readonly mode: ViewerMode;
  readonly pinnedScreenId?: ScreenId;
  readonly timestampMs: number;
}

// ─────────────────────────────────────────────
// Session (from MVP_PRD.md)
// ─────────────────────────────────────────────

export interface Session {
  readonly sessionId: string;
  readonly presenterId: string;
  readonly screens: ScreenMeta[];
  readonly viewers: string[];
  readonly createdAt: number;
}

// ─────────────────────────────────────────────
// Signaling Messages
// ─────────────────────────────────────────────

export enum SignalingMessageType {
  // Session lifecycle
  CreateSession    = 'create_session',
  JoinSession      = 'join_session',
  LeaveSession     = 'leave_session',
  SessionCreated   = 'session_created',
  SessionJoined    = 'session_joined',
  SessionError     = 'session_error',

  // WebRTC negotiation
  Offer            = 'offer',
  Answer           = 'answer',
  IceCandidate     = 'ice_candidate',

  // Focus control
  FocusChange      = 'focus_change',
  FocusState       = 'focus_state',
  PresenterControl = 'presenter_control',
  ViewerOverride   = 'viewer_override',

  // Screen metadata
  ScreenMetaUpdate = 'screen_meta_update',
}

export interface SignalingMessage {
  readonly type: SignalingMessageType;
  readonly senderId: string;
  readonly sessionId: string;
  readonly payload: unknown;
  readonly timestampMs: number;
}

// ─────────────────────────────────────────────
// WebRTC Track Metadata
// ─────────────────────────────────────────────

export interface TrackMeta {
  readonly trackId: string;
  readonly screenId: ScreenId;
  readonly kind: 'video' | 'audio';
  readonly isActive: boolean;
}

// ─────────────────────────────────────────────
// Bandwidth Strategy (from WebRTC_Implementation.md §4)
// ─────────────────────────────────────────────

export interface BitrateProfile {
  readonly activeMaxBitrateKbps: number;
  readonly activeMaxFps: number;
  readonly inactiveMaxBitrateKbps: number;
  readonly inactiveMaxFps: number;
}

export const DEFAULT_BITRATE_PROFILE: BitrateProfile = {
  activeMaxBitrateKbps: 4000,
  activeMaxFps: 30,
  inactiveMaxBitrateKbps: 500,
  inactiveMaxFps: 5,
};
