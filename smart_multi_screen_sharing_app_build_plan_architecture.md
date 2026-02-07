# Smart Multi‑Screen Sharing App

A practical, production‑oriented plan to build an internal team app for **multi‑display screen sharing with intent‑based (cursor‑driven) focus**.

---

## 1. Product Goal

Build a desktop‑first screen sharing app that:
- Allows sharing **multiple displays at once**
- Automatically switches viewer focus based on **presenter intent** (cursor, clicks, typing)
- Keeps **latency low**, **cost minimal**, and **UX simple**
- Is suitable for **internal team use first**, scalable later

Non‑goals (for v1):
- Mobile presenter support
- AI guessing without presenter signals
- Server‑side video mixing

---

## 2. Core Principles (Architecture Drivers)

1. **Separate media from intent**
2. **Never renegotiate streams on focus change**
3. **Stream once, switch views locally**
4. **Degrade gracefully on bad networks**
5. **Default behavior must be safe and obvious**

---

## 3. High‑Level System Architecture

```
┌──────────────────┐        Focus Events        ┌──────────────────┐
│ Presenter Client │ ─────────────────────────▶│  Viewer Clients  │
│                  │                            │                  │
│  Screen Capture  │────── Video Tracks ───────▶│  Stream Receiver │
│  Intent Engine   │                            │  Focus Resolver  │
│  Focus Controller│◀──── Viewer Overrides ─────│  View Renderer   │
└──────────────────┘                            └──────────────────┘
            │                                             ▲
            └──────────── Signaling / Data Channel ───────┘
```

Media = WebRTC video tracks  
Control = metadata (focus, overrides, state)

---

## 4. Client Components (Presenter)

### 4.1 Screen Capture Module
- Capture each display as a **separate video track**
- OS APIs:
  - macOS: ScreenCaptureKit
  - Windows: Desktop Duplication API (DXGI)
  - Linux: PipeWire

Constraints:
- Max 3 displays (configurable)
- Per‑screen resolution caps

---

### 4.2 Intent Detection Engine

Runs **locally** on presenter device.

Signals (priority order):
1. Mouse click / drag
2. Keyboard focus / typing
3. Scroll events
4. Sustained hover (≥300ms)
5. Raw cursor movement

Output example:
```json
{
  "active_screen": "screen_2",
  "reason": "click",
  "confidence": 0.94,
  "timestamp": 1712345678
}
```

---

### 4.3 Focus Controller

Responsibilities:
- Apply dwell time (300–500ms)
- Prevent flicker
- Allow presenter overrides

Controls:
- Auto‑focus ON/OFF
- Freeze focus
- Manual screen select (hotkeys)

---

## 5. Media Transport Layer

### 5.1 WebRTC Configuration

- Each screen = independent video track
- One shared audio track
- Use **SFU**, not MCU

Why:
- No server‑side re‑encoding
- Low latency
- Linear cost scaling

---

### 5.2 Bandwidth Strategy

- Active screen: high bitrate / FPS
- Inactive screens: reduced bitrate / FPS
- Dynamic adaptation via:
  - Simulcast
  - SVC

---

## 6. Signaling & Control Plane

Purpose: **synchronize intent and state**, not media.

Data types:
- Focus events
- Screen metadata
- Viewer override state
- Session state (join/leave)

Transport options:
- WebRTC Data Channel (preferred)
- WebSocket fallback

Latency target: **<50ms**

---

## 7. Viewer Client Architecture

### 7.1 Stream Receiver
- Subscribes to all screen tracks
- No reconnection on focus change

---

### 7.2 Focus Resolver

Logic:
- Default: follow presenter focus
- If viewer pins a screen → override
- One‑click return to auto‑follow

Rules:
- Overrides are temporary
- Presenter always remains authoritative

---

### 7.3 View Renderer

Layout:
- Main canvas = focused screen
- PiP = previous screen (5–10s)
- Optional screen map (advanced)

Focus switch = UI change only

---

## 8. Recording Architecture (Optional Phase 2)

If enabled:
- Record **all screen tracks**
- Store focus events as timeline metadata

Playback modes:
- Presenter‑follow
- Free navigation

Storage cost scales with duration × screens

---

## 9. Failure Handling & Edge Cases

### Cursor Noise
- Ignore micro‑movement
- Require intent signal

### Idle Presenter
- Freeze focus
- Do not auto‑switch

### Network Degradation
- Drop inactive screens to thumbnails
- Preserve active screen quality

### Late Joiners
- Sync latest focus immediately

---

## 10. Security & Privacy

- Explicit screen inclusion list
- App‑level notification suppression
- Panic hotkey: hide all but active screen
- End‑to‑end encryption via WebRTC

---

## 11. Cost‑Aware Deployment Strategy

### Phase 1 – Internal MVP
- Desktop only
- 2–3 screens max
- No recording
- P2P WebRTC or small SFU

Cost: near‑zero to very low

---

### Phase 2 – Team Scale
- Managed SFU (LiveKit / Daily / Agora)
- Viewer overrides
- Basic analytics

Cost: low, linear

---

### Phase 3 – Enterprise
- Self‑hosted SFU
- Recording & compliance
- Admin controls

---

## 12. MVP Build Plan (Step‑by‑Step)

### Step 1
- Single‑screen WebRTC sharing
- Signaling channel

### Step 2
- Multi‑screen capture
- Multiple video tracks

### Step 3
- Intent detection + focus metadata

### Step 4
- Viewer focus switching

### Step 5
- PiP + overrides

### Step 6
- Hardening (edge cases, UX polish)

---

## 13. Tech Stack Recommendation

- Desktop: Electron / Tauri
- Media: WebRTC
- Signaling: WebRTC Data Channel + WebSocket fallback
- SFU: LiveKit (start) → self‑host later
- Language: TypeScript + native bindings

---

## 14. Architecture Thesis

> **Stream everything once. Decide attention everywhere.**

This system scales because **focus is metadata, not video**.

---

## 15. Next Possible Documents

- `MVP_PRD.md`
- `Focus_Algorithm.md`
- `WebRTC_Track_Strategy.md`
- `Cost_Model.md`
- `UX_Flows.md`

---

*This document is intentionally opinionated, minimal, and cost‑aware — optimized for building, not theorizing.*

