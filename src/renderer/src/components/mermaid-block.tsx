import { useEffect, useState, useId } from 'react'
import { renderMermaidSvg, isClosedFencedCodeBlock } from '../lib/mermaid'
import { CopyButton } from './copy-button'
import { Code2, Eye, Workflow, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'

const svgCache = new Map<string, string>()

interface MermaidBlockProps {
  source: string
  isStreaming?: boolean
}

export function MermaidBlock({ source, isStreaming }: MermaidBlockProps): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram')
  const [loading, setLoading] = useState(true)
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const chartId = `mermaid-${rawId}`

  const isDark =
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    let cancelled = false
    const trimmed = source.trim()

    if (!trimmed) {
      setSvg(null)
      setError(null)
      setLoading(false)
      return
    }

    // While the model is streaming tokens, suppress parsing and error flashes
    if (isStreaming) {
      setLoading(true)
      setError(null)
      return
    }

    const cacheKey = `${isDark ? 'dark' : 'light'}:${trimmed}`
    const cached = svgCache.get(cacheKey)
    if (cached) {
      setSvg(cached)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    renderMermaidSvg({
      id: chartId,
      source: trimmed,
      theme: isDark ? 'dark' : 'light',
    })
      .then((rendered) => {
        if (!cancelled) {
          svgCache.set(cacheKey, rendered)
          setSvg(rendered)
          setError(null)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [source, chartId, isDark, isStreaming])

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border bg-surface">
      {/* Header toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-elevated/40 px-3 py-1.5 text-xs text-dim">
        <div className="flex items-center gap-1.5 font-medium text-secondary">
          <Workflow size={13} className="text-accent-fg" />
          <span>Mermaid Diagram</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'diagram' ? 'code' : 'diagram')}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-dim hover:bg-hover hover:text-primary transition-colors"
            title={viewMode === 'diagram' ? 'View source code' : 'View diagram'}
          >
            {viewMode === 'diagram' ? (
              <>
                <Code2 size={12} />
                <span>Code</span>
              </>
            ) : (
              <>
                <Eye size={12} />
                <span>Diagram</span>
              </>
            )}
          </button>
          <CopyButton text={source} />
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {viewMode === 'code' ? (
          <pre className="overflow-x-auto text-xs font-mono text-primary whitespace-pre">
            <code>{source}</code>
          </pre>
        ) : error ? (
          <div className="flex flex-col gap-2 rounded bg-error/10 p-3 text-xs text-error">
            <div className="flex items-center gap-1.5 font-medium">
              <AlertCircle size={14} />
              <span>Diagram render failed</span>
            </div>
            <div className="text-[11px] opacity-90">{error}</div>
            <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs font-mono text-primary">
              <code>{source}</code>
            </pre>
          </div>
        ) : loading && !svg ? (
          <div className="flex h-20 items-center justify-center text-xs text-dim animate-pulse">
            {isStreaming ? 'Receiving diagram…' : 'Rendering diagram…'}
          </div>
        ) : svg ? (
          <div
            className="mermaid-svg-container flex justify-center overflow-x-auto py-2"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
    </div>
  )
}
