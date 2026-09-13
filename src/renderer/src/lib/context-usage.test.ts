import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  usageTokenTotal,
  contextOccupancyTokens,
  calculateCacheRate,
  calculateTokenRate,
} from './context-usage'

test('usageTokenTotal calculates total or sums input + output', () => {
  assert.equal(usageTokenTotal({ totalTokens: 100 }), 100)
  assert.equal(usageTokenTotal({ inputTokens: 40, outputTokens: 60 }), 100)
  assert.equal(usageTokenTotal(undefined), 0)
})

test('contextOccupancyTokens includes reasoning and cache', () => {
  assert.equal(
    contextOccupancyTokens({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 30,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
    }),
    430
  )
})

test('calculateCacheRate calculates hit percentage correctly', () => {
  assert.equal(
    calculateCacheRate({
      inputTokens: 100,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
    }),
    80
  )
  assert.equal(calculateCacheRate(undefined), 0)
})

test('calculateTokenRate calculates tokens per second', () => {
  assert.equal(calculateTokenRate(100, 2000), 50)
  assert.equal(calculateTokenRate(0, 1000), 0)
  assert.equal(calculateTokenRate(100, 0), 0)
})
