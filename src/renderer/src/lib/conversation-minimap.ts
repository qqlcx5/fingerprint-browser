export interface ConversationMinimapMarker {
  id: string
  role: 'user' | 'assistant'
  preview: string
}

export const CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS = 280

export function shouldRenderConversationMinimap({
  markerCount,
  overflows,
  hasEarlier = false,
}: {
  markerCount: number
  overflows: boolean
  hasEarlier?: boolean
}): boolean {
  return hasEarlier || (markerCount >= 2 && overflows)
}

function appendPreview(current: string, next: string): string {
  if (!next || current.length >= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS) {
    return current
  }
  return `${current}${current ? '\n\n' : ''}${next}`.slice(
    0,
    CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS
  )
}

export function buildConversationMinimapMarkers(
  messages: Array<{ id: string; role: string; content?: string }>
): ConversationMinimapMarker[] {
  const markers: ConversationMinimapMarker[] = []
  let assistantMarkerIndex: number | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      markers.push({
        id: message.id,
        role: 'user',
        preview: (message.content || '')
          .trim()
          .slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      })
      assistantMarkerIndex = null
      continue
    }
    if (message.role !== 'assistant') continue

    const content = (message.content || '').trim()
    if (!content) continue
    if (assistantMarkerIndex === null) {
      markers.push({
        id: message.id,
        role: 'assistant',
        preview: content.slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      })
      assistantMarkerIndex = markers.length - 1
      continue
    }

    const marker = markers[assistantMarkerIndex]
    marker.preview = appendPreview(marker.preview, content)
  }

  return markers
}
