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

// ═══════════════════════════════════════════
// TYPE IMPORTS (embedded for Electron renderer)
// ═══════════════════════════════════════════

// In production build, these would be proper imports.
// For the Electron renderer, we inline the critical types.

type ScreenId = string;

enum SignalType {
  Manual = 'manual', Click = 'click', DragStart = 'drag_start',
  DragEnd = 'drag_end', DoubleClick = 'double_click',
  WindowFocus = 'window_focus', Typing = 'typing', Scroll = 'scroll',
  Gesture = 'gesture', Hover = 'hover', PointerMove = 'pointer_move',
}

enum PresenterControlAction {
  ToggleAutoFocus = 'toggle_auto_focus', ToggleFreeze = 'toggle_freeze',
  ManualSelect = 'manual_select', ClearManual = 'clear_manual',
}

enum ViewerMode { AutoFollow = 'auto_follow', Pinned = 'pinned' }

// ═══════════════════════════════════════════
// ICE SERVERS (STUN + TURN)
// ═══════════════════════════════════════════
// TURN is required when peers are on different networks (different NATs).
// Get free TURN credentials at https://www.metered.ca/stun-turn
// or self-host coturn.

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // ── Replace these with your real TURN credentials ──
  {
    urls: 'turn:a.relay.metered.ca:80',
    username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
    credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
  },
  {
    urls: 'turn:a.relay.metered.ca:443',
    username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
    credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
  },
  {
    urls: 'turns:a.relay.metered.ca:443',
    username: 'REPLACE_WITH_YOUR_METERED_USERNAME',
    credential: 'REPLACE_WITH_YOUR_METERED_CREDENTIAL',
  },
];

const STREAM_QUALITY = {
  maxFrameRate: 60,
  minFrameRate: 30,
  maxBitrateKbps: 8000,
};

interface FocusChangeEvent {
  type: 'focus_change'; sessionId: string; screenId: ScreenId;
  reason: string; confidence: number; dwellMs: number;
  sequence: number; timestampMs: number;
}

interface FocusStateSnapshot {
  type: 'focus_state'; activeScreenId: ScreenId;
  mode: 'auto' | 'manual' | 'frozen'; frozen: boolean;
  sequence: number; timestampMs: number;
}

// ═══════════════════════════════════════════
// FOCUS ALGORITHM (inline for renderer)
// ═══════════════════════════════════════════

const BASE_CONFIDENCE: Record<string, number> = {
  manual: 1.00, click: 0.95, drag_start: 0.95, drag_end: 0.85,
  double_click: 0.95, window_focus: 0.90, typing: 0.90, scroll: 0.85,
  gesture: 0.85, hover: 0.70, pointer_move: 0.40,
};

const DEFAULT_CONFIG = {
  maxScreens: 3, switchThreshold: 0.80, stayThreshold: 0.50,
  cooldownMs: 500, idleMs: 2000, idleMotionPxPerS: 5,
  clickDwellMs: 300, typingDwellMs: 300, scrollDwellMs: 300,
  hoverDwellMs: 500, movementDwellMs: 800,
  movementSpeedHighPxPerS: 1200, hoverRadiusPx: 8, resumeGraceMs: 300,
};

class FocusEngine {
  private activeScreenId: ScreenId | null = null;
  private frozen = false;
  private autoEnabled = true;
  private manualOverride: ScreenId | null = null;
  private lastSwitchTs = 0;
  private candidateScreenId: ScreenId | null = null;
  private candidateSinceTs = 0;
  private lastActivityTs = 0;
  private sequence = 0;
  private displays = new Map<ScreenId, { x: number; y: number; width: number; height: number }>();
  private onFocusChangeCb: ((e: FocusChangeEvent) => void) | null = null;
  private sessionId = '';

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setDisplays(displays: Array<{ screenId: ScreenId; x: number; y: number; width: number; height: number }>) {
    this.displays.clear();
    displays.forEach(d => this.displays.set(d.screenId, d));
    if (!this.activeScreenId && displays.length > 0) {
      this.activeScreenId = displays[0].screenId;
    }
  }

  onFocusChange(cb: (e: FocusChangeEvent) => void) { this.onFocusChangeCb = cb; }

  getActiveScreen(): ScreenId | null { return this.activeScreenId; }
  isFrozen(): boolean { return this.frozen; }
  isAutoEnabled(): boolean { return this.autoEnabled; }

