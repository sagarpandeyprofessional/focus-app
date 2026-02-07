# Project Work Log

This file tracks user requests and completed work going forward.

## 2026-02-07

### Request
- Fix failing test in focus algorithm cooldown.
- Make viewer show actual screen content (no black screen) in multi-instance local setup.
- Document changes.
- Fix viewer active-screen switching when presenter changes screens.
- Investigate why active screen doesn’t change when cursor moves to another display.
- Fix cursor-driven switching not triggering with 3 screens.
- Fix cursor-to-screen attribution when multiple displays present.
- Fix viewer stream-to-screen mapping when active screen changes.
- Improve shared screen video quality.

### Work Completed
- Fixed cooldown boundary condition so the 500ms cooldown window is inclusive.
  - This prevents a focus change at exactly 500ms after the last switch.
- Implemented working WebRTC flow for presenter → viewer:
  - Presenter now creates a dedicated `RTCPeerConnection` per viewer on join.
  - Presenter sends SDP offer + ICE candidates to a specific viewer (`targetId`).
  - Viewer responds with SDP answer + ICE candidates to presenter (`targetId`).
  - Track-to-screen mapping is sent via `screen_meta_update` and applied on viewer side.
  - Viewer switches `viewer-main-video` based on focus changes and available streams.
  - PiP now uses the previous screen stream when available.
  - Proper cleanup of per-viewer peer connections and track maps on leave/reset.
- Fixed viewer screen switching by mapping streams by `stream.id` (more reliable than track id).
  - Presenter now sends `streams` metadata (`streamId` → `screenId`) alongside track metadata.
  - Viewer maps incoming `MediaStream` by `stream.id` and uses that to switch screens.
  - Kept track-id mapping as a fallback when no stream id is available.
- Fixed active-screen detection issues caused by incorrect display/source mapping and weak cursor signals.
  - Map desktop sources to displays via `display_id` to get correct bounds per screen.
  - Added hover signals when cursor is stationary, enabling dwell-based switching.
  - Added lower switch thresholds for `hover` and `pointer_move` to allow cursor-driven focus changes.
- Fixed renderer idle logic so pointer/hover signals count as activity.
  - Prevents auto-focus from being blocked after ~2s of no click/typing (renderer only emits pointer/hover).
- Fixed cursor attribution using display id (instead of only bounds).
  - Added IPC `get-cursor-display` to map cursor to the correct display reliably.
  - Persist display id in selected screens and use it for attribution.
- Fixed viewer switching by mapping screens via `transceiver.mid` (stable across peers).
  - Presenter sends `{ mid, screenId }` mapping with the SDP offer.
  - Viewer uses `event.transceiver.mid` to select the correct stream for a screen.
  - Kept stream/track mapping as fallback.
- Increased capture and encoder quality settings.
  - Raised capture constraints to 4K and higher frame rate.
  - Applied sender bitrate/framerate parameters and `contentHint=detail`.
  - Set degradation preference to maintain resolution.

### Files Modified
- `src/intent/focus-algorithm.ts`
  - Inclusive cooldown checks (`<=` instead of `<`) to satisfy cooldown test.
- `src/renderer/app.ts`
  - Added per-viewer WebRTC connections and targeted signaling.
  - Implemented track mapping + video attachment for viewer.
  - Implemented viewer canvas switching + PiP video binding.
  - Added cleanup for presenter peer connections and viewer track maps.
  - Added stream-id mapping for reliable screen switching.
  - Map display sources to correct bounds using `display_id`.
  - Added hover signal generation and cursor-based thresholds for switching.
  - Treat pointer/hover as activity to avoid idle block.
  - Added mid-based mapping for reliable viewer switching.
  - Increased capture constraints and sender encoding parameters for quality.
- `src/main/index.ts`
  - Added `displayId` on display bounds for renderer mapping.
  - Added `get-cursor-display` IPC for robust cursor attribution.
- `src/shared/types/focus.ts`
  - Added optional `displayId` on `DisplayBounds`.
- `src/main/preload.ts`
  - Exposed `getCursorDisplay` to renderer.

### Commands Run
- `npm test`
- `npm run build`
