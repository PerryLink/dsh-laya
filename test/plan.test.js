/**
 * The regression test `package.json` has been claiming to run since the first
 * commit.
 *
 * It exists because of a specific defect: `laya_plan` returned `fits: null`
 * under a schema that declared `{type: 'boolean'}`, so the tool failed output
 * validation on **every** call - and the plugin's own comments bragged that this
 * exact class of bug had been avoided in the sibling tool. Nothing caught it
 * because this file did not exist.
 *
 * The assertions below are deliberately about the *contract* rather than about
 * the model: no sidecar, no harness, no network. `shapePlan` and
 * `PLAN_OUTPUT_SCHEMA` live in `../plan.js`, which imports nothing, so this runs
 * under bare `node --test`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { PLAN_OUTPUT_SCHEMA, shapePlan, summarizePlan } from '../plan.js'

/** The subset of JSON Schema this contract actually uses. */
const KINDS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  json: () => true,
}

/**
 * Report every way `value` violates `schema`.
 *
 * A hand-rolled checker rather than a JSON Schema library: the contract uses
 * four keywords, and a test that needs a dependency installed is a test that
 * silently stops running.
 */
const violations = (value, schema, path = 'value') => {
  const found = []

  if (schema.type && !KINDS[schema.type](value)) {
    found.push(`${path} must be ${schema.type}, got ${JSON.stringify(value)}`)
    return found
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) found.push(`${path}.${key} is not declared in the schema`)
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) found.push(...violations(value[key], sub, `${path}.${key}`))
    }
  }
  return found
}

const assertValid = (payload) => {
  const found = violations(payload, PLAN_OUTPUT_SCHEMA)
  assert.deepEqual(found, [], `payload does not satisfy the declared schema:\n${found.join('\n')}`)
}

/** What `GET /capabilities`-derived planning actually returns, trimmed. */
const fittingPlan = {
  checkpoint: 'english',
  max_len: 1024,
  head_max_len: 512,
  exact: false,
  questions: [
    {
      question_id: 'q1',
      type: 'noul',
      option_count: 2,
      option_tokens_each: 49,
      options_compressed: false,
      head_tokens_estimated: 109,
      state_tokens_estimated: 35,
      state_room_estimated: 914,
      would_truncate_state: false,
    },
  ],
  state_chars: 31,
  state_tokens_estimated: 35,
  fits: true,
  warnings: [],
  recommendation: null,
  worst_question: 'q1',
  tightest_option_tokens_each: 49,
}

test('the field that was null is a boolean', () => {
  const shaped = shapePlan(fittingPlan)
  assert.equal(typeof shaped.fits, 'boolean')
  assert.equal(shaped.fits, true)
  assertValid(shaped)
})

test('a null fits becomes false rather than staying null', () => {
  // The exact payload the old implementation produced, and the reason every call
  // failed: the schema says boolean and the value was null.
  const shaped = shapePlan({ ...fittingPlan, fits: null })
  assert.equal(shaped.fits, false)
  assertValid(shaped)
})

test('null optional fields are omitted, not forwarded', () => {
  const shaped = shapePlan(fittingPlan)
  assert.equal('recommendation' in shaped, false, 'null recommendation must be dropped')
  assertValid(shaped)
})

test('an overflowing plan validates and keeps its recommendation', () => {
  const shaped = shapePlan({
    ...fittingPlan,
    fits: false,
    state_chars: 9000,
    state_tokens_estimated: 2588,
    recommendation: 'about 512 tokens of state fit at head_max_len=512',
    warnings: ['the state would be truncated'],
  })
  assert.equal(shaped.fits, false)
  assert.match(shaped.recommendation, /tokens of state fit/)
  assertValid(shaped)
})

test('a plan with no questions at all still validates', () => {
  // `worst_question` and `tightest_option_tokens_each` are absent here, which is
  // what the sidecar returns for an empty question map.
  const shaped = shapePlan({
    checkpoint: 'english',
    max_len: 1024,
    head_max_len: 512,
    exact: false,
    questions: [],
    state_chars: 0,
    state_tokens_estimated: 0,
    fits: true,
    warnings: [],
  })
  assertValid(shaped)
  assert.equal('worst_question' in shaped, false)
  assert.equal('tightest_option_tokens_each' in shaped, false)
})

test('an undeclared field from the sidecar is dropped, not passed through', () => {
  // additionalProperties:false makes an unexpected field a validation failure,
  // so the shape has to be a whitelist rather than a copy.
  const shaped = shapePlan({ ...fittingPlan, something_new_upstream: 42 })
  assert.equal('something_new_upstream' in shaped, false)
  assertValid(shaped)
})

test('a malformed payload still produces a valid object', () => {
  for (const bad of [null, undefined, 'nonsense', 42, []]) {
    const shaped = shapePlan(bad)
    assertValid(shaped)
    assert.equal(typeof shaped.fits, 'boolean')
  }
})

test('the summary never calls a fitting request a failure', () => {
  // The old presentationMeta read `value?.fits` and rendered "DOES NOT FIT" for
  // a null - on a request that fitted comfortably.
  const summary = summarizePlan(shapePlan(fittingPlan))
  assert.match(summary, /^laya plan: fits/)
  assert.doesNotMatch(summary, /DOES NOT FIT/)
})

test('the summary announces a real overflow with its reason', () => {
  const summary = summarizePlan(
    shapePlan({ ...fittingPlan, fits: false, recommendation: 'shorten the state' }),
  )
  assert.match(summary, /DOES NOT FIT/)
  assert.match(summary, /shorten the state/)
})

test('every declared property is actually reachable', () => {
  // A schema may not describe a field that can never appear: that is how a
  // schema and a payload drift apart in the first place.
  const shaped = shapePlan({
    checkpoint: 'english',
    max_len: 1,
    head_max_len: 1,
    exact: true,
    questions: [],
    state_chars: 1,
    state_tokens_estimated: 1,
    fits: true,
    warnings: [],
    recommendation: 'r',
    worst_question: 'w',
    tightest_option_tokens_each: 1,
  })
  const declared = Object.keys(PLAN_OUTPUT_SCHEMA.properties)
  assert.deepEqual(
    declared.filter((key) => !(key in shaped)),
    [],
    'the schema declares fields shapePlan cannot produce',
  )
  assertValid(shaped)
})