  processSignal(type: string, screenId: ScreenId, now: number, speedPxPerS?: number) {
    // In renderer we only emit pointer/hover signals, so treat them as activity.
    this.lastActivityTs = now;
    if (this.frozen || !this.autoEnabled) return;
    if (this.manualOverride) {
      if (this.activeScreenId !== this.manualOverride) {
        this.setActive(this.manualOverride, 'manual', 1.0, now);
      }
      return;
    }
    if (!this.displays.has(screenId)) return;

    let conf = BASE_CONFIDENCE[type] ?? 0.40;

    // Idle check
    if (now - this.lastActivityTs > DEFAULT_CONFIG.idleMs) return;

    // Cooldown penalty
    if (now - this.lastSwitchTs < DEFAULT_CONFIG.cooldownMs && type !== 'manual') {
      conf -= 0.15;
    }

    // Movement speed penalty
    if (type === 'pointer_move' && speedPxPerS && speedPxPerS > DEFAULT_CONFIG.movementSpeedHighPxPerS) {
      conf -= 0.10;
    }

    conf = Math.max(0, Math.min(1, conf));

    // Candidate tracking
    if (screenId !== this.candidateScreenId) {
      this.candidateScreenId = screenId;
      this.candidateSinceTs = now;
    }

    // Dwell check
    const dwellNeeded = this.getDwellMs(type);
    if (now - this.candidateSinceTs < dwellNeeded) return;

    // Hysteresis
    if (screenId !== this.activeScreenId) {
      const threshold = type === 'hover'
        ? 0.70
        : type === 'pointer_move'
          ? 0.40
          : DEFAULT_CONFIG.switchThreshold;
      if (conf >= threshold) {
        this.setActive(screenId, type, conf, now);
      }
    }
  }

  handleControl(action: string, screenId?: ScreenId) {
    const now = Date.now();
    switch (action) {
      case PresenterControlAction.ToggleAutoFocus:
        this.autoEnabled = !this.autoEnabled;
        break;
      case PresenterControlAction.ToggleFreeze:
        this.frozen = !this.frozen;
        if (!this.frozen) this.candidateSinceTs = now;
        break;
      case PresenterControlAction.ManualSelect:
        if (screenId && this.displays.has(screenId)) {
          this.manualOverride = screenId;
          this.setActive(screenId, 'manual', 1.0, now);
        }
        break;
      case PresenterControlAction.ClearManual:
        this.manualOverride = null;
        break;
    }
  }

  getState(): FocusStateSnapshot {
    return {
      type: 'focus_state',
      activeScreenId: this.activeScreenId || 'screen_1',
      mode: this.manualOverride ? 'manual' : this.frozen ? 'frozen' : 'auto',
      frozen: this.frozen,
      sequence: this.sequence,
      timestampMs: Date.now(),
    };
  }

  private setActive(screenId: ScreenId, reason: string, confidence: number, now: number) {
    this.sequence++;
    const dwellMs = now - this.candidateSinceTs;
    this.activeScreenId = screenId;
    this.lastSwitchTs = now;

    const event: FocusChangeEvent = {
      type: 'focus_change', sessionId: this.sessionId, screenId, reason,
      confidence: Math.round(confidence * 100) / 100, dwellMs,
      sequence: this.sequence, timestampMs: now,
    };
    this.onFocusChangeCb?.(event);
  }

  private getDwellMs(type: string): number {
    if (type === 'manual') return 0;
    if (['click', 'double_click', 'drag_start'].includes(type)) return DEFAULT_CONFIG.clickDwellMs;
    if (['typing', 'window_focus'].includes(type)) return DEFAULT_CONFIG.typingDwellMs;
    if (['scroll', 'gesture'].includes(type)) return DEFAULT_CONFIG.scrollDwellMs;
    if (type === 'hover') return DEFAULT_CONFIG.hoverDwellMs;
    return DEFAULT_CONFIG.movementDwellMs;
  }
}

// ═══════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════

interface AppState {
  currentView: 'landing' | 'screen-select' | 'presenter' | 'viewer';
  role: 'none' | 'presenter' | 'viewer';
  sessionId: string | null;
  clientId: string | null;
  serverUrl: string;
  selectedScreens: Array<{ screenId: ScreenId; sourceId: string; label: string; bounds: any; displayId?: string }>;
  captures: Map<ScreenId, MediaStream>;
  focusEngine: FocusEngine | null;
  viewerMode: ViewerMode;
  viewerActiveScreen: ScreenId | null;
  viewerPinnedScreen: ScreenId | null;
  viewerCount: number;
  ws: WebSocket | null;
  peerConnection: RTCPeerConnection | null;
  presenterPeers: Map<string, RTCPeerConnection>;
  viewerTrackMap: Map<string, ScreenId>;
  viewerTrackStreams: Map<string, MediaStream>;
  viewerStreamMap: Map<string, ScreenId>;
  viewerStreamById: Map<string, MediaStream>;
  viewerScreenStreams: Map<ScreenId, MediaStream>;
  viewerMidMap: Map<string, ScreenId>;
  viewerPeerTargetId: string | null;
  intentPollTimer: number | null;
  pipTimer: number | null;
}

const state: AppState = {
  currentView: 'landing',
  role: 'none',
  sessionId: null,
  clientId: null,
  serverUrl: 'ws://localhost:8080',
  selectedScreens: [],
  captures: new Map(),
  focusEngine: null,
  viewerMode: ViewerMode.AutoFollow,
  viewerActiveScreen: null,
  viewerPinnedScreen: null,
  viewerCount: 0,
  ws: null,
  peerConnection: null,
  presenterPeers: new Map(),
  viewerTrackMap: new Map(),
  viewerTrackStreams: new Map(),
  viewerStreamMap: new Map(),
  viewerStreamById: new Map(),
  viewerScreenStreams: new Map(),
  viewerMidMap: new Map(),
  viewerPeerTargetId: null,
  intentPollTimer: null,
  pipTimer: null,
};

