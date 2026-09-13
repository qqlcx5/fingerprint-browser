export interface MessageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export const DEFAULT_CONTEXT_WINDOW = 128_000

function positiveTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

export function usageTokenTotal(usage?: MessageUsage): number {
  if (!usage) return 0
  const reportedTotal = positiveTokenCount(usage.totalTokens)
  if (reportedTotal > 0) return reportedTotal
  return positiveTokenCount(usage.inputTokens) + positiveTokenCount(usage.outputTokens)
}

export function contextOccupancyTokens(usage?: MessageUsage): number {
  if (!usage) return 0
  const occupancy =
    positiveTokenCount(usage.inputTokens) +
    positiveTokenCount(usage.outputTokens) +
    positiveTokenCount(usage.reasoningTokens) +
    positiveTokenCount(usage.cacheReadTokens) +
    positiveTokenCount(usage.cacheWriteTokens)
  return occupancy > 0 ? occupancy : usageTokenTotal(usage)
}

export function calculateCacheRate(usage?: MessageUsage): number {
  if (!usage) return 0
  const cacheRead = positiveTokenCount(usage.cacheReadTokens)
  const input = positiveTokenCount(usage.inputTokens)
  const cacheWrite = positiveTokenCount(usage.cacheWriteTokens)
  const totalInputCandidate = input + cacheRead + cacheWrite
  if (totalInputCandidate <= 0) return 0
  return Math.min(100, Math.round((cacheRead / totalInputCandidate) * 100))
}

export function calculateTokenRate(outputTokens: number, durationMs: number): number {
  if (durationMs <= 0 || outputTokens <= 0) return 0
  const rate = outputTokens / (durationMs / 1000)
  return Math.round(rate * 10) / 10
}
