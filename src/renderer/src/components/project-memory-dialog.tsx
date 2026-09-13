import { useState, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectMemoryEntry } from '../../../shared/ipc-contracts'
import { X, Plus, Trash2, Brain, Save, Loader2, Check } from 'lucide-react'

interface ProjectMemoryDialogProps {
  workspace: { id: string; name: string; path: string }
  onClose: () => void
}

export function ProjectMemoryDialog({ workspace, onClose }: ProjectMemoryDialogProps): React.JSX.Element {
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dialogId = useId()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.piDesktop.workspace
      .getMemory(workspace.path)
      .then((res) => {
        if (!cancelled) {
          setEntries(res.memory?.entries ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([])
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

  const handleAddEntry = () => {
    const newEntry: ProjectMemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: '',
      content: '',
    }
    setEntries((prev) => [...prev, newEntry])
  }

  const handleUpdateEntry = (id: string, field: 'title' | 'content', value: string) => {
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    )
    setSaved(false)
  }

  const handleDeleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((item) => item.id !== id))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const validEntries = entries
        .filter((e) => (e.title ?? '').trim() || (e.key ?? '').trim() || e.content.trim())
        .map((e) => ({
          ...e,
          key: (e.key || e.title || '').trim(),
          title: (e.title || e.key || '').trim(),
        }))
      await window.piDesktop.workspace.saveMemory(workspace.path, validEntries)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

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
      <div className="flex h-[80vh] max-h-[700px] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-elevated/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent-fg">
              <Brain size={18} />
            </div>
            <div>
              <h2 id={`${dialogId}-title`} className="text-sm font-semibold text-primary">
                Project Memory
              </h2>
              <p className="text-xs text-dim">
                Persistent agent knowledge and context for <span className="font-medium text-secondary">{workspace.name}</span>
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

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-xs text-dim">
              <Loader2 size={16} className="animate-spin mr-2" />
              Loading memory entries…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <Brain size={32} className="text-dim/60 mb-2" />
              <p className="text-sm font-medium text-secondary">No memory entries yet</p>
              <p className="text-xs text-dim max-w-sm mt-1">
                Store key business facts, architecture guidelines, or common patterns the agent should always remember.
              </p>
              <button
                type="button"
                onClick={handleAddEntry}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-accent-fg px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                <Plus size={14} />
                <span>Add First Memory</span>
              </button>
            </div>
          ) : (
            entries.map((entry, index) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-surface/60 p-3.5 space-y-2 hover:border-border-strong transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    placeholder={`Memory #${index + 1} (e.g. Auth Architecture)`}
                    value={entry.title}
                    onChange={(e) => handleUpdateEntry(entry.id, 'title', e.target.value)}
                    className="flex-1 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-primary placeholder:text-dim focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteEntry(entry.id)}
                    className="rounded p-1 text-dim hover:bg-hover hover:text-error transition-colors"
                    title="Delete entry"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <textarea
                  rows={3}
                  placeholder="Details, facts, or instructions for the agent to remember..."
                  value={entry.content}
                  onChange={(e) => handleUpdateEntry(entry.id, 'content', e.target.value)}
                  className="w-full resize-y rounded-md border border-border/70 bg-card p-2.5 text-xs text-secondary placeholder:text-dim focus:border-accent focus:outline-none font-mono"
                />
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 bg-elevated/20">
          <button
            type="button"
            onClick={handleAddEntry}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-secondary hover:bg-hover hover:text-primary transition-colors"
          >
            <Plus size={14} />
            <span>Add Entry</span>
          </button>

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
                  <span>Save Changes</span>
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