// ═══════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => document.querySelectorAll(sel);

// ═══════════════════════════════════════════
// VIEW ROUTING
// ═══════════════════════════════════════════

function showView(viewName: string) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${viewName}`)?.classList.add('active');
  state.currentView = viewName as any;
}

// ═══════════════════════════════════════════
// SIGNALING
// ═══════════════════════════════════════════

/** Read server URL from UI input and normalize it */
function getServerUrl(): string {
  const input = $('#input-server-url') as HTMLInputElement;
  let url = input?.value.trim() || 'ws://localhost:8080';

  if (!/^wss?:\/\//i.test(url)) {
    if (/^localhost$/i.test(url)) {
      url = `ws://${url}:8080`;
    } else {
      url = `ws://${url}`;
    }
  }

  state.serverUrl = url;
  return url;
}

function connectSignaling(url?: string): Promise<void> {
  const serverUrl = url || state.serverUrl;
  return new Promise((resolve, reject) => {
    try {
      console.log(`[App] Connecting to signaling server: ${serverUrl}`);
      state.ws = new WebSocket(serverUrl);

      state.ws.onopen = () => {
        updateConnectionStatus('connected');
        resolve();
      };

      state.ws.onclose = () => {
        updateConnectionStatus('offline');
      };

      state.ws.onerror = (err) => {
        updateConnectionStatus('offline');
        reject(err);
      };

      state.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleSignalingMessage(msg);
        } catch (err) {
          console.warn('[App] Invalid signaling message:', err);
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

function sendSignaling(type: string, payload: any = {}) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type,
      senderId: state.clientId || '',
      sessionId: state.sessionId || '',
      payload,
      timestampMs: Date.now(),
    }));
  }
}

function handleSignalingMessage(msg: any) {
  switch (msg.type) {
    case 'session_created':
      if (msg.payload?.clientId) state.clientId = msg.payload.clientId;
      if (msg.payload?.sessionId) {
        state.sessionId = msg.payload.sessionId;
        onSessionCreated();
      }
      break;

    case 'session_joined':
      state.sessionId = msg.payload?.sessionId;
      onSessionJoined();
      break;

    case 'session_error':
      alert(`Session error: ${msg.payload?.error || 'Unknown'}`);
      break;

    case 'focus_change':
      if (state.role === 'viewer') onViewerFocusChange(msg.payload);
      break;

    case 'focus_state':
      if (state.role === 'viewer') onViewerFocusState(msg.payload);
      break;

    case 'join_session':
      if (state.role === 'presenter') {
        state.viewerCount++;
        updateViewerCount();
        if (msg.payload?.viewerId) {
          void createPresenterPeer(msg.payload.viewerId);
        }
      }
      break;

    case 'leave_session':
      if (state.role === 'presenter' && msg.payload?.viewerId) {
        state.viewerCount = Math.max(0, state.viewerCount - 1);
        updateViewerCount();
        const pc = state.presenterPeers.get(msg.payload.viewerId);
        if (pc) {
          pc.close();
          state.presenterPeers.delete(msg.payload.viewerId);
        }
      }
      if (msg.payload?.reason === 'presenter_left' && state.role === 'viewer') {
        alert('Presenter ended the session.');
        resetToLanding();
      }
      break;

    case 'offer':
      if (isMessageForThisClient(msg.payload)) {
        handleWebRTCOffer(msg.payload, msg.senderId);
      }
      break;

    case 'answer':
      if (isMessageForThisClient(msg.payload)) {
        handleWebRTCAnswer(msg.payload, msg.senderId);
      }
      break;

    case 'ice_candidate':
      if (isMessageForThisClient(msg.payload)) {
        handleICECandidate(msg.payload, msg.senderId);
      }
      break;

    case 'screen_meta_update':
      if (state.role === 'viewer' && isMessageForThisClient(msg.payload)) {
        onScreenMetaUpdate(msg.payload);
      }
      break;
  }
}

function isMessageForThisClient(payload: any): boolean {
  const targetId = payload?.targetId;
  if (!targetId) return true;
  if (!state.clientId) return false;
  return targetId === state.clientId;
}

// ═══════════════════════════════════════════
// PRESENTER FLOW
// ═══════════════════════════════════════════

async function startPresenterFlow() {
  showView('screen-select');
  await populateScreenSelection();
}

