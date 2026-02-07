# FOCUS — Smart Multi-Screen Sharing

Enterprise desktop app for sharing multiple displays simultaneously with intent-driven focus switching.

## Quick Start

```bash
npm install
npm run build          # Compile TS + copy HTML/CSS to dist/
npm start              # Launch Electron app
```

**Signaling server** (separate terminal):
```bash
npm run start:signaling   # WebSocket on port 8080
```

**Tests**:
```bash
npm test
```

## Architecture

```
Presenter Client                        Viewer Clients
┌──────────────────┐  Focus Events  ┌──────────────────┐
│ Screen Capture   │───────────────▶│ Stream Receiver   │
│ Intent Engine    │  Video Tracks  │ Focus Resolver    │
│ Focus Controller │◀───────────────│ View Renderer     │
└──────────────────┘                └──────────────────┘
         │        Signaling / Data Channel       ▲
         └───────────────────────────────────────┘
```

**Core principle**: Stream everything once. Focus switching is UI-only metadata — no WebRTC renegotiation.

## Project Structure

```
src/
├── shared/types/focus.ts       # Domain types, configs, defaults
├── intent/
│   ├── focus-algorithm.ts      # Deterministic state machine (§5-§13)
│   └── intent-engine.ts        # OS-level signal capture (cursor, clicks, typing)
├── capture/screen-capture.ts   # Multi-screen capture (1 track per display)
├── transport/webrtc-transport.ts  # Presenter + Viewer WebRTC (SFU-ready)
├── signaling/
│   ├── server.ts               # WebSocket session management
│   └── client.ts               # Auto-reconnect signaling client
├── main/
│   ├── index.ts                # Electron main process, IPC, global shortcuts
│   └── preload.ts              # Secure IPC bridge
└── renderer/
    ├── index.html              # 4-view SPA (landing, screen-select, presenter, viewer)
    ├── styles.css              # Dark utilitarian design system (942 lines)
    └── app.ts                  # Full application controller
test/
└── focus-algorithm.test.ts     # 35 test cases covering all algorithm behaviors
```

## Keyboard Shortcuts (Presenter)

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Toggle Auto-Focus |
| `Ctrl+Shift+F` | Freeze Focus |
| `Ctrl+Shift+1-3` | Manual Screen Select |
| `Ctrl+Shift+0` | Clear Manual Override |
| `Escape` | Clear Manual Override (renderer) |

## Focus Algorithm Summary

Deterministic state machine with hysteresis. No ML required.

- **Confidence model**: Click 0.95, Typing 0.90, Scroll 0.85, Hover 0.70, Movement 0.40
- **Dwell thresholds**: Click 300ms, Hover 500ms, Movement 800ms
- **Cooldown**: 500ms between switches
- **Idle detection**: 2000ms → freeze auto-switching
- **Manual override**: Always wins (confidence 1.0)

## Spec Documents

Built from these authoritative specs:
- `mvp_prd.md` — Product requirements
- `build_checklist_and_start_prompt.md` — Focus algorithm (§1-§15)
- `web_rtc_implementation.md` — WebRTC transport design
- `ux_flows.md` — UX patterns and transitions
- `smart_multi_screen_sharing_app_build_plan_architecture.md` — System architecture
