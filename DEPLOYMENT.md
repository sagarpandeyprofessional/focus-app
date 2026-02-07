# Cross-Network Deployment Guide

How to connect FOCUS across different WiFi networks (e.g., your house ↔ friend's house).

---

## Problem

Two machines on separate home WiFi networks can't reach each other because:
1. **Signaling**: `ws://localhost:8080` only works on the same machine
2. **NAT traversal**: STUN alone fails when both peers are behind different NATs
3. **No relay**: Without TURN, WebRTC media can't traverse symmetric NATs

---

## Solution Overview

```
Your House                     Cloud                      Friend's House
┌──────────┐     WSS      ┌──────────────┐     WSS      ┌──────────┐
│ FOCUS    │◄────────────▶│ Signal Server│◄────────────▶│ FOCUS    │
│ (present)│              └──────────────┘              │ (viewer) │
│          │    TURN relay  ┌────────────┐              │          │
│          │◄──────────────▶│ TURN Server│◄────────────▶│          │
└──────────┘               └────────────┘              └──────────┘
```

You need two things publicly reachable:
- **Signaling server** (your WebSocket server)
- **TURN server** (media relay for NAT traversal)

---

## Step 1: Get TURN Credentials (5 min, free)

1. Go to [metered.ca/stun-turn](https://www.metered.ca/stun-turn)
2. Sign up (free tier = 500 GB/month)
3. Go to **Dashboard → TURN Servers**
4. Copy your **Username** and **Credential**
5. Replace placeholders in two files:

**`src/renderer/app.ts`** — find the `ICE_SERVERS` array near the top:
```ts
{
  urls: 'turn:a.relay.metered.ca:80',
  username: 'YOUR_ACTUAL_USERNAME',    // ← paste here
  credential: 'YOUR_ACTUAL_CREDENTIAL', // ← paste here
},
```

**`src/transport/webrtc-transport.ts`** — same replacement in `DEFAULT_TRANSPORT_CONFIG`.

---

## Step 2: Expose the Signaling Server

Pick ONE of these options:

### Option A: ngrok (fastest, free)

```bash
# Terminal 1: Start signaling server
npm run start:signaling

# Terminal 2: Tunnel it
npx ngrok http 8080
```

ngrok gives you a URL like `wss://abc123.ngrok-free.app`.
Both you and your friend enter this URL in the **Signal Server** field in the app.

### Option B: Cloudflare Tunnel (free, more stable)

```bash
# Install cloudflared
# macOS: brew install cloudflare/cloudflare/cloudflared
# Windows: winget install Cloudflare.cloudflared

# Terminal 1: Start signaling server
npm run start:signaling

# Terminal 2: Tunnel it
cloudflared tunnel --url http://localhost:8080
```

Gives you a URL like `wss://random-name.trycloudflare.com`.

### Option C: VPS Deployment (most reliable, ~$5/mo)

Deploy `src/signaling/server.ts` to any cloud VM:

```bash
# On your VPS (e.g., DigitalOcean, Hetzner, Fly.io)
git clone <your-repo>
cd focus-app
npm install
SIGNAL_PORT=8080 SIGNAL_HOST=0.0.0.0 npm run start:signaling
```

Both clients use `ws://YOUR_VPS_IP:8080` in the Signal Server field.

For production, add TLS (nginx reverse proxy) → `wss://your-domain.com`.

### Option D: Port Forwarding (works but not recommended)

1. On the presenter's router: forward port `8080` → your local IP
2. Find your public IP: `curl ifconfig.me`
3. Friend connects to `ws://YOUR_PUBLIC_IP:8080`

⚠️ This exposes your home network. Use only for testing.

---

## Step 3: Connect

### Presenter
1. Open FOCUS app
2. Enter the signal server URL (e.g., `wss://abc123.ngrok-free.app`)
3. Click **Start Presenting**
4. Select screens → **Start Sharing**
5. Copy the **Session ID** and send it to your friend

### Viewer (Friend)
1. Open FOCUS app
2. Enter the **same** signal server URL
3. Paste the **Session ID**
4. Click **Join as Viewer**

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Disconnected" in header | Signaling server unreachable | Check URL, check tunnel is running |
| Connected but no video | STUN/TURN failure | Add TURN credentials (Step 1) |
| Intermittent video drops | Symmetric NAT + no TURN | Confirm TURN creds are correct |
| "Session not found" | Wrong session ID | Re-copy from presenter |
| Works on LAN, fails remote | Missing tunnel or TURN | Complete Steps 1 + 2 |

### Verify TURN is Working

Open Chrome DevTools → `chrome://webrtc-internals/` → check that ICE candidates include `relay` type. If you only see `srflx` (server reflexive) and `host`, TURN isn't configured.

---

## Quick Reference

```bash
# Start everything locally
npm run start:signaling &   # Signaling server
npm start                   # Electron app

# Expose for remote friend
npx ngrok http 8080         # → gives you wss:// URL
```
