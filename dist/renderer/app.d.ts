/**
 * @file    renderer/app.ts
 * @purpose Main renderer application for FOCUS.
 *          Orchestrates UI views, focus algorithm, WebRTC, and signaling.
 * @owner   FOCUS Core Team
 * @depends All modules (focus-algorithm, intent-engine, screen-capture,
 *          webrtc-transport, signaling-client)
 *
 * View flow:
 *   Landing → Screen Select → Presenter Session
 *   Landing → (enter ID) → Viewer Session
 */
type ScreenId = string;
declare enum SignalType {
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
declare enum PresenterControlAction {
    ToggleAutoFocus = "toggle_auto_focus",
    ToggleFreeze = "toggle_freeze",
    ManualSelect = "manual_select",
    ClearManual = "clear_manual"
}
declare enum ViewerMode {
    AutoFollow = "auto_follow",
    Pinned = "pinned"
}
declare const ICE_SERVERS: RTCIceServer[];
interface FocusChangeEvent {
    type: 'focus_change';
    sessionId: string;
    screenId: ScreenId;
    reason: string;
    confidence: number;
    dwellMs: number;
    sequence: number;
    timestampMs: number;
}
interface FocusStateSnapshot {
    type: 'focus_state';
    activeScreenId: ScreenId;
    mode: 'auto' | 'manual' | 'frozen';
    frozen: boolean;
    sequence: number;
    timestampMs: number;
}
declare const BASE_CONFIDENCE: Record<string, number>;
declare const DEFAULT_CONFIG: {
    maxScreens: number;
    switchThreshold: number;
    stayThreshold: number;
    cooldownMs: number;
    idleMs: number;
    idleMotionPxPerS: number;
    clickDwellMs: number;
    typingDwellMs: number;
    scrollDwellMs: number;
    hoverDwellMs: number;
    movementDwellMs: number;
    movementSpeedHighPxPerS: number;
    hoverRadiusPx: number;
    resumeGraceMs: number;
};
declare class FocusEngine {
    private activeScreenId;
    private frozen;
    private autoEnabled;
    private manualOverride;
    private lastSwitchTs;
    private candidateScreenId;
    private candidateSinceTs;
    private lastActivityTs;
    private sequence;
    private displays;
    private onFocusChangeCb;
    private sessionId;
    constructor(sessionId: string);
    setDisplays(displays: Array<{
        screenId: ScreenId;
        x: number;
        y: number;
        width: number;
        height: number;
    }>): void;
    onFocusChange(cb: (e: FocusChangeEvent) => void): void;
    getActiveScreen(): ScreenId | null;
    isFrozen(): boolean;
    isAutoEnabled(): boolean;
    processSignal(type: string, screenId: ScreenId, now: number, speedPxPerS?: number): void;
    handleControl(action: string, screenId?: ScreenId): void;
    getState(): FocusStateSnapshot;
    private setActive;
    private getDwellMs;
}
interface AppState {
    currentView: 'landing' | 'screen-select' | 'presenter' | 'viewer';
    role: 'none' | 'presenter' | 'viewer';
    sessionId: string | null;
    clientId: string | null;
    serverUrl: string;
    selectedScreens: Array<{
        screenId: ScreenId;
        sourceId: string;
        label: string;
        bounds: any;
    }>;
    captures: Map<ScreenId, MediaStream>;
    focusEngine: FocusEngine | null;
    viewerMode: ViewerMode;
    viewerActiveScreen: ScreenId | null;
    viewerPinnedScreen: ScreenId | null;
    viewerCount: number;
    ws: WebSocket | null;
    peerConnection: RTCPeerConnection | null;
    intentPollTimer: number | null;
    pipTimer: number | null;
}
declare const state: AppState;
declare const $: (sel: string) => HTMLElement;
declare const $$: (sel: string) => NodeListOf<Element>;
declare function showView(viewName: string): void;
/** Read server URL from UI input and normalize it */
declare function getServerUrl(): string;
declare function connectSignaling(url?: string): Promise<void>;
declare function sendSignaling(type: string, payload?: any): void;
declare function handleSignalingMessage(msg: any): void;
declare function startPresenterFlow(): Promise<void>;
declare function populateScreenSelection(): Promise<void>;
declare function toggleScreenSelection(card: HTMLElement): void;
declare function updateStartButton(): void;
declare function startSharing(): Promise<void>;
declare function onSessionCreated(): void;
declare function renderPresenterView(): void;
declare function startIntentDetection(): void;
declare function attributeCursorToScreen(x: number, y: number): ScreenId | null;
declare function onPresenterFocusChange(event: FocusChangeEvent): void;
declare function updatePresenterActiveScreen(screenId: ScreenId): void;
declare function updateDebugPanel(event: FocusChangeEvent): void;
declare function updatePresenterControls(): void;
declare function updateViewerCount(): void;
declare function joinAsViewer(sessionId: string): Promise<void>;
declare function onSessionJoined(): void;
declare function renderViewerView(): void;
declare function onViewerFocusChange(event: FocusChangeEvent): void;
declare function onViewerFocusState(snapshot: FocusStateSnapshot): void;
declare function updateViewerMainCanvas(_screenId: ScreenId): void;
declare function showViewerPiP(_previousScreenId: ScreenId): void;
declare function updateViewerScreenMap(activeScreenId: ScreenId): void;
declare function pinViewerScreen(screenId: ScreenId): void;
declare function returnToAutoFollow(): void;
declare function updateViewerModeIndicator(): void;
declare function onScreenMetaUpdate(_meta: any): void;
declare function handleWebRTCOffer(payload: any): Promise<void>;
declare function handleWebRTCAnswer(payload: any): Promise<void>;
declare function handleICECandidate(payload: any): Promise<void>;
declare function updateConnectionStatus(status: 'connected' | 'connecting' | 'offline'): void;
declare function resetToLanding(): void;
declare function copyToClipboard(text: string): void;
//# sourceMappingURL=app.d.ts.map