/**
 * The `laya_plan` contract, kept in its own module for two reasons.
 *
 * 1. **It can be tested here.** `index.js` imports `@deepseek-ai/dsh-tools`,
 *    which only resolves inside a harness profile, so anything defined in that
 *    file can be exercised only by mounting the plugin. This module imports
 *    nothing and runs under bare `node --test`.
 * 2. **The schema and the payload must be read side by side.** The sibling
 *    `jevcore` plugin once shipped a tool whose schema described a different
 *    shape from the one it returned, so every call failed validation - and this
 *    tool then repeated that mistake in a different way, returning `fits: null`
 *    under `{type: 'boolean'}`. Nothing noticed, because `package.json` declared
 *    a `test` script and there was no test behind it. `test/plan.test.js` now
 *    asserts that everything `shapePlan` can produce validates against
 *    `PLAN_OUTPUT_SCHEMA`, including the empty and truncated cases.
 */

/** Every field `shapePlan` can emit. `additionalProperties: false` is load-bearing. */
export const PLAN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    checkpoint: { type: 'string' },
    max_len: { type: 'number' },
    head_max_len: { type: 'number' },
    exact: { type: 'boolean' },
    state_chars: { type: 'number' },
    state_tokens_estimated: { type: 'number' },
    fits: { type: 'boolean' },
    questions: { type: 'json' },
    warnings: { type: 'json' },
    recommendation: { type: 'string' },
    worst_question: { type: 'string' },
    tightest_option_tokens_each: { type: 'number' },
  },
  additionalProperties: false,
}

/**
 * Rebuild the sidecar's plan field by field.
 *
 * Optional fields are **omitted**, never set to null. `recommendation` is null
 * whenever a request fits and `worst_question` is absent when there are no
 * questions at all, and `{type: 'string'}` rejects null - so a plain spread of
 * the payload would reintroduce exactly the failure this module was written to
 * end.
 */
export const shapePlan = (plan) => {
  const source = plan && typeof plan === 'object' ? plan : {}
  return {
    checkpoint: String(source.checkpoint ?? 'unknown'),
    max_len: Number(source.max_len ?? 0),
    head_max_len: Number(source.head_max_len ?? 0),
    exact: source.exact === true,
    state_chars: Number(source.state_chars ?? 0),
    state_tokens_estimated: Number(source.state_tokens_estimated ?? 0),
    // Coerced, not passed through: `fits` is the field the schema is strictest
    // about, and it is the one that was null.
    fits: source.fits === true,
    questions: source.questions ?? [],
    warnings: source.warnings ?? [],
    ...(source.recommendation ? { recommendation: String(source.recommendation) } : {}),
    ...(source.worst_question ? { worst_question: String(source.worst_question) } : {}),
    ...(typeof source.tightest_option_tokens_each === 'number'
      ? { tightest_option_tokens_each: source.tightest_option_tokens_each }
      : {}),
  }
}

/**
 * One line for the tool card.
 *
 * `fits` is now always a real boolean, so this can be honest in both directions.
 * The previous version read a null `fits` as falsy and announced "DOES NOT FIT"
 * on a request that fitted comfortably.
 */
export const summarizePlan = (value) => {
  if (!value || typeof value !== 'object') return 'laya plan: no result'
  const budget =
    `~${value.state_tokens_estimated ?? '?'} state tokens, ` +
    `head_max_len=${value.head_max_len ?? '?'}`
  if (value.fits) return `laya plan: fits (${budget})`
  return `laya plan: DOES NOT FIT — ${value.recommendation ?? 'the state would be truncated'}`
}
