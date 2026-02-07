# Focus Algorithm

Enterprise-grade, deterministic **presenter-intent inference** for multi-screen sharing.

This algorithm decides **which screen is “active”** for viewers to follow. It is designed to be:
- **Deterministic** (no ML required)
- **Explainable** (every switch has a reason)
- **Stable** (no thrashing)
- **Low-latency** (metadata-only)

---

## 1. Scope

### In scope
- Infer presenter intent across up to **N screens** (default N=3)
- Emit **FocusChange** metadata events
- Support presenter manual override and freeze

### Out of scope
- Content understanding (OCR/vision)
- Predictive “AI” guessing
- Viewer-specific personalization of presenter focus

---

## 2. Definitions

- **ScreenId**: stable identifier for a captured display track (e.g., `screen_1`)
- **Candidate Screen**: the screen currently suggested by signals
- **Active Screen**: the screen currently selected for auto-follow viewers
- **Focus Freeze**: temporary lock preventing automatic changes
- **Presenter Manual Focus**: presenter-selected active screen, overrides auto

---

## 3. Inputs

### 3.1 Screen geometry (required)
- Display bounds in a unified coordinate system
- Per-display DPI scaling info (if available)

### 3.2 OS/user interaction signals
Signals are captured locally on the presenter device.

**High priority**
- Mouse button down/up, click, double-click
- Drag start/drag end
- Active window/focus changes
- Keyboard typing activity (key down events, IME composition)

**Medium priority**
- Scroll wheel / touchpad scroll
- Gesture events (where supported)

**Low priority**
- Pointer movement (position deltas)
- Hover duration

### 3.3 Presenter control inputs
- Auto-Focus ON/OFF
- Freeze Focus ON/OFF
- Manual Focus selection (ScreenId)

---

## 4. Output: Focus Events

### 4.1 FocusChange event
```json
{
  "type": "focus_change",
  "session_id": "...",
  "screen_id": "screen_2",
  "reason": "click",
  "confidence": 0.94,
  "dwell_ms": 420,
  "sequence": 108,
  "timestamp_ms": 1712345678000
}
```

### 4.2 FocusState snapshot (for late joiners / resync)
```json
{
  "type": "focus_state",
  "active_screen_id": "screen_2",
  "mode": "auto" ,
  "frozen": false,
  "sequence": 108,
  "timestamp_ms": 1712345678000
}
```

---

## 5. Core Algorithm Overview

The algorithm is a **state machine** with hysteresis:
- Collect signals
- Attribute them to a ScreenId
- Compute a candidate screen + confidence
- Apply stability rules (dwell, cooldown, confidence threshold)
- Emit FocusChange only when conditions are met

Key invariants:
- **Never thrash** between screens due to micro-movement
- **Never switch** on raw pointer movement alone unless sustained
- **Manual and freeze always win**

---

## 6. Signal Attribution to ScreenId

### 6.1 Pointer-based attribution
- Map pointer `(x, y)` to the display whose bounds contain the point
- If pointer lies on a boundary, select the display with largest overlap region (or last-known stable display)

### 6.2 Window focus attribution
- When OS provides focused window location/display, map that window to ScreenId
- Window focus is used to increase confidence (see §7)

### 6.3 Multi-pointer / tablet / unusual devices
- If multiple pointers are present, treat the **primary** pointer as authoritative (OS-specific definition)
- If only stylus/touch exists, scroll + active window focus should dominate; movement alone remains low confidence

---

## 7. Confidence Model

### 7.1 Base confidence by signal type
| Signal | Base Confidence |
|---|---:|
| Manual focus | 1.00 |
| Click / drag start | 0.95 |
| Typing (focused window) | 0.90 |
| Scroll | 0.85 |
| Hover (≥ hover threshold) | 0.70 |
| Pointer movement | 0.40 |

### 7.2 Confidence modifiers
Apply additive modifiers, then clamp to `[0, 1]`:
- `+0.05` if focused window display matches candidate
- `+0.05` if signal repeated consistently within a short window
- `-0.10` if only movement and speed is high (likely transit)
- `-0.15` if candidate differs from active screen and within cooldown

---

## 8. Stability Rules

### 8.1 Dwell threshold (anti-flicker)
A candidate screen must remain the best candidate for at least:
- **300ms** for click/typing/scroll
- **500ms** for hover
- **800ms** for movement-only

