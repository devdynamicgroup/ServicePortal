/** Shared numeric utility only — never country scoring behaviour. */
function scoreClamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerce a reading value to a finite number, rejecting null/undefined/""/non-numeric.
 * Returns the finite number or NaN (which will fail Number.isFinite checks downstream).
 */
function toFiniteReading(value) {
  if (value === null || value === undefined || value === '' || value === false) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}
