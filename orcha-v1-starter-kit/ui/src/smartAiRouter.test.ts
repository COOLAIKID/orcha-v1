import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  estimateTokens,
  getUsage,
  isChallenging,
  planRoute,
  resetUsage,
  routeChat,
  seedMockUsers,
  slidingWindow,
  SMART_ROUTER,
} from './smartAiRouter.ts'

before(() => {
  process.env.SMART_ROUTER_MOCK = '1'
  delete process.env.OPENAI_API_KEY
  delete process.env.GROQ_API_KEY
  delete process.env.GEMINI_API_KEY
  seedMockUsers()
})

after(() => {
  delete process.env.OPENROUTER_API_KEY
  seedMockUsers()
})

test('mock users start at 0% and 100% premium usage', () => {
  assert.equal(getUsage('user-under-limit').percent, 0)
  assert.equal(getUsage('user-under-limit').infinite, false)
  assert.equal(getUsage('user-at-limit').percent, 100)
  assert.equal(getUsage('user-at-limit').infinite, true)
  assert.equal(SMART_ROUTER.priceUsd, 20)
  assert.equal(SMART_ROUTER.vmUsd, 10)
  assert.equal(SMART_ROUTER.premiumTokenBudget, 50_000)
  assert.equal(SMART_ROUTER.frontierUsdBudget, 5)
})

test('Tier 1 keeps the full system prompt and history with zero delay', () => {
  const history = [
    { role: 'user', content: 'First turn about a bakery' },
    { role: 'orcha', content: 'Who is it for?' },
    { role: 'user', content: 'Second turn, local shop' },
    { role: 'orcha', content: 'Deadline?' },
    { role: 'user', content: 'Third turn, this Friday' },
  ]
  const plan = planRoute('user-under-limit', history, 'Be terse.')
  assert.equal(plan.tier, 'premium')
  assert.equal(plan.provider, 'gemini')
  assert.equal(plan.delayedMs, 0)
  assert.match(plan.system, /autonomous AI company builder/)
  assert.match(plan.system, /Be terse/)
  assert.equal(plan.messages.length, 5)
})

test('Tier 2 strips the system prompt to one sentence and keeps the last 2 turns', () => {
  const history = [
    { role: 'user', content: 'One' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'Two' },
    { role: 'assistant', content: 'B' },
    { role: 'user', content: 'Three' },
    { role: 'assistant', content: 'C' },
    { role: 'user', content: 'Four' },
  ]
  const plan = planRoute('user-at-limit', history, 'A very long custom instruction that must disappear in infinite mode.')
  assert.equal(plan.tier, 'infinite')
  assert.equal(plan.delayedMs, SMART_ROUTER.tier2DelayMs)
  assert.equal(plan.system, 'You are Orcha, an AI company builder; answer this latest question clearly and briefly.')
  assert.doesNotMatch(plan.system, /custom instruction/)
  assert.deepEqual(plan.messages.map((msg) => msg.content), ['B', 'Three', 'C', 'Four'])
  assert.deepEqual(slidingWindow(history).map((msg) => msg.content), ['B', 'Three', 'C', 'Four'])
})

test('challenging questions are detected, but frontier stays off without a paid key', () => {
  assert.equal(isChallenging([{ role: 'user', content: 'hi' }]), false)
  assert.equal(isChallenging([{ role: 'user', content: 'Design a production-grade architecture for this.' }]), true)
  const plan = planRoute('user-under-limit', [
    { role: 'user', content: 'Design a production-grade architecture for this.' },
  ])
  assert.equal(plan.tier, 'premium')
})

test('a free model ranked above GPT-5.6 takes general and advanced work', async () => {
  process.env.OPENROUTER_API_KEY = 'test'
  const easy = planRoute('user-under-limit', [{ role: 'user', content: 'Hello' }])
  const hard = planRoute('user-at-limit', [
    { role: 'user', content: 'Design a production-grade architecture for this.' },
    { role: 'assistant', content: 'A' },
    { role: 'user', content: 'Continue with the full system' },
  ])
  assert.equal(easy.tier, 'star')
  assert.equal(easy.model, 'stealth/ox-alpha')
  assert.equal(easy.delayedMs, 0)
  assert.equal(hard.tier, 'star')
  assert.equal(hard.messages.length, 3)
  assert.match(hard.system, /autonomous AI company builder/)
  const video = planRoute('user-under-limit', [{ role: 'user', content: 'Create a 15 second product video ad' }])
  assert.match(video.system, /outsourced/)
  const routed = await routeChat({
    userId: 'user-under-limit',
    messages: [{ role: 'user', content: 'Create a 15 second product video ad' }],
    onDelta: () => {},
  })
  assert.equal(routed.videoOutsourced, true)
  assert.equal(routed.tier, 'star')
  delete process.env.OPENROUTER_API_KEY
})

test('mock dispatch records premium tokens for the under-limit user', async () => {
  resetUsage('user-under-limit', 0)
  const chunks: string[] = []
  const routed = await routeChat({
    userId: 'user-under-limit',
    messages: [{ role: 'user', content: 'Hello Orcha' }],
    onDelta: (text) => chunks.push(text),
  })
  assert.equal(routed.tier, 'premium')
  assert.equal(chunks.join(''), `mock:premium:${SMART_ROUTER.geminiModel}`)
  assert.ok(getUsage('user-under-limit').premiumTokens > 0)
  assert.ok(estimateTokens('abcd') >= 1)
})