async function populateScreenSelection() {
  const grid = $('#screen-grid');
  grid.innerHTML = '';

  try {
    const sources = await window.electronAPI.getDesktopSources();
    const displays = await window.electronAPI.getDisplays();
    const displayById = new Map<string, any>();
    displays.forEach((display: any) => {
      if (display?.displayId !== undefined && display?.displayId !== null) {
        displayById.set(String(display.displayId), display);
      }
    });

    sources.forEach((source: any, index: number) => {
      const displayFromId = displayById.get(String(source.display_id || ''));
      const display = displayFromId || displays[index] || { width: 1920, height: 1080 };
      const screenId = display?.screenId || `screen_${index + 1}`;

      const card = document.createElement('div');
      card.className = 'screen-card';
      card.dataset.screenId = screenId;
      card.dataset.sourceId = source.id;
      card.dataset.label = source.name;
      if (display?.displayId !== undefined && display?.displayId !== null) {
        card.dataset.displayId = String(display.displayId);
      }
      card.dataset.boundsX = String(display.x || 0);
      card.dataset.boundsY = String(display.y || 0);
      card.dataset.boundsW = String(display.width || 1920);
      card.dataset.boundsH = String(display.height || 1080);
      card.dataset.dpi = String(display.dpiScale || 1);

      card.innerHTML = `
        <div class="screen-card-thumbnail">
          <img src="${source.thumbnail}" alt="${source.name}">
        </div>
        <div class="screen-card-info">
          <span class="screen-card-label">${source.name}</span>
          <span class="screen-card-resolution">${display.width}×${display.height}</span>
        </div>
      `;

      card.addEventListener('click', () => toggleScreenSelection(card));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('[App] Failed to enumerate screens:', err);
    grid.innerHTML = '<p style="color: var(--text-tertiary)">No screens detected. Check permissions.</p>';
  }
}

function toggleScreenSelection(card: HTMLElement) {
  const isSelected = card.classList.contains('selected');
  const selectedCount = $$('.screen-card.selected').length;

  if (!isSelected && selectedCount >= DEFAULT_CONFIG.maxScreens) {
    return; // Max screens reached
  }

  card.classList.toggle('selected');
  updateStartButton();
}

function updateStartButton() {
  const btn = $('#btn-start-sharing') as HTMLButtonElement;
  const count = $$('.screen-card.selected').length;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? `Start Sharing (${count} screen${count > 1 ? 's' : ''})` : 'Start Sharing';
}

async function startSharing() {
  // Gather selected screens
  const cards = $$('.screen-card.selected');
  state.selectedScreens = [];

  cards.forEach((card: any) => {
    state.selectedScreens.push({
      screenId: card.dataset.screenId,
      sourceId: card.dataset.sourceId,
      label: card.dataset.label,
      displayId: card.dataset.displayId || undefined,
      bounds: {
        screenId: card.dataset.screenId,
        x: parseInt(card.dataset.boundsX),
        y: parseInt(card.dataset.boundsY),
        width: parseInt(card.dataset.boundsW),
        height: parseInt(card.dataset.boundsH),
        dpiScale: parseFloat(card.dataset.dpi),
      },
    });
  });

  // Capture screens
  try {
    for (const screen of state.selectedScreens) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screen.sourceId,
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: STREAM_QUALITY.maxFrameRate,
            minFrameRate: STREAM_QUALITY.minFrameRate,
          },
        } as any,
      });
      state.captures.set(screen.screenId, stream);
    }
  } catch (err) {
    console.error('[App] Screen capture failed:', err);
    alert('Failed to capture screens. Check permissions.');
    return;
  }

  // Initialize focus engine
  state.focusEngine = new FocusEngine(state.sessionId || 'local');
  state.focusEngine.setDisplays(
    state.selectedScreens.map(s => ({
      screenId: s.screenId,
      x: s.bounds.x,
      y: s.bounds.y,
      width: s.bounds.width,
      height: s.bounds.height,
    })),
  );

  state.focusEngine.onFocusChange((event) => {
    onPresenterFocusChange(event);
  });

  // Connect signaling and create session
  try {
    getServerUrl(); // Read from UI input
    await connectSignaling();
    sendSignaling('create_session');
  } catch (err) {
    console.warn('[App] Signaling connection failed — running in local mode:', err);
    state.sessionId = 'local-' + Math.random().toString(36).slice(2, 8);
    onSessionCreated();
  }
}

function onSessionCreated() {
  state.role = 'presenter';
  showView('presenter');
  renderPresenterView();
  startIntentDetection();
  const snapshot = state.focusEngine?.getState();
  if (snapshot) sendSignaling('focus_state', snapshot);
}

function renderPresenterView() {
  // Session ID display
  const sessionIdEl = $('#presenter-session-id');
  if (sessionIdEl && state.sessionId) {
    sessionIdEl.textContent = state.sessionId.slice(0, 8) + '…';
    sessionIdEl.title = state.sessionId;
  }

  // Screen preview grid
  const grid = $('#presenter-screen-grid');
  grid.innerHTML = '';

  const screenCount = state.selectedScreens.length;
  const previewWidth = screenCount === 1 ? 640 : screenCount === 2 ? 480 : 360;
  const previewHeight = Math.round(previewWidth * 9 / 16);

  state.selectedScreens.forEach((screen) => {
    const preview = document.createElement('div');
    preview.className = 'screen-preview';
    preview.id = `preview-${screen.screenId}`;
    preview.style.width = `${previewWidth}px`;
    preview.style.height = `${previewHeight}px`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const stream = state.captures.get(screen.screenId);
    if (stream) video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'screen-preview-label';
    label.innerHTML = `
      <span>${screen.label}</span>
      <span class="active-badge" id="badge-${screen.screenId}" style="display:none">● ACTIVE</span>
    `;

    // Manual select on click
    preview.addEventListener('click', () => {
      state.focusEngine?.handleControl(PresenterControlAction.ManualSelect, screen.screenId);
    });

    preview.appendChild(video);
    preview.appendChild(label);
    grid.appendChild(preview);
  });

  // Set initial active
  if (state.selectedScreens.length > 0) {
    updatePresenterActiveScreen(state.selectedScreens[0].screenId);
  }
}

