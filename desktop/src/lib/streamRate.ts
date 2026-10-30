/**
 * Live output rate for the desktop composer.
 *
 * The same shape as the phone shell's `mobile/src/core/streamRate.ts`: a sliding
 * window over the last few seconds, `null` whenever the honest answer is "we do
 * not know" — too little history, a stall, or a clock that went backwards.
 *
 * Two differences from the phone shell, both deliberate:
 * - The input is a character count, not a token count, so the caller converts
 *   with `CHARS_PER_TOKEN`. The estimate is labelled as an estimate in the UI.
 * - A stall decays the rate instead of freezing it: the window slides forward
 *   over samples that stopped growing, so the number falls towards zero and
 *   then disappears once the stall passes `RATE_STALL_MS`. Keeping the last
 *   reading on screen would claim a speed the model is not producing.
 */

export const CHARS_PER_TOKEN = 4
/** The rate only looks at the last this many milliseconds. */
export const RATE_WINDOW_MS = 5_000
/** The window's first and last samples must be at least this far apart. */
export const RATE_MIN_SPAN_MS = 1_000
/** No new output for this long means the model is not producing. */
export const RATE_STALL_MS = 3_000
const MAX_SAMPLES = 24

export type RateSample = { at: number; chars: number }

/**
 * Appends a sample.
 *
 * A clock that went backwards or a counter that fell means the session was
 * resynchronised or a new turn began: the old window is void, so the series
 * restarts from this sample instead of producing a negative rate.
 */
export function pushRateSample(
  samples: readonly RateSample[],
  sample: RateSample,
): RateSample[] {
  if (!Number.isFinite(sample.at) || !Number.isFinite(sample.chars) || sample.chars < 0) {
    return [...samples]
  }
  const last = samples.at(-1)
  if (last && (sample.at < last.at || sample.chars < last.chars)) return [sample]
  const next = last && sample.at === last.at
    ? [...samples.slice(0, -1), sample]
    : [...samples, sample]
  const oldest = sample.at - (RATE_WINDOW_MS + RATE_STALL_MS)
  // The oldest sample is kept until it falls just past the window: the stall
  // check needs it as its reference point.
  let start = 0
  while (start < next.length - 1 && next[start + 1]!.at <= oldest) start++
  return next.slice(Math.max(start, next.length - MAX_SAMPLES))
}

/**
 * The recent output rate in tokens per second, or `null` when there is no
 * honest reading.
 *
 * `null` means "do not show a number": no samples yet, a window too short to
 * average, a stall, a stopped sampler, or a clock that went backwards. It never
 * means zero — zero is a measurement, and pretending to have one is a lie the
 * user then budgets against.
 */
export function streamRate(samples: readonly RateSample[], now: number): number | null {
  const last = samples.at(-1)
  if (!last || !Number.isFinite(now)) return null
  // The sampler stopped (window hidden, timer suspended) or the clock went
  // backwards: show nothing rather than a stale reading.
  if (now < last.at || now - last.at > RATE_STALL_MS) return null
  const stallRef = [...samples].reverse().find((sample) => sample.at <= last.at - RATE_STALL_MS)
  if (stallRef && last.chars - stallRef.chars <= 0) return null
  const first = samples.find((sample) => sample.at >= last.at - RATE_WINDOW_MS)
  if (!first || last.at - first.at < RATE_MIN_SPAN_MS) return null
  const delta = last.chars - first.chars
  if (delta <= 0) return null
  return delta / CHARS_PER_TOKEN / ((last.at - first.at) / 1000)
}
