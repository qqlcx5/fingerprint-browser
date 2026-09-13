import { useState, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { X, FileText, Save, Loader2, Check } from 'lucide-react'

interface ProjectInstructionsDialogProps {
  workspace: { id: string; name: string; path: string }
  onClose: () => void
}

export function ProjectInstructionsDialog({ workspace, onClose }: ProjectInstructionsDialogProps): React.JSX.Element {
  const [content, setContent] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dialogId = useId()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.piDesktop.workspace
      .getInstructions(workspace.path)
      .then((res) => {
        if (!cancelled) {
          setContent(res.instructions ?? '')
          setSourcePath(res.sourcePath ?? '')
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent('')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspace.path])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await window.piDesktop.workspace.saveInstructions(workspace.path, content, sourcePath || undefined)
      setSourcePath(res.sourcePath)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const relativePath = sourcePath.startsWith(workspace.path)
    ? sourcePath.slice(workspace.path.length).replace(/^[/\\]/, '')
    : sourcePath

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[80vh] max-h-[720px] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-elevated/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent-fg">
              <FileText size={18} />
            </div>
            <div>
              <h2 id={`${dialogId}-title`} className="text-sm font-semibold text-primary">
                Project Instructions
              </h2>
              <p className="text-xs text-dim">
                Custom system prompt instructions for <span className="font-medium text-secondary">{workspace.name}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-dim hover:bg-hover hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Source file banner */}
        <div className="flex items-center justify-between border-b border-border/60 bg-surface/80 px-5 py-2 text-[11px] text-dim">
          <span>
            File target: <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-secondary">{relativePath || '.pi/instructions.md'}</code>
          </span>
          <span>Injected into agent context on session start</span>
        </div>

        {/* Editor body */}
        <div className="flex-1 p-5 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-dim">
              <Loader2 size={16} className="animate-spin mr-2" />
              Loading instructions…
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setSaved(false)
              }}
              placeholder={`# Project Instructions for ${workspace.name}\n\n- Coding style: Strict TypeScript, TailwindCSS\n- Testing framework: Vitest\n- Architecture notes: ...`}
              className="flex-1 w-full resize-none rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-primary placeholder:text-dim/60 focus:border-accent focus:outline-none"
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 bg-elevated/20">
          <div className="text-[11px] text-dim">
            Supports Markdown formatting
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-dim hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-accent-fg px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Saving…</span>
                </>
              ) : saved ? (
                <>
                  <Check size={13} />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save size={13} />
                  <span>Save Instructions</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
