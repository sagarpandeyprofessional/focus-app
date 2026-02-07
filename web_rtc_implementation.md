# WebRTC Implementation Guide

## 1. Overview
This document defines how WebRTC is used to support multi-track screen sharing with low latency and high reliability.

---

## 2. Architecture Choice
- **SFU-based topology**
- No MCU or server-side compositing
- Metadata-driven focus switching

---

## 3. Media Tracks

### Video
- One video track per display
- Independent resolution & bitrate

### Audio
- Single shared audio track

---

## 4. Encoding Strategy
- Active screen: high bitrate / FPS
- Inactive screens: low bitrate / FPS
- Use Simulcast or SVC

---

## 5. Signaling

### Control Plane
- Focus events
- Screen metadata
- Viewer overrides

Transport:
- WebRTC Data Channel (primary)
- WebSocket (fallback)

---

## 6. Connection Flow
1. Establish signaling channel
2. Negotiate WebRTC session
3. Publish multiple video tracks
4. Sync focus state

---

## 7. Failure Handling
- Network drop: downgrade inactive streams
- Reconnect without renegotiating tracks
- Preserve focus state on reconnect

---

## 8. Security
- DTLS-SRTP encryption
- No media inspection on server
- Optional E2EE extension

---

## 9. Scalability
- P2P for small calls
- SFU for team calls
- Hierarchical SFU for large sessions

