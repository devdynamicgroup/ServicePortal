/** Japan — turbidity & residual chlorine emphasized.
 * PD-013 A: KEEP all magnitudes for the 5 scored parameters.
 * PD-012 B: DO is not part of Japan's Compliance Index — classified
 * NOT_EVALUATED (see japan/score.js) and, as of 2026-08-19, genuinely
 * excluded here too (no `do` key), mirroring Thailand's existing
 * do/temp omission in thailand/weights.js. Before 2026-08-19 this file
 * carried a `do: 0.12` entry documented as "retained but skipped in
 * num/den" — that skip was real when each engine had its own hand-written
 * aggregation, but the 2026-08-19 shared weighted-aggregation fix
 * (computeSharedBenchmarkBase) has no way to know about a per-engine
 * "keep the weight but don't use it" carve-out; it only sees whichever
 * keys are present, so `do: 0.12` was silently pulling a poor DO grade
 * into Japan's score even while classifications.do read NOT_EVALUATED.
 * Removing the key (not just zeroing it) is the actual fix — DO now
 * contributes 0 to Japan's composite, consistent with never judging it. */
window.JapanBenchmarkWeights = Object.freeze({
  turbidity: 0.22,
  chlorine: 0.22,
  ph: 0.16,
  tds: 0.16,
  orp: 0.12
});