function startIntentDetection() {
  // Poll cursor position and detect intent signals
  let lastX = 0, lastY = 0, lastTs = Date.now();

  state.intentPollTimer = window.setInterval(async () => {
    if (!state.focusEngine) return;

    try {
      const pos = await window.electronAPI.getCursorPosition();
      const displayId = await window.electronAPI.getCursorDisplay();
      const now = Date.now();
      const dx = pos.x - lastX;
      const dy = pos.y - lastY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = now - lastTs;
      const speed = dt > 0 ? (dist / dt) * 1000 : 0;

      // Attribute to screen
      const screenId = attributeCursorToScreen(pos.x, pos.y, displayId);
      if (screenId) {
        if (dist > 3) {
          state.focusEngine.processSignal('pointer_move', screenId, now, speed);
        } else if (dist <= DEFAULT_CONFIG.hoverRadiusPx) {
          state.focusEngine.processSignal('hover', screenId, now, 0);
        }
      }

      lastX = pos.x;
      lastY = pos.y;
      lastTs = now;
    } catch (err) {
      // Cursor polling failed — non-fatal
    }
  }, 50); // 20 Hz per spec

  // Listen for presenter controls from main process (global shortcuts)
  window.electronAPI.onPresenterControl((control: any) => {
    state.focusEngine?.handleControl(control.action, control.screenId);
    updatePresenterControls();
  });
}

function attributeCursorToScreen(x: number, y: number, displayId?: string | null): ScreenId | null {
  if (displayId) {
    const match = state.selectedScreens.find(s => s.displayId === String(displayId));
    if (match) return match.screenId;
  }

  for (const screen of state.selectedScreens) {
    const b = screen.bounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      return screen.screenId;
    }
  }
  return state.selectedScreens[0]?.screenId || null;
}

function onPresenterFocusChange(event: FocusChangeEvent) {
  updatePresenterActiveScreen(event.screenId);
  updateDebugPanel(event);

  // Send to viewers via signaling
  sendSignaling('focus_change', event);
  const snapshot = state.focusEngine?.getState();
  if (snapshot) sendSignaling('focus_state', snapshot);
}

function updatePresenterActiveScreen(screenId: ScreenId) {
  // Update preview borders
  $$('.screen-preview').forEach(el => el.classList.remove('active'));
  $(`#preview-${screenId}`)?.classList.add('active');

  // Update active badges
  $$('.active-badge').forEach(el => (el as HTMLElement).style.display = 'none');
  const badge = $(`#badge-${screenId}`);
  if (badge) badge.style.display = 'inline';
}

function updateDebugPanel(event: FocusChangeEvent) {
  const set = (id: string, val: string) => {
    const el = $(`#debug-${id}`);
    if (el) el.textContent = val;
  };

  set('active-screen', event.screenId);
  set('reason', event.reason);
  set('confidence', String(event.confidence));
  set('dwell', `${event.dwellMs}ms`);
  set('mode', state.focusEngine?.isFrozen() ? 'frozen'
    : state.focusEngine?.isAutoEnabled() ? 'auto' : 'manual');
  set('sequence', String(event.sequence));
}

function updatePresenterControls() {
  const autoBtn = $('#btn-auto-focus');
  const freezeBtn = $('#btn-freeze');

  if (state.focusEngine?.isAutoEnabled()) {
    autoBtn?.classList.add('active');
  } else {
    autoBtn?.classList.remove('active');
  }

  if (state.focusEngine?.isFrozen()) {
    freezeBtn?.classList.add('active');
  } else {
    freezeBtn?.classList.remove('active');
  }
}

function updateViewerCount() {
  const el = $('#viewer-count');
  if (el) el.textContent = String(state.viewerCount);
}

// ═══════════════════════════════════════════
// VIEWER FLOW
// ═══════════════════════════════════════════

async function joinAsViewer(sessionId: string) {
  state.role = 'viewer';
  state.sessionId = sessionId;

  try {
    getServerUrl(); // Read from UI input
    await connectSignaling();
    sendSignaling('join_session');
  } catch (err) {
    alert('Failed to connect to session server.');
    resetToLanding();
  }
}

function onSessionJoined() {
  showView('viewer');
  renderViewerView();
}

function renderViewerView() {
  updateViewerModeIndicator();
}

