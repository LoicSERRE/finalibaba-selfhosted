// Pure goal-progress math (v1.14) - extracted so it's unit-testable and
// shared across N goals, instead of being computed once inline the way
// the old single global UserSettings.savingsGoalCents figure was.
export interface GoalProgress {
  pct: number; // 0-100, capped
  remaining: bigint; // targetCents - currentCents, floored at 0
}

export function computeGoalProgress(currentCents: bigint, targetCents: bigint): GoalProgress {
  // A non-positive target can't be divided into - the create/edit form
  // already requires targetCents > 0, so this only guards a stale/
  // malformed row rather than guessing a fallback that doesn't belong in
  // a pure math function.
  if (targetCents <= BigInt(0)) return { pct: 0, remaining: BigInt(0) };
  const pct = Math.min(Math.round((Number(currentCents) / Number(targetCents)) * 100), 100);
  const remaining = targetCents - currentCents > BigInt(0) ? targetCents - currentCents : BigInt(0);
  return { pct, remaining };
}
