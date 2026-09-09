/**
 * SOCKS5 认证本地中继（04 已知边界 1 的兜底方案）
 *
 * 背景：Chromium `--proxy-server` 不支持 SOCKS5 用户名/密码认证（上游限制），
 * 直接把带账密的 socks5 配置交给内核时认证不会生效。
 *
 * 原理：主进程在 127.0.0.1 随机端口启动一个"无认证本地 HTTP 代理"，
 * Chromium 以 `http://127.0.0.1:{port}` 作为 proxy server；本地代理收到请求后
 * 用 tunnel.ts 的 SOCKS5 实现（RFC 1928 + RFC 1929 账密认证）建隧道并双向转发字节。
 * 目标域名经 SOCKS5 的 ATYP=3 交给代理侧解析，无本地 DNS 泄漏。
 *
 * 支持两类流量：
 * - CONNECT（https / ws / wss 等）：上游隧道建成后再回 200，失败回 502；
 * - 绝对形式 HTTP 请求（http 明文站点）：解析首包请求行确定目标，原样转发请求头
 *   （含已缓冲的请求体首段）后进入双向透传。
 *
 * 安全：仅绑定 127.0.0.1；随环境 context 关闭/启动失败/应用退出而停止。
 */
import { createServer, type Server, type Socket } from 'node:net'
import type { ProxyConfig } from '../../shared/types'
import { getLogger } from '../db'
import { classifyProxyError, proxyError } from './errors'
import { openProxyTunnel } from './tunnel'

const HEAD_MAX_BYTES = 32 * 1024
const HEAD_TIMEOUT_MS = 15_000
const TUNNEL_TIMEOUT_MS = 10_000

/** 该配置是否需要走本地中继（Chromium 原生无法处理的形态：socks5 + 账密） */
export function needsSocks5Relay(cfg: ProxyConfig): boolean {
  return cfg.type === 'socks5' && cfg.username !== undefined && cfg.password !== undefined
}

export interface Socks5Relay {
  readonly port: number
  /** 停止监听并断开存量连接（幂等，失败不抛出给调用方语义） */
  stop(): Promise<void>
}

/** 启动本地中继；监听失败（端口耗尽等）以 ProxyTestError 抛出 */
export async function startSocks5Relay(cfg: ProxyConfig): Promise<Socks5Relay> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    client.on('error', () => sockets.delete(client))
    void handleClient(cfg, client)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error): void => reject(classifyProxyError(e, 'proxyConnect'))
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError)
        resolve()
      })
    })
  } catch (e) {
    server.close()
    throw e
  }

  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    server.close()
    throw proxyError('PROXY_PROTOCOL', '本地中继监听地址异常')
  }

  return {
    port: addr.port,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        sockets.clear()
        server.close(() => resolve())
        // close 回调兜底（存在长连接时 close 可能延迟）
        setTimeout(resolve, 2_000).unref()
      })
  }
}

// ---------- 单个客户端连接的处理 ----------

async function handleClient(cfg: ProxyConfig, client: Socket): Promise<void> {
  client.setNoDelay(true)
  try {
    const { head, take } = await readHead(client)
    if (head.toString('latin1', 0, 8).startsWith('CONNECT ')) {
      await handleConnect(cfg, client, head, take)
    } else {
      await handlePlainHttp(cfg, client, head, take)
    }
  } catch (e) {
    const err = classifyProxyError(e, 'handshake')
    getLogger().warn('proxy.relay.client_failed', { code: err.code, message: err.message })
    if (client.writable && !client.destroyed) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      setTimeout(() => client.destroy(), 1_000).unref()
    } else {
      client.destroy()
    }
  }
}

/**
 * 读完首包 HTTP 头（含 CRLFCRLF）；头之后继续缓冲后续字节，调用方经 take()
 * 同步取走（take 同时移除监听）。take 与后续 pipe() 挂接之间不得插入 await，
 * 否则存在丢字节窗口。
 */
