import assert from 'node:assert/strict'
import test from 'node:test'
import { offlineReply, presentReply } from './chatReply.ts'

test('offline chat state does not masquerade as a generated answer', () => {
  const result = offlineReply('Write a launch plan for my company')

  assert.match(result, /Cloud AI is unavailable/i)
  assert.match(result, /did not generate an answer/i)
  assert.doesNotMatch(result, /built-in placeholder|launch plan/i)
})

test('legacy offline history is presented as an operational state without mutation', () => {
  const legacy = '(Orcha could not reach its language model just now, so this is a built-in placeholder reply.)\n\nhi'
  const result = presentReply(legacy)

  assert.match(result, /Cloud AI is unavailable/i)
  assert.doesNotMatch(result, /built-in placeholder|\n\nhi/i)
  assert.equal(presentReply('A real answer'), 'A real answer')
})