function onViewerFocusChange(event: FocusChangeEvent) {
  if (state.viewerMode === ViewerMode.Pinned) return; // Ignore if pinned

  const previousScreen = state.viewerActiveScreen;
  state.viewerActiveScreen = event.screenId;

  // Update main canvas
  updateViewerMainCanvas(event.screenId);

  // Show PiP for previous screen (5-10s per spec)
  if (previousScreen && previousScreen !== event.screenId) {
    showViewerPiP(previousScreen);
  }

  // Update focus tooltip
  const label = $('#viewer-active-screen-label');
  if (label) {
    const screenNum = event.screenId.replace('screen_', '');
    label.textContent = `Screen ${screenNum}`;
  }

  // Update screen map
  updateViewerScreenMap(event.screenId);

  // Flash focus border glow (UX_Flows.md §5)
  const glow = $('#focus-border-glow');
  if (glow) {
    glow.classList.remove('active');
    // Force reflow
    void glow.offsetWidth;
    glow.classList.add('active');
    setTimeout(() => glow.classList.remove('active'), 2000);
  }
}

function onViewerFocusState(snapshot: FocusStateSnapshot) {
  const screenId = snapshot?.activeScreenId ?? (snapshot as any)?.screenId ?? null;
  if (!screenId) return;
  state.viewerActiveScreen = screenId;
  updateViewerMainCanvas(screenId);
  updateViewerScreenMap(screenId);

  const label = $('#viewer-active-screen-label');
  if (label) {
    const screenNum = screenId.replace('screen_', '');
    label.textContent = `Screen ${screenNum}`;
  }
}

function updateViewerMainCanvas(screenId: ScreenId | null) {
  const video = $('#viewer-main-video') as HTMLVideoElement;
  if (!video) return;

  let stream: MediaStream | undefined;

  if (screenId) {
    stream = state.viewerScreenStreams.get(screenId);
  }

  if (!stream) {
    const firstScreenStream = state.viewerScreenStreams.values().next().value as MediaStream | undefined;
    const firstTrackStream = state.viewerTrackStreams.values().next().value as MediaStream | undefined;
    stream = firstScreenStream || firstTrackStream;
  }

  if (stream && video.srcObject !== stream) {
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }
}

function showViewerPiP(previousScreenId: ScreenId) {
  const pip = $('#viewer-pip');
  const video = $('#viewer-pip-video') as HTMLVideoElement;
  const stream = state.viewerScreenStreams.get(previousScreenId);
  if (!pip || !video || !stream) return;

  if (video.srcObject !== stream) {
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }

  pip.style.display = 'block';

  // Auto-hide after 5-10s per UX_Flows.md §5
  if (state.pipTimer) clearTimeout(state.pipTimer);
  state.pipTimer = window.setTimeout(() => {
    pip.style.display = 'none';
  }, 7000);
}

function updateViewerScreenMap(activeScreenId: ScreenId) {
  $$('.screen-map-item').forEach(el => {
    el.classList.remove('active', 'pinned');
    if ((el as HTMLElement).dataset.screenId === activeScreenId) {
      el.classList.add('active');
    }
    if (state.viewerPinnedScreen && (el as HTMLElement).dataset.screenId === state.viewerPinnedScreen) {
      el.classList.add('pinned');
    }
  });
}

function pinViewerScreen(screenId: ScreenId) {
  state.viewerMode = ViewerMode.Pinned;
  state.viewerPinnedScreen = screenId;
  updateViewerModeIndicator();
  updateViewerMainCanvas(screenId);

  // Show return button
  const btn = $('#btn-return-follow');
  if (btn) btn.style.display = 'inline-flex';

  // Send override to presenter
  sendSignaling('viewer_override', {
    viewerId: state.clientId,
    mode: ViewerMode.Pinned,
    pinnedScreenId: screenId,
    timestampMs: Date.now(),
  });
}

function returnToAutoFollow() {
  state.viewerMode = ViewerMode.AutoFollow;
  state.viewerPinnedScreen = null;
  updateViewerModeIndicator();

  // Hide return button
  const btn = $('#btn-return-follow');
  if (btn) btn.style.display = 'none';

  // Resume following presenter's active screen
  if (state.viewerActiveScreen) {
    updateViewerMainCanvas(state.viewerActiveScreen);
  }

  sendSignaling('viewer_override', {
    viewerId: state.clientId,
    mode: ViewerMode.AutoFollow,
    timestampMs: Date.now(),
  });
}

function updateViewerModeIndicator() {
  const indicator = $('#viewer-mode-indicator');
  const modeText = $('#viewer-mode-text');

  if (state.viewerMode === ViewerMode.AutoFollow) {
    indicator?.classList.remove('pinned');
    indicator?.classList.add('auto-follow');
    if (modeText) modeText.textContent = 'Following Presenter';
  } else {
    indicator?.classList.remove('auto-follow');
    indicator?.classList.add('pinned');
    if (modeText) modeText.textContent = 'Pinned View';
  }
}

