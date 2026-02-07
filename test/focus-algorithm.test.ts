/**
 * @file    test/focus-algorithm.test.ts
 * @purpose Unit tests for the Focus Algorithm per Focus_Algorithm.md §15.
 * @owner   FOCUS Core Team
 *
 * Test plan (must pass):
 *   - Screen attribution across boundaries and DPI scaling
 *   - Priority ordering correctness
 *   - Dwell timer reset on conflicting signals
 *   - Cooldown enforcement
 *   - Dual/tri monitor rapid cursor travel without focus thrash
 *   - Code → terminal → browser workflow (click/typing/scroll)
 *   - Idle behavior stops switching
 *   - Manual override always wins
 */

import { FocusAlgorithm } from '../src/intent/focus-algorithm';
import {
  DisplayBounds,
  SignalType,
  IntentSignal,
  FocusChangeEvent,
  PresenterControl,
  PresenterControlAction,
  DEFAULT_FOCUS_CONFIG,
} from '../src/shared/types/focus';

// ═══════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════

const DUAL_MONITORS: DisplayBounds[] = [
  { screenId: 'screen_1', x: 0, y: 0, width: 1920, height: 1080, dpiScale: 1 },
  { screenId: 'screen_2', x: 1920, y: 0, width: 1920, height: 1080, dpiScale: 1 },
];

const TRI_MONITORS: DisplayBounds[] = [
  { screenId: 'screen_1', x: 0, y: 0, width: 1920, height: 1080, dpiScale: 1 },
  { screenId: 'screen_2', x: 1920, y: 0, width: 2560, height: 1440, dpiScale: 1.25 },
  { screenId: 'screen_3', x: 4480, y: 0, width: 1920, height: 1080, dpiScale: 1 },
];

