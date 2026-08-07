/** Shared numeric utility only — never country scoring behaviour. */
function scoreClamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}
