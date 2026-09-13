import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store'
import {
  usageTokenTotal,
  contextOccupancyTokens,
  calculateCacheRate,
  calculateTokenRate,
  type MessageUsage,
} from '../lib/context-usage'
import { clsx } from 'clsx'
import { Minimize2, Loader2, Zap, Database, ArrowDownToLine, ArrowUpFromLine, Sparkles, Layers } from 'lucide-react'

const RING_RADIUS = 7.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatTokens(count?: number): string {
  if (count === undefined || count === null || count <= 0) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return count.toLocaleString()
}

export function ContextUsageInspector(): React.JSX.Element | null {
  const sessionStats = useAppStore((state) => state.sessionStats)
  const compactContext = useAppStore((state) => state.compactContext)
  const isCompacting = useAppStore((state) => state.sessionState?.isCompacting ?? false)
  const messages = useAppStore((state) => state.messages)

  const [open, setOpen] = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const contextUsage = sessionStats?.contextUsage
  if (!contextUsage) return null

  const contextWindow = contextUsage.contextWindow || 128_000
  const usedTokens = contextUsage.tokens ?? 0
  const ratio = Math.max(0, Math.min(1, usedTokens / contextWindow))
  const percent = Math.round(ratio * 100)

  // Find latest message with usage data
  const latestMessageWithUsage = messages
    .slice()
    .reverse()
    .find((m) => Boolean((m as unknown as Record<string, unknown>).usage)) as
    | (Record<string, unknown> & { usage?: MessageUsage })
    | undefined

  const latestUsage = latestMessageWithUsage?.usage

  const cacheRate = calculateCacheRate(latestUsage)

  // Position popover relative to trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popoverWidth = 280
    const popoverHeight = 260

    let left = rect.left + rect.width / 2 - popoverWidth / 2
    left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12))

    const top = rect.top - popoverHeight - 8
    setPopoverPos({ top: Math.max(12, top), left })
  }, [])

  useEffect(() => {
    if (open) {
      updatePosition()
      const onResize = () => updatePosition()
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false)
      }
      const onPointerDown = (e: PointerEvent) => {
        if (
          popoverRef.current &&
          !popoverRef.current.contains(e.target as Node) &&
          triggerRef.current &&
          !triggerRef.current.contains(e.target as Node)
        ) {
          setOpen(false)
        }
      }
      window.addEventListener('resize', onResize)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('pointerdown', onPointerDown)
      return () => {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('pointerdown', onPointerDown)
      }
    }
  }, [open, updatePosition])

  const strokeColor =
    percent >= 90 ? 'text-error' : percent >= 75 ? 'text-warning' : 'text-accent-fg'

  const strokeOffset = RING_CIRCUMFERENCE * (1 - ratio)

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-dim hover:bg-hover hover:text-secondary transition-colors"
        title={`Context: ${usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${percent}%)`}
        aria-expanded={open}
      >
        <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20">
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            className="stroke-border"
            strokeWidth="2.5"
          />
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            className={clsx('transition-all duration-300', strokeColor)}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={strokeOffset}
            strokeLinecap="round"
          />
        </svg>
        <span className="font-mono text-xs">{percent}%</span>
      </button>

      {open &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-72 rounded-xl border border-border bg-card p-3.5 shadow-2xl backdrop-blur-lg animate-in fade-in zoom-in-95 duration-100"
            style={{ top: popoverPos.top, left: popoverPos.left }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
              <div className="flex items-center gap-1.5 font-medium text-xs text-primary">
                <Layers size={13} className="text-accent-fg" />
                <span>Context Usage</span>
              </div>
              <span className={clsx('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold', strokeColor, 'bg-elevated')}>
                {percent}% used
              </span>
            </div>

            {/* Tokens Progress bar */}
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[11px] text-dim">
                <span>Occupancy</span>
                <span className="font-mono text-secondary font-medium">
                  {formatTokens(usedTokens)} / {formatTokens(contextWindow)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                <div
                  className={clsx('h-full rounded-full transition-all duration-300', strokeColor.replace('text-', 'bg-'))}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* Detailed metrics breakdown */}
            <div className="mt-3 space-y-1.5 rounded-lg border border-border/50 bg-surface/50 p-2 text-xs">
              {latestUsage ? (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1 text-dim">
                      <ArrowDownToLine size={11} /> Input (Prompt)
                    </span>
                    <span className="font-mono text-secondary">{formatTokens(latestUsage.inputTokens)}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1 text-dim">
                      <ArrowUpFromLine size={11} /> Output (Assistant)
                    </span>
                    <span className="font-mono text-secondary">{formatTokens(latestUsage.outputTokens)}</span>
                  </div>

                  {latestUsage.reasoningTokens ? (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1 text-dim">
                        <Sparkles size={11} /> Thinking
                      </span>
                      <span className="font-mono text-secondary">{formatTokens(latestUsage.reasoningTokens)}</span>
                    </div>
                  ) : null}

                  {latestUsage.cacheReadTokens ? (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1 text-dim">
                        <Database size={11} /> Cache Read
                      </span>
                      <span className="font-mono text-accent-fg font-medium">
                        {formatTokens(latestUsage.cacheReadTokens)} ({cacheRate}%)
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="py-1 text-center text-[11px] text-dim">
                  Turn details will populate on message completion
                </div>
              )}
            </div>

            {/* Actions: Compact Context */}
            <div className="mt-3 flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  compactContext()
                  setOpen(false)
                }}
                disabled={isCompacting}
                className="flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-secondary hover:bg-hover hover:text-primary transition-colors disabled:opacity-50"
              >
                {isCompacting ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    <span>Compacting…</span>
                  </>
                ) : (
                  <>
                    <Minimize2 size={11} />
                    <span>Compact Context</span>
                  </>
                )}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
