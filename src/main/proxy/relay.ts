/**
 * SOCKS5 authenticated upstream local relay.
 *
 * Chromium does not support username/password authentication for an upstream SOCKS5 proxy.
 * This listener accepts unauthenticated SOCKS5 connections only on 127.0.0.1, then opens an
 * authenticated RFC 1929 SOCKS5 tunnel to the configured upstream proxy.
 */
import { createServer, type Server, type Socket } from 'node:net'
import type { ProxyConfig } from '../../shared/types'
import { getLogger } from '../db'
import { classifyProxyError, proxyError, type ProxyTestError } from './errors'
import { openProxyTunnel } from './tunnel'

const HANDSHAKE_TIMEOUT_MS = 15_000
const TUNNEL_TIMEOUT_MS = 10_000

/** Chromium only needs this compatibility relay for upstream SOCKS5 username/password auth. */
export function needsSocks5Relay(cfg: ProxyConfig): boolean {
  return cfg.type === 'socks5' && cfg.username !== undefined && cfg.password !== undefined
}

export interface Socks5Relay {
  readonly port: number
  /** Stops the listener and all active client connections. Safe to call more than once. */
  stop(): Promise<void>
}

/** Starts a loopback-only, unauthenticated SOCKS5 relay for one browser environment. */
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
      const onError = (error: Error): void => reject(classifyProxyError(error, 'proxyConnect'))
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError)
        resolve()
      })
    })
  } catch (error) {
    server.close()
    throw error
  }

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继监听地址异常')
  }

  let stopped = false
  return {
    port: address.port,
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }
}

class BufferedSocketReader {
  private buffer = Buffer.alloc(0)
  private pending:
    { bytes: number; resolve: (value: Buffer) => void; reject: (reason: Error) => void } | undefined
  private ended = false
  private error: Error | undefined

  constructor(private readonly socket: Socket) {
    socket.pause()
    socket.on('data', this.onData)
    socket.once('end', this.onEnd)
    socket.once('close', this.onEnd)
    socket.once('error', this.onError)
    socket.resume()
  }

  read(bytes: number): Promise<Buffer> {
    if (this.pending) throw new Error('SOCKS5_RELAY_READ_CONCURRENT')
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = { bytes, resolve, reject }
      this.flush()
    })
  }

  /** Detaches the handshake reader and returns any bytes sent immediately after CONNECT. */
  release(): Buffer {
    if (this.pending) throw new Error('SOCKS5_RELAY_READ_PENDING')
    this.socket.pause()
    this.detach()
    const buffered = this.buffer
    this.buffer = Buffer.alloc(0)
    return buffered
  }

  dispose(): void {
    this.detach()
  }

  private onData = (chunk: Buffer): void => {
    const copy = Buffer.from(chunk)
    this.buffer = this.buffer.length === 0 ? copy : Buffer.concat([this.buffer, copy])
    this.flush()
  }

  private onEnd = (): void => {
    this.ended = true
    this.flush()
  }

  private onError = (error: Error): void => {
    this.error = error
    this.flush()
  }

  private flush(): void {
    if (!this.pending) return
    if (this.error) {
      const { reject } = this.pending
      this.pending = undefined
      reject(this.error)
      return
    }
    if (this.buffer.length >= this.pending.bytes) {
      const { bytes, resolve } = this.pending
      const result = this.buffer.subarray(0, bytes)
      this.buffer = this.buffer.subarray(bytes)
      this.pending = undefined
      resolve(result)
      return
    }
    if (this.ended) {
      const { reject } = this.pending
      this.pending = undefined
      reject(proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继握手尚未完成，客户端已断开'))
    }
  }

  private detach(): void {
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('close', this.onEnd)
    this.socket.off('error', this.onError)
  }
}

