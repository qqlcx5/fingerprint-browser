import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
} from './conversation-minimap'

test('shouldRenderConversationMinimap returns true when overflowing with >=2 markers', () => {
  assert.equal(
    shouldRenderConversationMinimap({ markerCount: 2, overflows: true }),
    true
  )
  assert.equal(
    shouldRenderConversationMinimap({ markerCount: 1, overflows: true }),
    false
  )
  assert.equal(
    shouldRenderConversationMinimap({ markerCount: 5, overflows: false }),
    false
  )
  assert.equal(
    shouldRenderConversationMinimap({ markerCount: 0, overflows: false, hasEarlier: true }),
    true
  )
})

test('buildConversationMinimapMarkers constructs user and assistant markers', () => {
  const messages = [
    { id: '1', role: 'user', content: 'Hello agent' },
    { id: '2', role: 'assistant', content: 'Hello human!' },
    { id: '3', role: 'user', content: 'Can you write code?' },
    { id: '4', role: 'assistant', content: 'Sure, here is some code' },
  ]

  const markers = buildConversationMinimapMarkers(messages)
  assert.equal(markers.length, 4)
  assert.equal(markers[0].role, 'user')
  assert.equal(markers[0].preview, 'Hello agent')
  assert.equal(markers[1].role, 'assistant')
  assert.equal(markers[1].preview, 'Hello human!')
})
