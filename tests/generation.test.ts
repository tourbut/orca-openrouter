import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCurrentGeneration, nextGeneration } from '../src/shared/generation.ts'

test('UI request generations ignore older responses after period or disconnect changes', () => {
  let generation = 0
  generation = nextGeneration(generation)
  const first = generation
  generation = nextGeneration(generation)
  assert.equal(isCurrentGeneration(first, generation), false)
  assert.equal(isCurrentGeneration(generation, generation), true)
})