function onScreenMetaUpdate(meta: any) {
  const tracks = Array.isArray(meta?.tracks) ? meta.tracks : [];
  const streams = Array.isArray(meta?.streams) ? meta.streams : [];
  const mids = Array.isArray(meta?.mids) ? meta.mids : [];

  tracks.forEach((t: any) => {
    if (!t?.trackId || !t?.screenId) return;
    state.viewerTrackMap.set(t.trackId, t.screenId);

    const existingStream = state.viewerTrackStreams.get(t.trackId);
    if (existingStream) {
      state.viewerScreenStreams.set(t.screenId, existingStream);
    }
  });

  streams.forEach((s: any) => {
    if (!s?.streamId || !s?.screenId) return;
    state.viewerStreamMap.set(s.streamId, s.screenId);

    const existingStream = state.viewerStreamById.get(s.streamId);
    if (existingStream) {
      state.viewerScreenStreams.set(s.screenId, existingStream);
    }
  });

  mids.forEach((m: any) => {
    if (!m?.mid || !m?.screenId) return;
    state.viewerMidMap.set(String(m.mid), m.screenId);
  });

  if (!state.viewerActiveScreen) {
    const initialScreenId = streams[0]?.screenId ?? tracks[0]?.screenId;
    if (initialScreenId) {
      state.viewerActiveScreen = initialScreenId;
    }
  }

  updateViewerMainCanvas(state.viewerActiveScreen);
}

// ═══════════════════════════════════════════
// WEBRTC HANDLERS
// ═══════════════════════════════════════════

async function createPresenterPeer(viewerId: string): Promise<void> {
  if (state.presenterPeers.has(viewerId)) return;
  if (state.captures.size === 0) {
    console.warn('[App] No captures available for WebRTC offer.');
    return;
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.presenterPeers.set(viewerId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling('ice_candidate', {
        candidate: event.candidate.toJSON(),
        targetId: viewerId,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      pc.close();
      state.presenterPeers.delete(viewerId);
    }
  };

  const trackMeta: Array<{ trackId: string; screenId: ScreenId }> = [];
  const streamMeta: Array<{ streamId: string; screenId: ScreenId }> = [];
  const trackToScreen = new Map<string, ScreenId>();

  for (const [screenId, stream] of state.captures) {
    streamMeta.push({ streamId: stream.id, screenId });
    for (const track of stream.getTracks()) {
      if (track.kind === 'video') {
        try {
          (track as any).contentHint = 'detail';
        } catch {
          // Non-fatal: contentHint not supported
        }
      }

      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video' && sender?.setParameters) {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = STREAM_QUALITY.maxBitrateKbps * 1000;
          params.encodings[0].maxFramerate = STREAM_QUALITY.maxFrameRate;
          (params as any).degradationPreference = 'maintain-resolution';
          await sender.setParameters(params);
        } catch (err) {
          console.warn('[App] Failed to set sender parameters:', err);
        }
      }
      trackMeta.push({ trackId: track.id, screenId });
      trackToScreen.set(track.id, screenId);
    }
  }

  if (trackMeta.length > 0 || streamMeta.length > 0) {
    sendSignaling('screen_meta_update', {
      tracks: trackMeta,
      streams: streamMeta,
      targetId: viewerId,
    });
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const midMeta: Array<{ mid: string; screenId: ScreenId }> = [];
  pc.getTransceivers().forEach((t) => {
    const track = t.sender?.track;
    if (!track || !t.mid) return;
    const screenId = trackToScreen.get(track.id);
    if (screenId) {
      midMeta.push({ mid: String(t.mid), screenId });
    }
  });

  sendSignaling('offer', { offer, targetId: viewerId, mids: midMeta });
}

async function handleWebRTCOffer(payload: any, presenterId: string) {
  // Viewer: receive offer, create answer
  if (state.role !== 'viewer' || !payload?.offer) return;

  if (state.peerConnection) {
    state.peerConnection.close();
  }

  state.peerConnection = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });
  state.viewerPeerTargetId = presenterId;
  state.viewerTrackMap.clear();
  state.viewerTrackStreams.clear();
  state.viewerStreamMap.clear();
  state.viewerStreamById.clear();
  state.viewerScreenStreams.clear();
  state.viewerMidMap.clear();

  if (payload?.tracks && Array.isArray(payload.tracks)) {
    payload.tracks.forEach((t: any) => {
      if (t?.trackId && t?.screenId) {
        state.viewerTrackMap.set(t.trackId, t.screenId);
      }
    });
  }
  if (payload?.streams && Array.isArray(payload.streams)) {
    payload.streams.forEach((s: any) => {
      if (s?.streamId && s?.screenId) {
        state.viewerStreamMap.set(s.streamId, s.screenId);
      }
    });
  }
  if (payload?.mids && Array.isArray(payload.mids)) {
    payload.mids.forEach((m: any) => {
      if (m?.mid && m?.screenId) {
        state.viewerMidMap.set(String(m.mid), m.screenId);
      }
    });
  }

  state.peerConnection.ontrack = (event) => {
    const track = event.track;
    const stream = event.streams[0] ?? new MediaStream([track]);

    if (stream?.id) {
      state.viewerStreamById.set(stream.id, stream);
      const mappedScreen = state.viewerStreamMap.get(stream.id);
      if (mappedScreen) {
        state.viewerScreenStreams.set(mappedScreen, stream);
        if (!state.viewerActiveScreen) {
          state.viewerActiveScreen = mappedScreen;
        }
      }
    }

    state.viewerTrackStreams.set(track.id, stream);

    const mid = event.transceiver?.mid ? String(event.transceiver.mid) : null;
    const midScreenId = mid ? state.viewerMidMap.get(mid) : undefined;
    const screenId = midScreenId || state.viewerTrackMap.get(track.id);
    if (screenId) {
      state.viewerScreenStreams.set(screenId, stream);
      if (!state.viewerActiveScreen) {
        state.viewerActiveScreen = screenId;
      }
    }

    updateViewerMainCanvas(state.viewerActiveScreen || screenId || null);
  };

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling('ice_candidate', {
        candidate: event.candidate.toJSON(),
        targetId: presenterId,
      });
    }
  };

  await state.peerConnection.setRemoteDescription(
    new RTCSessionDescription(payload.offer),
  );
  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);
  sendSignaling('answer', { answer, targetId: presenterId });
}