### 8.2 Cooldown (anti-ping-pong)
After a FocusChange, do not change again for:
- **500ms** (default)

Exceptions:
- Manual focus
- Focus freeze toggle

### 8.3 Hysteresis
If candidate equals current active screen, prefer staying (implicit bias):
- If `candidate != active` require `confidence >= switch_threshold`
- If `candidate == active` allow state refresh at lower confidence

Recommended thresholds:
- `switch_threshold = 0.80`
- `stay_threshold = 0.50`

---

## 9. Conflict Resolution

When multiple signals occur close together:
1. Choose the signal with **highest priority** (manual > click/drag > typing > scroll > hover > movement)
2. If priorities tie, choose the one with **highest confidence**
3. If still tied, choose **most recent**

If signals point to different screens within the dwell period, the dwell timer resets.

---

## 10. Idle Detection

If presenter becomes idle:
- No click/typing/scroll for `idle_ms` (default **2000ms**)
- Pointer movement below `idle_motion_px` (default **5px/s**) in same period

Then:
- Freeze automatic switching (do not emit FocusChange)
- Maintain active screen

---

## 11. Presenter Controls Precedence

Order of precedence:
1. **Freeze Focus ON** → block auto switching
2. **Manual Focus selection** → emit focus_change with reason `manual`
3. **Auto-Focus OFF** → do not emit auto focus changes
4. Auto-Focus algorithm

When Freeze Focus is turned OFF, resume auto-focus with a short grace:
- `resume_grace_ms = 300ms` (ignore movement-only candidates)

---

## 12. Recommended Parameters (Defaults)

```yaml
max_screens: 3
switch_threshold: 0.80
cooldown_ms: 500
idle_ms: 2000
idle_motion_px_per_s: 5

# dwell thresholds
click_dwell_ms: 300
typing_dwell_ms: 300
scroll_dwell_ms: 300
hover_dwell_ms: 500
movement_dwell_ms: 800

# movement heuristics
movement_speed_high_px_per_s: 1200
hover_radius_px: 8
```

All parameters should be configurable (feature flags / config file) but **stable defaults** must ship.

---

## 13. Reference Pseudocode

```text
state:
  active_screen_id
  frozen
  auto_enabled
  manual_override (optional)
  last_switch_ts
  candidate_screen_id
  candidate_since_ts
  last_activity_ts

on_event(e):
  update last_activity_ts if e is click/typing/scroll/drag

  if frozen or not auto_enabled:
    return

  if manual_override is set:
    set_active(manual_override, reason="manual", confidence=1.0)
    return

  cand = attribute_to_screen(e)
  base_conf = base_confidence(e.type)
  conf = clamp(base_conf + modifiers(e, cand))

  if is_idle(now):
    return

  if now - last_switch_ts < cooldown_ms and e.type not in {manual}:
    conf -= 0.15

  if cand != candidate_screen_id:
    candidate_screen_id = cand
    candidate_since_ts = now

  dwell_needed = dwell_ms_for(e.type)
  if now - candidate_since_ts < dwell_needed:
    return

  if cand != active_screen_id:
    if conf >= switch_threshold:
      set_active(cand, reason=e.type, confidence=conf)
  else:
    # optional: refresh state
    if conf >= stay_threshold:
      maybe_emit_focus_state_refresh()

set_active(screen, reason, confidence):
  active_screen_id = screen
  last_switch_ts = now
  emit focus_change(active_screen_id, reason, confidence, dwell=now-candidate_since_ts)
```

---

## 14. Observability & Auditability

Every emitted focus_change must be explainable using fields:
- `reason`
- `confidence`
- `dwell_ms`

Recommended logging (local, privacy-safe):
- Event type counts (click/typing/scroll)
- FocusChange frequency
- Thrash prevention counters (cooldown blocks, dwell resets)

Do **not** log raw screen content or keystrokes.

---

## 15. Test Plan (Must Pass)

### Unit tests
- Screen attribution across boundaries and DPI scaling
- Priority ordering correctness
- Dwell timer reset on conflicting signals
- Cooldown enforcement

### Integration tests
- Dual/tri monitor rapid cursor travel without focus thrash
- Code → terminal → browser workflow (click/typing/scroll)
- Idle behavior stops switching
- Manual override always wins

### UX acceptance
- Viewers can always infer where the presenter is looking
- No noticeable flicker during transitions
- Focus changes “feel” intentional