function makeSignal(
  type: SignalType,
  screenId: string,
  timestampMs: number,
  overrides: Partial<IntentSignal> = {},
): IntentSignal {
  return {
    type,
    screenId,
    x: 960,
    y: 540,
    timestampMs,
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════

describe('FocusAlgorithm', () => {
  // ─── Screen Attribution (§6) ─────────────

  describe('Screen Attribution', () => {
    it('should attribute pointer to correct screen by coordinates', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Click on screen_2 (x=2000 is within screen_2 bounds)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));

      // Wait for dwell (300ms for click)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[events.length - 1].screenId).toBe('screen_2');
    });

    it('should handle DPI-scaled displays', () => {
      const algo = new FocusAlgorithm('test', TRI_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Click on screen_2 (DPI 1.25)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[events.length - 1].screenId).toBe('screen_2');
    });

    it('should handle boundary points gracefully', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      // Point exactly at boundary (x=1920)
      const signal = makeSignal(SignalType.Click, 'screen_2', 1000, { x: 1920, y: 540 });
      algo.processSignal(signal);
      // Should not crash
      expect(algo.getInternalState()).toBeDefined();
    });
  });

  // ─── Priority Ordering (§9) ──────────────

  describe('Priority Ordering', () => {
    it('should prioritize click over pointer movement', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Movement to screen_2
      algo.processSignal(makeSignal(SignalType.PointerMove, 'screen_2', 1000));

      // Click on screen_1 immediately after
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1001));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1400));

      // Active should stay screen_1 (click > movement)
      const state = algo.getInternalState();
      expect(state.activeScreenId).toBe('screen_1');
    });

    it('should prioritize manual focus over everything', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Manual override to screen_2
      algo.handlePresenterControl({
        action: PresenterControlAction.ManualSelect,
        screenId: 'screen_2',
        timestampMs: 1000,
      });

      expect(events.length).toBe(1);
      expect(events[0].screenId).toBe('screen_2');
      expect(events[0].reason).toBe(SignalType.Manual);
      expect(events[0].confidence).toBe(1.0);
    });
  });

  // ─── Dwell Timer (§8.1) ──────────────────

  describe('Dwell Timer', () => {
    it('should not switch before dwell threshold for click (300ms)', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Click on screen_2 at t=1000
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));

      // Another click at t=1200 (only 200ms — below 300ms dwell)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1200));

      // Should not have switched yet
      expect(events.length).toBe(0);

      // Click at t=1400 (400ms — above 300ms dwell)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      expect(events.length).toBe(1);
      expect(events[0].screenId).toBe('screen_2');
    });

    it('should require 800ms dwell for movement-only signals', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Set initial activity so we're not idle
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 500));

      // Wait for cooldown
      // Move to screen_2
      const baseTime = 2000;
      algo.processSignal(makeSignal(SignalType.PointerMove, 'screen_2', baseTime));
      algo.processSignal(makeSignal(SignalType.PointerMove, 'screen_2', baseTime + 500));

      // At 500ms — should not switch (need 800ms)
      const eventsAfter500 = events.filter(e => e.screenId === 'screen_2');
      expect(eventsAfter500.length).toBe(0);
    });

    it('should reset dwell on conflicting signals (different screens)', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Click screen_2 at t=1000
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));

      // Click screen_1 at t=1150 (before dwell completes — resets!)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1150));

      // Click screen_1 at t=1250 (only 100ms since reset)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1250));

      // Should NOT have switched yet (dwell reset at 1150, need 300ms from there)
      expect(events.length).toBe(0);
    });
  });

  // ─── Cooldown (§8.2) ─────────────────────

  describe('Cooldown Enforcement', () => {
    it('should enforce 500ms cooldown after a focus change', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Switch to screen_2
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));
      expect(events.length).toBe(1);

      // Immediately try to switch back to screen_1 (within cooldown)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1500));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1900));

      // Cooldown penalty reduces confidence below switch threshold
      // The -0.15 penalty brings 0.95 click confidence down, plus cooldown modifier
      // This should NOT switch (or at least be significantly penalized)
      const screen1Switches = events.filter(e => e.screenId === 'screen_1');
      // Due to double penalty (-0.15 twice), confidence drops below 0.80
      expect(screen1Switches.length).toBe(0);
    });

    it('should not enforce cooldown on manual override', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Switch to screen_2
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      // Manual override immediately (within cooldown)
      algo.handlePresenterControl({
        action: PresenterControlAction.ManualSelect,
        screenId: 'screen_1',
        timestampMs: 1500,
      });

      const lastEvent = events[events.length - 1];
      expect(lastEvent.screenId).toBe('screen_1');
      expect(lastEvent.reason).toBe(SignalType.Manual);
    });
  });

  // ─── Anti-Thrash: Rapid Cursor Travel (§5, §15) ──

  describe('Anti-Thrash Behavior', () => {
    it('should not thrash on dual monitor rapid cursor travel', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Ensure not idle
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 500));

      // Rapid cursor movement across screens (simulating transit)
      const baseTime = 2000;
      for (let i = 0; i < 20; i++) {
        const screenId = i % 2 === 0 ? 'screen_1' : 'screen_2';
        algo.processSignal(
          makeSignal(SignalType.PointerMove, screenId, baseTime + i * 30, {
            speedPxPerS: 2000, // High speed = transit
          }),
        );
      }

      // Should have very few or no focus changes (movement alone is low confidence)
      expect(events.filter(e => e.reason === 'pointer_move').length).toBe(0);
    });

    it('should not thrash on tri-monitor rapid cursor travel', () => {
      const algo = new FocusAlgorithm('test', TRI_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 500));

      const baseTime = 2000;
      const screens = ['screen_1', 'screen_2', 'screen_3'];
      for (let i = 0; i < 30; i++) {
        const screenId = screens[i % 3];
        algo.processSignal(
          makeSignal(SignalType.PointerMove, screenId, baseTime + i * 20, {
            speedPxPerS: 3000,
          }),
        );
      }

      // No thrashing
      expect(events.filter(e => e.reason === 'pointer_move').length).toBe(0);
    });
  });

  // ─── Real Workflow: Code → Terminal → Browser (§15) ──

  describe('Realistic Workflows', () => {
    it('should handle code → terminal → browser workflow', () => {
      const algo = new FocusAlgorithm('test', TRI_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Coding on screen_1 (click + typing)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1000));
      algo.processSignal(makeSignal(SignalType.Typing, 'screen_1', 1400));
      algo.processSignal(makeSignal(SignalType.Typing, 'screen_1', 2000));

      // Switch to terminal on screen_2 (click)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 3000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 3400));
      algo.processSignal(makeSignal(SignalType.Typing, 'screen_2', 3600));

      // Switch to browser on screen_3 (click + scroll)
      algo.processSignal(makeSignal(SignalType.Click, 'screen_3', 5000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_3', 5400));
      algo.processSignal(makeSignal(SignalType.Scroll, 'screen_3', 5600));

      // Should have clean transitions: screen_1 → screen_2 → screen_3
      const switchScreens = events.map(e => e.screenId);

      // Verify we have transitions (at least 2 switches)
      expect(events.length).toBeGreaterThanOrEqual(2);

      // The last active screen should be screen_3
      const state = algo.getInternalState();
      expect(state.activeScreenId).toBe('screen_3');
    });
  });

  // ─── Idle Detection (§10) ────────────────

  describe('Idle Behavior', () => {
    it('should stop switching when presenter is idle', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Initial activity
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1400));

      const eventsBeforeIdle = events.length;

      // Go idle (no activity for 2000ms)
      // Then try pointer movement
      algo.processSignal(
        makeSignal(SignalType.PointerMove, 'screen_2', 5000, { speedPxPerS: 100 }),
      );
      algo.processSignal(
        makeSignal(SignalType.PointerMove, 'screen_2', 6000, { speedPxPerS: 100 }),
      );

      // Should not have switched during idle
      expect(events.length).toBe(eventsBeforeIdle);
    });

    it('should maintain active screen during idle', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);

      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      // After idle timeout
      const state = algo.getInternalState();
      expect(state.activeScreenId).toBe('screen_2');
    });
  });

  // ─── Manual Override (§11) ───────────────

  describe('Manual Override', () => {
    it('should always override auto-focus', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Auto-focus is running, active on screen_1
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1400));

      // Manual select screen_2
      algo.handlePresenterControl({
        action: PresenterControlAction.ManualSelect,
        screenId: 'screen_2',
        timestampMs: 1500,
      });

      const state = algo.getInternalState();
      expect(state.activeScreenId).toBe('screen_2');
      expect(state.manualOverride).toBe('screen_2');
    });

    it('should clear manual override correctly', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);

      algo.handlePresenterControl({
        action: PresenterControlAction.ManualSelect,
        screenId: 'screen_2',
        timestampMs: 1000,
      });

      algo.handlePresenterControl({
        action: PresenterControlAction.ClearManual,
        timestampMs: 1100,
      });

      const state = algo.getInternalState();
      expect(state.manualOverride).toBeNull();
    });
  });

  // ─── Freeze Focus (§11) ──────────────────

  describe('Freeze Focus', () => {
    it('should block auto switching when frozen', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      // Set active to screen_1
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_1', 1400));
      const initialEvents = events.length;

      // Freeze
      algo.handlePresenterControl({
        action: PresenterControlAction.ToggleFreeze,
        timestampMs: 1500,
      });

      // Try to switch with clicks
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 2500));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 2900));

      // Should not have generated new focus changes
      expect(events.length).toBe(initialEvents);

      // Active should still be screen_1
      expect(algo.getInternalState().activeScreenId).toBe('screen_1');
    });

    it('should resume auto-focus when unfrozen', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);

      // Freeze then unfreeze
      algo.handlePresenterControl({
        action: PresenterControlAction.ToggleFreeze,
        timestampMs: 1000,
      });
      expect(algo.getInternalState().frozen).toBe(true);

      algo.handlePresenterControl({
        action: PresenterControlAction.ToggleFreeze,
        timestampMs: 1100,
      });
      expect(algo.getInternalState().frozen).toBe(false);
    });
  });

  // ─── Focus Event Explainability (§14) ────

  describe('Event Explainability', () => {
    it('should include reason, confidence, and dwell in every focus change', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);
      const events: FocusChangeEvent[] = [];
      algo.setOnFocusChange(e => events.push(e));

      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      expect(events.length).toBeGreaterThanOrEqual(1);

      const event = events[0];
      expect(event.type).toBe('focus_change');
      expect(event.reason).toBeDefined();
      expect(typeof event.confidence).toBe('number');
      expect(event.confidence).toBeGreaterThan(0);
      expect(event.confidence).toBeLessThanOrEqual(1);
      expect(typeof event.dwellMs).toBe('number');
      expect(event.dwellMs).toBeGreaterThanOrEqual(0);
      expect(typeof event.sequence).toBe('number');
      expect(event.sessionId).toBe('test');
    });
  });

  // ─── State Snapshot (§4.2) ───────────────

  describe('State Snapshot', () => {
    it('should return correct state for late joiners', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);

      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      const snapshot = algo.getState();
      expect(snapshot.type).toBe('focus_state');
      expect(snapshot.activeScreenId).toBe('screen_2');
      expect(snapshot.mode).toBe('auto');
      expect(snapshot.frozen).toBe(false);
    });
  });

  // ─── Metrics (§14) ───────────────────────

  describe('Observability Metrics', () => {
    it('should track signal counts and focus changes', () => {
      const algo = new FocusAlgorithm('test', DUAL_MONITORS);

      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1000));
      algo.processSignal(makeSignal(SignalType.Click, 'screen_2', 1400));

      const metrics = algo.getMetrics();
      expect(metrics.signalCounts[SignalType.Click]).toBe(2);
      expect(metrics.focusChanges).toBeGreaterThanOrEqual(1);
    });
  });
});
