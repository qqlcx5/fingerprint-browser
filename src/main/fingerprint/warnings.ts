type WarningSink = (event: string, detail: Record<string, unknown>) => void

let sink: WarningSink = (event, detail) => console.warn(`[fingerprint:${event}]`, detail)

export function setFingerprintWarningSink(next: WarningSink): void {
  sink = next
}

export function warnFingerprint(event: string, detail: Record<string, unknown>): void {
  sink(event, detail)
}
