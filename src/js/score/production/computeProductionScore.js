/**
 * Legacy Production / Share Water Score — WHO (DWQI) formula.
 *
 * FROZEN REFERENCE: do not alter this curve. Benchmark engines must not call
 * this for country-specific comparison logic (WHO benchmark owns its own copy).
 *
 * Active published/share Water Quality Score is Quality V2
 * (`computeQualityScoreV2.js` → `computeScoreFromReadings`).
 *
 * Missing keys stay missing — do not substitute demo/example numbers.
 */
function computeLegacyDwqiScore(readings) {
  const ph = Number(readings.ph);
  const tds = Number(readings.tds);
  const turb = Number(readings.turbidity);
  const orp = Number(readings.orp);
  const fcl = Number(readings.chlorine);
  const do_ = Number(readings.do);
  console.log('LEGACY DWQI PARAMETER VALUES', { ph, tds, turbidity: turb, orp, chlorine: fcl, do: do_ });
  if (![ph, tds, turb, orp, fcl, do_].every(Number.isFinite)) {
    console.log('LEGACY DWQI SCORE skipped — incomplete readings');
    return null;
  }
  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const pHs = ph >= 6.5 && ph <= 8.5 ? 100 : ph >= 6 && ph <= 9 ? 70 : ph >= 5.5 && ph <= 9.5 ? 40 : 15;
  const tdss = tds <= 300 ? 100 : tds <= 600 ? 100 - (tds - 300) / 300 * 20 : tds <= 1000 ? 80 - (tds - 600) / 400 * 30 : clamp(50 - (tds - 1000) / 30);
  const turbs = turb <= 1 ? 100 : turb <= 5 ? 100 - (turb - 1) / 4 * 30 : turb <= 10 ? 70 - (turb - 5) / 5 * 40 : clamp(30 - (turb - 10) * 3);
  const orps = orp >= 200 && orp <= 600 ? 100 : orp < 200 ? clamp(orp / 200 * 100) : clamp(100 - (orp - 600) / 10);
  const cls = fcl >= 0.2 && fcl <= 0.5 ? 100 : fcl <= 1 ? 80 : fcl <= 2 ? 50 : 25;
  const dos = do_ >= 6 ? 100 : clamp(do_ / 6 * 100);
  const score = Math.round((pHs + tdss + turbs + orps + cls + dos) / 6);
  console.log('LEGACY DWQI SCORE', score, { pHs, tdss, turbs, orps, cls, dos });
  return score;
}

if (typeof window !== 'undefined') {
  window.computeLegacyDwqiScore = computeLegacyDwqiScore;
}
if (typeof globalThis !== 'undefined') {
  globalThis.computeLegacyDwqiScore = computeLegacyDwqiScore;
}
