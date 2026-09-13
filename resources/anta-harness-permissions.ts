import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideToolCall, loadEffectiveRules } from './permission-rules'

const mode = process.env.ANTA_HARNESS_PERMISSION_MODE || process.env.PI_DESKTOP_PERMISSION_MODE
const globalRulesPath =
  process.env.ANTA_HARNESS_PERMISSION_RULES_PATH ?? process.env.PI_DESKTOP_PERMISSION_RULES_PATH ?? null
// Set by the GUI when spawning Pi for a workspace the user has trusted. Only
// then do this repo's own `allow` rules take effect; otherwise its allow rules
// are ignored and only its deny rules apply (see loadEffectiveRules).
const workspaceTrusted =
  (process.env.ANTA_HARNESS_WORKSPACE_TRUSTED || process.env.PI_DESKTOP_WORKSPACE_TRUSTED) === '1'
// Which CLI this extension is running inside, as the GUI names it. The
// extension cannot detect its own host, so an unset value means an older GUI
// and falls back to Pi rather than guessing.
const agentLabel = process.env.ANTA_HARNESS_AGENT_LABEL || process.env.PI_DESKTOP_AGENT_LABEL || 'Pi'
const MAX_INPUT_SUMMARY_LENGTH = 2000

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const data = input as Record<string, unknown>
  const path = typeof data.path === 'string' ? data.path : undefined
  const command = typeof data.command === 'string' ? data.command : undefined

  if (path) return `Target: ${path}`
  if (command) return `Command:\n${command}`

  return JSON.stringify(data, null, 2).slice(0, MAX_INPUT_SUMMARY_LENGTH)
}

export default function antaHarnessPermissions(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    // Rules are re-read per call (mtime-cached), so edits apply without a
    // Pi restart. cwd is the workspace Pi was spawned in.
    const effective = loadEffectiveRules(process.cwd(), globalRulesPath, { workspaceTrusted })
    const decision = decideToolCall(mode, effective.rules, event.toolName, event.input, process.platform)

    if (decision.action === 'block') {
      return { block: true, reason: decision.reason }
    }
    if (decision.action === 'allow') return

    const summary = summarizeInput(event.input)
    const confirmed = await ctx.ui.confirm(
      `Allow ${event.toolName}?`,
      [
        `${agentLabel} wants to run the ${event.toolName} tool.`,
        summary,
      ].filter(Boolean).join('\n\n')
    )

    if (!confirmed) {
      return {
        block: true,
        reason: `User denied ${event.toolName} permission in Anta Harness.`,
      }
    }
  })

  // Durable project memory bridge
  try {
    pi.on('before_agent_start', async (event: any) => {
      try {
        const cwd = process.cwd()
        const memoryFile = join(cwd, '.pi', 'memory.json')
        if (!existsSync(memoryFile)) return

        const raw = readFileSync(memoryFile, 'utf-8')
        const parsed = JSON.parse(raw)
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
        if (entries.length === 0) return

        const notes = entries
          .filter(
            (e: unknown): e is { id: string; key?: string; content: string } =>
              Boolean(e && typeof e === 'object' && typeof (e as { content?: unknown }).content === 'string')
          )
          .map((e) => `- ${e.key ? `**${e.key}**: ` : ''}${e.content.trim()}`)
          .filter(Boolean)
          .join('\n')

        if (!notes) return

        const memoryBlock = [
          '# Project Memory',
          'The following notes are durable context for this project. Use them when relevant, but treat them as user-provided context rather than higher-priority instructions.',
          notes,
        ].join('\n\n')

        if (event && typeof event.systemPrompt === 'string' && !event.systemPrompt.includes('# Project Memory')) {
          return { systemPrompt: `${event.systemPrompt}\n\n${memoryBlock}` }
        }
      } catch {
        // Suppress errors to ensure agent execution is never interrupted
      }
    })
  } catch {
    // Unsupported lifecycle hook fallback
  }
}
