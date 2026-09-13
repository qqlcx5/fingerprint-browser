import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
  type ConversationMinimapMarker,
} from '../lib/conversation-minimap'
import { clsx } from 'clsx'

const MAGNIFY_RADIUS = 46
const MAGNIFY_BOOST = 2.2
const OVERFLOW_EPSILON_PX = 16

interface ConversationMinimapProps {
  scrollRef: RefObject<HTMLDivElement | null>
  messages: Array<{ id: string; role: string; content?: string }>
}

export const ConversationMinimap = memo(function ConversationMinimap({
  scrollRef,
  messages,
}: ConversationMinimapProps): React.JSX.Element | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const [hovered, setHovered] = useState<{
    marker: ConversationMinimapMarker
    top: number
  } | null>(null)
  const [overflows, setOverflows] = useState(false)
  const overflowsRef = useRef(false)
  const railRef = useRef<HTMLDivElement>(null)
  const markerEls = useRef<Map<string, HTMLButtonElement>>(new Map())
  const cachedOffsetsRef = useRef<{ id: string; offset: number }[]>([])
  const magnifyCentersRef = useRef<{ id: string; center: number }[]>([])

  const markers = useMemo(() => buildConversationMinimapMarkers(messages), [messages])
  const markerIdentity = useMemo(() => markers.map((m) => m.id).join('\0'), [markers])

  // Check if content overflows scrollRef
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      if (overflowsRef.current) {
        overflowsRef.current = false
        setOverflows(false)
      }
      return
    }
    const isOverflowing = el.scrollHeight - el.clientHeight > OVERFLOW_EPSILON_PX
    if (isOverflowing !== overflowsRef.current) {
      overflowsRef.current = isOverflowing
      setOverflows(isOverflowing)
    }
  }, [scrollRef])

  // Recompute cached offsets from DOM once on resize or marker set changes
  const recomputeOffsets = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      cachedOffsetsRef.current = []
      return
    }
    const baseTop = el.getBoundingClientRect().top
    const markerIds = new Set(markers.map((marker) => marker.id))
    const out: { id: string; offset: number }[] = []
    el.querySelectorAll<HTMLElement>('[data-minimap-id]').forEach((node) => {
      const id = node.getAttribute('data-minimap-id') || ''
      if (!markerIds.has(id)) return
      out.push({
        id,
        offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
      })
    })
    cachedOffsetsRef.current = out
  }, [scrollRef, markers])

  // Measure dash centers in rail-local coordinates once per layout (read-only pass)
  const measureMagnifyCenters = useCallback(() => {
    const centers: { id: string; center: number }[] = []
    for (const [id, btn] of markerEls.current) {
      centers.push({ id, center: btn.offsetTop + btn.offsetHeight / 2 })
    }
    centers.sort((a, b) => a.center - b.center)
    magnifyCentersRef.current = centers
  }, [])

  // Track active marker based on scroll using binary search over cached offsets (O(log n))
  const updateActive = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const offsets = cachedOffsetsRef.current
    if (offsets.length === 0) {
      if (activeIdRef.current !== null) {
        activeIdRef.current = null
        setActiveId(null)
      }
      return
    }

    const anchor = el.scrollTop + el.clientHeight * 0.3
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (offsets[mid].offset <= anchor) lo = mid
      else hi = mid - 1
    }

    const id = offsets[lo].id
    if (id !== activeIdRef.current) {
      activeIdRef.current = id
      setActiveId(id)
    }
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let scrollRaf = 0
    let resizeRaf = 0

    const scheduleScroll = () => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(() => {
        updateActive()
        checkOverflow()
      })
    }

    const scheduleResize = () => {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        recomputeOffsets()
        updateActive()
        checkOverflow()
        measureMagnifyCenters()
      })
    }

    recomputeOffsets()
    checkOverflow()
    updateActive()
    measureMagnifyCenters()

    el.addEventListener('scroll', scheduleScroll, { passive: true })
    const ro = new ResizeObserver(scheduleResize)
    ro.observe(el)

    return () => {
      cancelAnimationFrame(scrollRaf)
      cancelAnimationFrame(resizeRaf)
      el.removeEventListener('scroll', scheduleScroll)
      ro.disconnect()
    }
  }, [scrollRef, recomputeOffsets, checkOverflow, updateActive, measureMagnifyCenters, markerIdentity])

  // Cosine magnification on hover: uses precomputed center positions to avoid DOM layout reads
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rail = railRef.current
    if (!rail) return

    const railRect = rail.getBoundingClientRect()
    const mouseY = e.clientY - railRect.top

    let closestMarker: ConversationMinimapMarker | null = null
    let closestDist = Infinity
    let closestTop = 0

    for (const item of magnifyCentersRef.current) {
      const el = markerEls.current.get(item.id)
      if (!el) continue

      const dist = Math.abs(mouseY - item.center)
      let factor = 1
      if (dist < MAGNIFY_RADIUS) {
        factor = 1 + (MAGNIFY_BOOST - 1) * Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2))
      }
      el.style.setProperty('--magnify', factor.toFixed(2))

      if (dist < closestDist) {
        closestDist = dist
        closestTop = item.center
        const m = markers.find((it) => it.id === item.id)
        if (m) closestMarker = m
      }
    }

    if (closestMarker && closestDist <= 32) {
      setHovered({ marker: closestMarker, top: closestTop })
    } else {
      setHovered(null)
    }
  }, [markers])

  const handleMouseLeave = useCallback(() => {
    for (const [, el] of markerEls.current) {
      el.style.removeProperty('--magnify')
    }
    setHovered(null)
  }, [])

  const jumpTo = useCallback((id: string) => {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector<HTMLElement>(`[data-minimap-id="${id}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [scrollRef])

  if (!shouldRenderConversationMinimap({ markerCount: markers.length, overflows })) {
    return null
  }

  return (
    <div
      ref={railRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="absolute right-2 top-12 bottom-20 z-20 flex w-4 select-none flex-col items-end justify-center py-4 opacity-70 hover:opacity-100 transition-opacity"
      aria-label="Conversation minimap"
    >
      <div className="flex flex-col items-end gap-1 w-full">
        {markers.map((marker) => {
          const isActive = marker.id === activeId
          const isUser = marker.role === 'user'

          return (
            <button
              key={marker.id}
              ref={(node) => {
                if (node) markerEls.current.set(marker.id, node)
                else markerEls.current.delete(marker.id)
              }}
              onClick={() => jumpTo(marker.id)}
              className={clsx(
                'relative h-1 rounded-full transition-[width,background-color] duration-75 origin-right',
                isUser
                  ? isActive
                    ? 'bg-accent-fg'
                    : 'bg-accent-fg/40 hover:bg-accent-fg/80'
                  : isActive
                    ? 'bg-primary'
                    : 'bg-dim/50 hover:bg-secondary'
              )}
              style={
                {
                  width: `calc(${isActive ? '12px' : '6px'} * var(--magnify, 1))`,
                } as CSSProperties
              }
              title={`${isUser ? 'User' : 'Assistant'}: ${marker.preview.slice(0, 40)}`}
            />
          )
        })}
      </div>

      {/* Floating preview popover */}
      {hovered && (
        <div
          className="pointer-events-none absolute right-6 z-30 w-64 rounded-lg border border-border bg-elevated p-2.5 shadow-xl text-xs backdrop-blur-md"
          style={{
            top: Math.max(8, Math.min(hovered.top - 40, (railRef.current?.clientHeight ?? 200) - 100)),
          }}
        >
          <div className="flex items-center justify-between pb-1 text-[11px] font-medium text-dim border-b border-border/60">
            <span className={clsx(hovered.marker.role === 'user' ? 'text-accent-fg font-semibold' : 'text-secondary')}>
              {hovered.marker.role === 'user' ? 'User' : 'Pi'}
            </span>
            <span className="text-[10px] text-dim">Click to jump</span>
          </div>
          <p className="mt-1 line-clamp-3 text-secondary text-[11px] leading-relaxed">
            {hovered.marker.preview || '(empty)'}
          </p>
        </div>
      )}
    </div>
  )
})