async function handleWebRTCAnswer(payload: any, viewerId: string) {
  if (state.role !== 'presenter' || !payload?.answer) return;
  const pc = state.presenterPeers.get(viewerId);
  if (!pc) return;
  await pc.setRemoteDescription(
    new RTCSessionDescription(payload.answer),
  );
}

async function handleICECandidate(payload: any, senderId: string) {
  if (!payload?.candidate) return;

  if (state.role === 'presenter') {
    const pc = state.presenterPeers.get(senderId);
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    return;
  }

  if (state.peerConnection) {
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
  }
}

// ═══════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════

function updateConnectionStatus(status: 'connected' | 'connecting' | 'offline') {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');

  dot?.classList.remove('offline', 'connecting');
  if (status === 'offline') {
    dot?.classList.add('offline');
    if (text) text.textContent = 'Disconnected';
  } else if (status === 'connecting') {
    dot?.classList.add('connecting');
    if (text) text.textContent = 'Connecting…';
  } else {
    if (text) text.textContent = 'Connected';
  }
}

function resetToLanding() {
  // Cleanup
  if (state.intentPollTimer) clearInterval(state.intentPollTimer);
  if (state.pipTimer) clearTimeout(state.pipTimer);
  state.captures.forEach(stream => stream.getTracks().forEach(t => t.stop()));
  state.captures.clear();
  state.peerConnection?.close();
  state.presenterPeers.forEach(pc => pc.close());
  state.presenterPeers.clear();
  state.ws?.close();

  // Reset state
  state.role = 'none';
  state.sessionId = null;
  state.selectedScreens = [];
  state.focusEngine = null;
  state.viewerMode = ViewerMode.AutoFollow;
  state.viewerActiveScreen = null;
  state.viewerPinnedScreen = null;
  state.viewerCount = 0;
  state.ws = null;
  state.peerConnection = null;
  state.viewerTrackMap.clear();
  state.viewerTrackStreams.clear();
  state.viewerStreamMap.clear();
  state.viewerStreamById.clear();
  state.viewerScreenStreams.clear();
  state.viewerMidMap.clear();
  state.viewerPeerTargetId = null;

  showView('landing');
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// ═══════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Landing view
  $('#btn-present')?.addEventListener('click', startPresenterFlow);

  $('#btn-join')?.addEventListener('click', () => {
    const input = $('#input-session-id') as HTMLInputElement;
    const sessionId = input?.value.trim();
    if (sessionId) joinAsViewer(sessionId);
  });

  $('#input-session-id')?.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const sessionId = input?.value.trim();
      if (sessionId) joinAsViewer(sessionId);
    }
  });

  // Screen selection view
  $('#btn-back-landing')?.addEventListener('click', () => showView('landing'));
  $('#btn-start-sharing')?.addEventListener('click', startSharing);

  // Presenter view
  $('#btn-auto-focus')?.addEventListener('click', () => {
    state.focusEngine?.handleControl(PresenterControlAction.ToggleAutoFocus);
    updatePresenterControls();
  });

  $('#btn-freeze')?.addEventListener('click', () => {
    state.focusEngine?.handleControl(PresenterControlAction.ToggleFreeze);
    updatePresenterControls();
  });

  $('#btn-copy-session')?.addEventListener('click', () => {
    if (state.sessionId) copyToClipboard(state.sessionId);
  });

  $('#btn-end-session')?.addEventListener('click', () => {
    sendSignaling('leave_session');
    resetToLanding();
  });

  $('#btn-toggle-debug')?.addEventListener('click', () => {
    $('#debug-body')?.classList.toggle('collapsed');
  });

  // Viewer view
  $('#btn-return-follow')?.addEventListener('click', returnToAutoFollow);

  $('#btn-leave-session')?.addEventListener('click', () => {
    sendSignaling('leave_session');
    resetToLanding();
  });

  // Keyboard shortcuts (renderer-side, for when global shortcuts aren't available)
  document.addEventListener('keydown', (e) => {
    if (state.role !== 'presenter') return;

    // Escape: clear manual override
    if (e.key === 'Escape') {
      state.focusEngine?.handleControl(PresenterControlAction.ClearManual);
      updatePresenterControls();
    }
  });
});
