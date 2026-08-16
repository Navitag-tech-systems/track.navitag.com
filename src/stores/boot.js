import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';

/**
 * Boot progress model.
 *
 * The app's startup is six discrete, individually-observable phases, but until
 * now they collapsed into two booleans (`userStore.loading || deviceStore.loading`)
 * and rendered as an indeterminate spinner. Every one of those phases is already
 * awaited in order by the lifecycle service — this store just records when each
 * one starts and finishes so the splash can show real progress instead of a
 * shrug.
 *
 * A CHECKLIST, NOT A CURSOR. Steps are marked independently and may complete out
 * of order: the region lookup is kicked off in LifecycleService.init() and only
 * awaited later in startSession(), so it can land before or after auth restore.
 * Progress is the sum of completed weights, so ordering never matters.
 *
 * TWO GUARANTEES the UI depends on:
 *
 *  1. It never stalls. Between milestones the displayed value eases
 *     asymptotically toward the in-flight step's ceiling and never reaches it,
 *     so the bar keeps moving even through the country lookup's 60s worst case
 *     (5 attempts x 8s timeout + 20s of backoff — see user.js fetchCountryCode).
 *
 *  2. It never goes backwards. `ceiling` is strictly increasing: finishing a
 *     step adds its full weight to `settled` while removing only CREEP_FRACTION
 *     of it from `inFlight`, so the target always jumps forward.
 *
 * Five of the six milestones are genuinely observed. Only the intra-step creep
 * is synthetic — the bar is honest about where it is, not about how long the
 * current step will take.
 */

export const BOOT_STEPS = [
  { key: 'auth',    weight: 10, label: 'Starting up',                   slowAfter:  6000, slowLabel: 'Still starting up…' },
  { key: 'region',  weight: 10, label: 'Checking your region',          slowAfter:  8000, slowLabel: 'Your connection looks slow — still checking…' },
  { key: 'account', weight: 20, label: 'Syncing your account',          slowAfter:  8000, slowLabel: 'Still syncing your account…' },
  { key: 'server',  weight: 20, label: 'Connecting to tracking server', slowAfter: 10000, slowLabel: 'Still connecting to the tracking server…' },
  { key: 'devices', weight: 25, label: 'Loading your devices',          slowAfter: 10000, slowLabel: 'Still loading your devices…' },
  { key: 'live',    weight: 15, label: 'Going live',                    slowAfter:  8000, slowLabel: 'Waiting for the first live position…' },
];

/**
 * Which steps actually run, per entry point.
 *
 * A warm reconnect (foreground self-heal, manual retry, post-link refresh) never
 * re-runs auth restore or /user/sync — it resumes from the Traccar session. Its
 * weights are normalized to 100 within the flow, so a warm run still completes
 * at 100% instead of capping at 60%.
 */
export const BOOT_FLOWS = {
  cold: ['auth', 'region', 'account', 'server', 'devices', 'live'],
  warm: ['server', 'devices', 'live'],
};

const STEP_BY_KEY = Object.fromEntries(BOOT_STEPS.map(s => [s.key, s]));

// How far into the in-flight step creep may reach. Strictly < 1 so the bar can
// never claim a step is finished before it is.
const CREEP_FRACTION = 0.9;
// Easing time constant. Higher = lazier crawl toward the ceiling.
const CREEP_TAU_MS = 900;
// Clamp per-frame delta so a backgrounded tab resuming after minutes doesn't
// snap the bar forward in one jump.
const MAX_FRAME_MS = 250;