function readHead(client: Socket): Promise<{ head: Buffer; take: () => Buffer }> {
  return new Promise((resolve, reject) => {
    let buf: Buffer = Buffer.alloc(0)
    let found = false
    const timer = setTimeout(() => {
      detach()
      reject(proxyError('PROXY_TIMEOUT', '本地中继等待请求头超时'))
      client.destroy()
    }, HEAD_TIMEOUT_MS)
    const onData = (chunk: Buffer): void => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk])
      if (found) return
      const idx = buf.indexOf('\r\n\r\n')
      if (idx >= 0) {
        found = true
        clearTimeout(timer)
        resolve({
          head: buf.subarray(0, idx + 4),
          take: () => {
            detach()
            const rest = buf.subarray(idx + 4)
            buf = Buffer.alloc(0)
            return rest
          }
        })
      } else if (buf.length > HEAD_MAX_BYTES) {
        detach()
        reject(proxyError('PROXY_PROTOCOL', '本地中继收到的请求头超出大小限制'))
        client.destroy()
      }
    }
    const onError = (e: Error): void => {
      detach()
      reject(classifyProxyError(e, 'handshake'))
    }
    const onClose = (): void => {
      detach()
      reject(proxyError('PROXY_PROTOCOL', '本地中继在读取请求头前连接被关闭'))
    }
    function detach(): void {
      clearTimeout(timer)
      client.off('data', onData)
      client.off('error', onError)
      client.off('close', onClose)
    }
    client.on('data', onData)
    client.on('error', onError)
    client.on('close', onClose)
  })
}

/** CONNECT：先经 SOCKS5 建隧道，成功回 200 后透传 */
async function handleConnect(
  cfg: ProxyConfig,
  client: Socket,
  head: Buffer,
  take: () => Buffer
): Promise<void> {
  const reqLine = head.toString('latin1').split('\r\n', 1)[0] ?? ''
  const m = /^CONNECT\s+(\S+)\s+HTTP\/\d/i.exec(reqLine)
  if (!m) {
    throw proxyError('PROXY_PROTOCOL', `无法解析 CONNECT 请求：${JSON.stringify(reqLine)}`)
  }
  const { host, port } = parseAuthority(m[1], 443)
  const tunnel = await openProxyTunnel(cfg, host, port, {
    connectTimeoutMs: TUNNEL_TIMEOUT_MS
  })
  const rest = take()
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  if (rest.length > 0 && !tunnel.destroyed) tunnel.write(rest)
  pipe(client, tunnel)
}

/**
 * 绝对形式 HTTP 请求（http 明文站点；https 走 CONNECT 不会到这里）：
 * 解析请求行得到目标 host:port，经 SOCKS5 隧道原样转发请求头与已缓冲字节后透传。
 */
async function handlePlainHttp(
  cfg: ProxyConfig,
  client: Socket,
  head: Buffer,
  take: () => Buffer
): Promise<void> {
  const reqLine = head.toString('latin1').split('\r\n', 1)[0] ?? ''
  const m = /^([A-Za-z]+)\s+https?:\/\/([^/\s]+)(?:\/[^\s]*)?\s+HTTP\/\d/i.exec(reqLine)
  if (!m) {
    throw proxyError(
      'PROXY_PROTOCOL',
      `本地中继仅接受经代理的 HTTP 请求，收到：${JSON.stringify(reqLine)}`
    )
  }
  const { host, port } = parseAuthority(m[2], 80)
  const tunnel = await openProxyTunnel(cfg, host, port, {
    connectTimeoutMs: TUNNEL_TIMEOUT_MS
  })
  // 原样转发请求头 + 已缓冲字节，后续字节由 pipe 双向透传
  const first = take()
  tunnel.write(Buffer.concat([head, first]))
  pipe(client, tunnel)
}

/** authority 形式解析：host[:port]，支持 [IPv6]:port；port 缺省用 defaultPort */
function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } {
  const closeBracket = authority.lastIndexOf(']')
  const colon = authority.lastIndexOf(':')
  const host = colon > closeBracket ? authority.slice(0, colon) : authority
  const port = colon > closeBracket ? Number(authority.slice(colon + 1)) : defaultPort
  if (host.length === 0) {
    throw proxyError('PROXY_PROTOCOL', `本地中继请求目标主机为空：${JSON.stringify(authority)}`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw proxyError('PROXY_PROTOCOL', `本地中继请求目标端口非法：${JSON.stringify(authority)}`)
  }
  return { host, port }
}

/** 双向透传；任一端 error/close 即销毁两端 */
function pipe(a: Socket, b: Socket): void {
  const kill = (): void => {
    a.destroy()
    b.destroy()
  }
  a.on('data', (c) => {
    if (!b.destroyed) b.write(c)
  })
  b.on('data', (c) => {
    if (!a.destroyed) a.write(c)
  })
  a.once('error', kill)
  b.once('error', kill)
  a.once('close', kill)
  b.once('close', kill)
}