async function handleClient(cfg: ProxyConfig, client: Socket): Promise<void> {
  client.setNoDelay(true)
  const reader = new BufferedSocketReader(client)
  const handshakeTimer = setTimeout(() => {
    client.destroy(proxyError('PROXY_TIMEOUT', '本地 SOCKS5 中继握手超时'))
  }, HANDSHAKE_TIMEOUT_MS)
  let negotiated = false
  try {
    await negotiateNoAuth(client, reader)
    negotiated = true
    const target = await readConnectRequest(reader)
    const tunnel = await openProxyTunnel(cfg, target.host, target.port, {
      connectTimeoutMs: TUNNEL_TIMEOUT_MS
    })
    client.write(socksReply(0x00))
    const buffered = reader.release()
    clearTimeout(handshakeTimer)
    if (buffered.length > 0 && !tunnel.destroyed) tunnel.write(buffered)
    pipe(client, tunnel)
  } catch (error) {
    clearTimeout(handshakeTimer)
    reader.dispose()
    const classified = classifyProxyError(error, 'handshake')
    getLogger().warn('proxy.relay.client_failed', {
      code: classified.code,
      message: classified.message
    })
    if (client.writable && !client.destroyed) {
      client.end(negotiated ? socksReply(replyCodeFor(classified)) : Buffer.from([0x05, 0xff]))
    } else {
      client.destroy()
    }
  }
}

/** SOCKS5 greeting. The loopback relay deliberately supports no local authentication. */
async function negotiateNoAuth(client: Socket, reader: BufferedSocketReader): Promise<void> {
  const greeting = await reader.read(2)
  if (greeting[0] !== 0x05) {
    throw proxyError('PROXY_PROTOCOL', '本地中继仅接受 SOCKS5 客户端')
  }
  const methods = await reader.read(greeting[1])
  if (!methods.includes(0x00)) {
    client.write(Buffer.from([0x05, 0xff]))
    throw proxyError('PROXY_PROTOCOL', 'Chromium 未提供无认证 SOCKS5 协商方式')
  }
  client.write(Buffer.from([0x05, 0x00]))
}

async function readConnectRequest(
  reader: BufferedSocketReader
): Promise<{ host: string; port: number }> {
  const request = await reader.read(4)
  if (request[0] !== 0x05 || request[2] !== 0x00) {
    throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继请求格式错误')
  }
  if (request[1] !== 0x01) {
    throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继仅支持 CONNECT 请求')
  }

  let host: string
  switch (request[3]) {
    case 0x01: {
      const address = await reader.read(4)
      host = [...address].join('.')
      break
    }
    case 0x03: {
      const length = (await reader.read(1))[0]
      if (!length) throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继目标域名为空')
      host = (await reader.read(length)).toString('utf8')
      break
    }
    case 0x04: {
      const address = await reader.read(16)
      const groups = address.toString('hex').match(/.{1,4}/g)
      host = groups?.join(':') ?? ''
      break
    }
    default:
      throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继收到不支持的目标地址类型')
  }

  const port = (await reader.read(2)).readUInt16BE(0)
  if (!host || port === 0) throw proxyError('PROXY_PROTOCOL', '本地 SOCKS5 中继目标地址无效')
  return { host, port }
}

/** SOCKS5 CONNECT response with an unused IPv4 bind address. */
function socksReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
}

function replyCodeFor(error: ProxyTestError): number {
  switch (error.code) {
    case 'PROXY_DNS':
      return 0x04 // host unreachable
    case 'PROXY_TIMEOUT':
      return 0x03 // network unreachable
    case 'PROXY_AUTH':
    case 'PROXY_PROTOCOL':
    default:
      return 0x01 // general SOCKS server failure
  }
}

/** Starts bidirectional forwarding after the SOCKS5 handshake completes. */
function pipe(client: Socket, tunnel: Socket): void {
  client.pipe(tunnel)
  tunnel.pipe(client)
  client.once('error', () => tunnel.destroy())
  tunnel.once('error', () => client.destroy())
  client.once('close', () => tunnel.destroy())
  tunnel.once('close', () => client.destroy())
}