export const useBootStore = defineStore('boot', () => {
  const mode = ref('cold');
  const flow = ref(BOOT_FLOWS.cold);

  const status = reactive({});     // key -> 'idle' | 'active' | 'done'
  const startedAt = reactive({});  // key -> epoch ms

  // Steps that finished without producing a usable result but are NOT fatal —
  // currently only the region lookup, which is allowed to fail (see 4f).
  const degraded = ref([]);
  // A step that failed fatally. Boot is dead; <Error /> owns the screen.
  const failedKey = ref(null);
  // Set by whoever owns the timeout (devices store's live watchdog). Freezes
  // the bar rather than letting it creep against something that isn't coming.
  const stalled = ref(false);

  const started = ref(false);
  const displayed = ref(0);
  const now = ref(Date.now());

  // --- Derived ---

  const totalWeight = computed(() =>
    flow.value.reduce((n, key) => n + STEP_BY_KEY[key].weight, 0)
  );
  const scale = computed(() => (totalWeight.value > 0 ? 100 / totalWeight.value : 0));

  const settled = computed(() =>
    flow.value.reduce((n, key) => (status[key] === 'done' ? n + STEP_BY_KEY[key].weight : n), 0)
    * scale.value
  );
  const inFlight = computed(() =>
    flow.value.reduce((n, key) => (status[key] === 'active' ? n + STEP_BY_KEY[key].weight : n), 0)
    * scale.value
  );
  const ceiling = computed(() =>
    Math.min(100, settled.value + inFlight.value * CREEP_FRACTION)
  );

  const complete = computed(() =>
    started.value && flow.value.every(key => status[key] === 'done')
  );
  // `stalled` counts as not-in-progress: whatever we were waiting on isn't
  // coming, so there is nothing left to animate and nothing left to report.
  // Without it the bar freezes mid-track and stays on screen indefinitely.
  const inProgress = computed(() =>
    started.value && !complete.value && failedKey.value === null && !stalled.value
  );

  // The step the label speaks for: whatever is in flight, else the next one
  // still waiting. Never empty while a boot is underway.
  const currentStep = computed(() => {
    const key = flow.value.find(k => status[k] === 'active')
      ?? flow.value.find(k => status[k] === 'idle');
    return key ? STEP_BY_KEY[key] : null;
  });

  const slow = computed(() => {
    const step = currentStep.value;
    if (!step || status[step.key] !== 'active') return false;
    const t = startedAt[step.key];
    return !!t && (now.value - t) >= step.slowAfter;
  });

  const label = computed(() => {
    if (complete.value) return 'Ready';
    const step = currentStep.value;
    if (!step) return 'Loading…';
    return slow.value && step.slowLabel ? step.slowLabel : step.label;
  });

  const progress = computed(() => Math.round(displayed.value * 10) / 10);

  // --- Animation loop ---

  const canAnimate = typeof requestAnimationFrame === 'function';
  let rafId = null;
  let lastTs = 0;

  // `inProgress` already excludes complete / failed / stalled.
  function shouldRun() {
    return inProgress.value;
  }

  function schedule() {
    if (!canAnimate || rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null && canAnimate) cancelAnimationFrame(rafId);
    rafId = null;
    lastTs = 0;
  }

  function tick(ts) {
    rafId = null;
    const dt = lastTs ? Math.min(ts - lastTs, MAX_FRAME_MS) : 16;
    lastTs = ts;
    now.value = Date.now();

    const target = ceiling.value;
    if (displayed.value < target) {
      displayed.value += (target - displayed.value) * (1 - Math.exp(-dt / CREEP_TAU_MS));
      // Snap the last sliver so the value settles instead of asymptoting forever.
      if (target - displayed.value < 0.05) displayed.value = target;
    }

    if (shouldRun()) schedule();
    else stopLoop();
  }

  // Called after every state mutation. Keeps the loop running exactly as long as
  // there is something to animate, and degrades to instant jumps where rAF does
  // not exist (jsdom under vitest).
  function sync() {
    if (complete.value) {
      stopLoop();
      displayed.value = 100;
      return;
    }
    if (!canAnimate) {
      if (displayed.value < ceiling.value) displayed.value = ceiling.value;
      return;
    }
    if (shouldRun()) schedule();
    else stopLoop();
  }

  // --- Actions ---

  /** Start a fresh run of `nextMode`'s flow, from 0. */
  function reset(nextMode = 'cold') {
    stopLoop();
    mode.value = nextMode;
    flow.value = BOOT_FLOWS[nextMode] || BOOT_FLOWS.cold;

    for (const key of Object.keys(status)) delete status[key];
    for (const key of Object.keys(startedAt)) delete startedAt[key];
    for (const key of flow.value) status[key] = 'idle';

    degraded.value = [];
    failedKey.value = null;
    stalled.value = false;
    started.value = false;
    displayed.value = 0;
    now.value = Date.now();
  }

  /**
   * Switch to `nextMode`, but only when that actually means starting over.
   *
   * Used by startSession, which must NOT rewind the bar on the ordinary first
   * boot — init() already opened the cold flow and auth/region are in flight.
   * It must restart when the flow differs (a warm reconnect ran in between) or
   * when the previous run is dead, so a user tapping Retry on <Error /> gets a
   * fresh run instead of resuming a frozen one.
   */
  function ensureFlow(nextMode) {
    if (mode.value !== nextMode || failedKey.value !== null || stalled.value) {
      reset(nextMode);
    }
  }

  function begin(key) {
    if (!(key in status)) return; // not part of the active flow
    started.value = true;
    if (status[key] === 'idle') {
      status[key] = 'active';
      startedAt[key] = Date.now();
      now.value = startedAt[key];
    }
    sync();
  }

  /**
   * Mark a step finished. Idempotent — `done('live')` is called from
   * processSocketData, which fires on every socket frame.
   *
   * `degraded: true` means "finished, but without a usable result, and that is
   * survivable". Progress still advances; the failure is recorded for anything
   * that wants to surface it. Fatal failures use fail() instead.
   */
  function done(key, { degraded: isDegraded = false } = {}) {
    if (!(key in status)) return;
    // Deliberately does NOT set `started`. Only begin() opens a run. A late
    // callback landing after a reset — the country lookup resolving once the
    // user is already on the login screen — would otherwise re-open a run that
    // was just stood down, and `inProgress` would never go false again.
    if (status[key] !== 'done') {
      status[key] = 'done';
      // Something landed, so whatever we had given up waiting for is no longer
      // stalled. Without this a late socket frame (one that arrives after the
      // 20s watchdog) completes the run but leaves `stalled` set, which then
      // makes ensureFlow reset a perfectly healthy flow on the next call.
      stalled.value = false;
      if (isDegraded && !degraded.value.includes(key)) {
        degraded.value = [...degraded.value, key];
      }
    }
    sync();
  }

  /** Terminal failure. Freezes progress; the caller raises <Error />. */
  function fail(key) {
    if (!(key in status)) return;
    // Same reasoning as done(): a failure cannot open a run, only close one.
    failedKey.value = key;
    sync();
  }

  /** Finish every remaining step (e.g. the zero-device teaser path). */
  function completeAll() {
    started.value = true;
    for (const key of flow.value) {
      if (status[key] !== 'done') status[key] = 'done';
    }
    sync();
  }

  /** Something we were waiting on never arrived. Stop creeping against it. */
  function markStalled() {
    stalled.value = true;
    sync();
  }

  // Populate `status` up front. Every action no-ops on a key that isn't in the
  // active flow, so without this the store would silently ignore everything if
  // LifecycleService.init() hadn't run yet (tests, or any future entry point
  // that reaches a store before the lifecycle boots).
  reset('cold');

  return {
    // state
    mode, flow, status, degraded, failedKey, stalled,
    // derived
    progress, label, slow, complete, inProgress, currentStep,
    // actions
    reset, ensureFlow, begin, done, fail, completeAll, markStalled,
  };
});
