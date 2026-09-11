/**
 * P2-2 — single-instance overlap guard for the active-probe scheduler.
 * Lives in lib (not the route module) because Next.js route files may only
 * export HTTP handlers + config. Best-effort: guards one server instance;
 * multi-instance deploys should add a DB lease.
 */
let cycleInFlight = false;

export function isProbeCycleInFlight(): boolean {
  return cycleInFlight;
}

export function markProbeCycleStarted(): boolean {
  if (cycleInFlight) return false;
  cycleInFlight = true;
  return true;
}

export function markProbeCycleFinished(): void {
  cycleInFlight = false;
}

/** Test-only reset (unit tests share module state). */
export function __resetProbeOverlapForTests(): void {
  cycleInFlight = false;
}
