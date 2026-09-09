import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProxyTransport } from './tunnel'

const execFileAsync = promisify(execFile)

/**
 * 读取 Windows 当前用户的手动系统代理。
 * Windows 系统代理是 HTTP CONNECT 代理；本地代理客户端通常同时开放 SOCKS5，
 * 但使用 HTTP 兼容 WinINET 的标准系统代理语义。
 */
export async function getSystemProxyTransport(): Promise<ProxyTransport | undefined> {
  if (process.platform !== 'win32') return undefined

  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const [{ stdout: enabledOutput }, { stdout }] = await Promise.all([
      execFileAsync('reg.exe', ['query', key, '/v', 'ProxyEnable']),
      execFileAsync('reg.exe', ['query', key, '/v', 'ProxyServer'])
    ])
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabledOutput)
    if (!enabled) return undefined

    const value = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim()
    if (!value) return undefined

    const server = selectProxyServer(value)
    const match = /^(?:https?:\/\/)?(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(server)
    if (!match) return undefined
    const port = Number(match[2])
    if (port < 1 || port > 65535) return undefined
    return { type: 'http', host: match[1], port }
  } catch {
    return undefined
  }
}

/** `http=host:port;https=host:port` 时优先 HTTPS，其余取第一个地址。 */
function selectProxyServer(value: string): string {
  const entries = value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const https = entries.find((item) => item.toLowerCase().startsWith('https='))
  if (https) return https.slice('https='.length)
  const http = entries.find((item) => item.toLowerCase().startsWith('http='))
  if (http) return http.slice('http='.length)
  return entries[0]?.replace(/^[a-z]+=/i, '') ?? ''
}
