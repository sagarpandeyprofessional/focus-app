# FOCUS Project Explanation and LinkedIn Post

## Overview
FOCUS is an Electron + TypeScript desktop app for smart multi-screen sharing. A presenter can share up to three displays simultaneously, while viewers automatically follow the screen the presenter is actively working on. Focus changes are deterministic and explainable, based on input signals like clicks, typing, scroll, hover, and pointer movement. The app ships with a standalone WebSocket signaling server and a multi-track WebRTC pipeline so each screen is streamed once and focus switching is metadata-only (no renegotiation).

## What It Solves
Traditional screen sharing forces a single active screen. FOCUS keeps multiple screens visible to viewers, but automatically guides attention to the right one based on the presenter's intent. This reduces "where are you" moments and improves multi-monitor demos, pair sessions, and remote walkthroughs.

## Architecture (High Level)
Presenter and viewers connect to a signaling server. The presenter captures each selected screen as a separate MediaStream track and creates a dedicated WebRTC peer connection per viewer. Focus changes are distributed as control messages so viewers switch their UI without renegotiating video.

Key principle: stream everything once, switch focus using metadata only.

## Core Components (With File Paths)
- Electron main process (window lifecycle, IPC, global shortcuts): `src/main/index.ts`
- Secure IPC bridge to renderer: `src/main/preload.ts`
- Renderer app, UI flow, and orchestration: `src/renderer/app.ts`
- UI layout and views: `src/renderer/index.html`
- Focus algorithm (deterministic state machine): `src/intent/focus-algorithm.ts`
- Intent signal capture (cursor, hover, click, typing hooks): `src/intent/intent-engine.ts`
- Multi-screen capture and metadata: `src/capture/screen-capture.ts`
- WebRTC transport design (multi-track, control plane): `src/transport/webrtc-transport.ts`
- WebSocket signaling server: `src/signaling/server.ts`
- Focus algorithm tests: `test/focus-algorithm.test.ts`

## End-to-End Flow
1. Presenter launches the app and selects up to three screens to share.
2. Each selected screen is captured as its own MediaStream with a video track.
3. The app starts an intent engine that polls cursor position (20 Hz) and emits hover or movement signals.
4. The focus algorithm decides which screen is active using dwell, cooldown, and confidence rules.
5. Focus changes are broadcast to viewers through the signaling server.
6. Each viewer switches its main display to the active screen without WebRTC renegotiation.

## Focus Algorithm Details
FOCUS uses a deterministic state machine to avoid noisy or thrashy switching.

Signals and base confidence (examples):
- Click: 0.95
- Typing: 0.90
- Scroll: 0.85
- Hover: 0.70
- Pointer move: 0.40
- Manual override: 1.00

Timing and thresholds:
- Dwell thresholds: click 300 ms, typing 300 ms, scroll 300 ms, hover 500 ms, movement 800 ms
- Cooldown: 500 ms between switches (inclusive boundary)
- Idle detection: 2000 ms without activity freezes auto switching
- Hysteresis: higher confidence to switch, lower confidence to stay
- Manual override and freeze always win

Implementation: `src/intent/focus-algorithm.ts`

## Capture and Quality Strategy
Each screen is captured independently. The renderer captures with high resolution and frame rate constraints (up to 4K, 60 fps) and applies sender encoding parameters to favor detail and maintain resolution. This improves text readability in multi-screen sharing.

Implementation: `src/renderer/app.ts` and `src/capture/screen-capture.ts`

## WebRTC and Signaling
- Signaling server runs over WebSocket on port 8080.
- Presenter creates a per-viewer RTCPeerConnection and sends all screen tracks.
- Track and stream mapping metadata is sent via `screen_meta_update` so the viewer can map each incoming stream to the correct screen.
- Focus events are sent via signaling messages (control plane).

Implementation: `src/renderer/app.ts` and `src/signaling/server.ts`

## Viewer UX
- Auto-follow mode: viewer switches to presenter's active screen.
- Pinned mode: viewer can lock a specific screen and ignore auto-follow.
- Picture-in-picture: previous screen appears briefly after focus change.

Implementation: `src/renderer/app.ts`

## Presenter Controls and Shortcuts
- Toggle auto-focus: Ctrl+Shift+A
- Freeze focus: Ctrl+Shift+F
- Manual select screen: Ctrl+Shift+1/2/3
- Clear manual override: Ctrl+Shift+0

Implementation: `src/main/index.ts` and `src/renderer/app.ts`

## How to Run
- `npm install`
- `npm run build`
- `npm start`
- Signaling server: `npm run start:signaling`

## Tests
- `npm test`

## LinkedIn Post Draft
Built a new project: FOCUS, a smart multi-screen sharing desktop app that keeps viewers aligned with the screen I am actively working on without interrupting the stream.

Highlights:
- Multi-screen capture (up to 3 displays) with one WebRTC track per screen.
- Deterministic intent engine with dwell, cooldown, and hysteresis for explainable focus switching.
- WebSocket signaling server with per-viewer WebRTC connections.
- Viewer experience with auto-follow, pinned mode, and picture-in-picture.

Stack: Electron, TypeScript, WebRTC, WebSocket, Jest.

If you are building collaboration tools or have ideas for better intent signals, I would love to compare notes.

#Electron #WebRTC #TypeScript #DesktopApp #ProductEngineering
