/**
 * 代理隧道层（04-T2 的底层实现）
 *
 * 依赖已冻结（parallel-plan §2），不新增代理库：用 node:net / node:tls 手写两种隧道协议——
 * - http / https 代理：向代理发 CONNECT host:port（Basic 认证），建立到目标的透明隧道；
 *   https 型代理的 CONNECT 本身跑在 TLS 内。
 * - socks5 代理：RFC 1928 握手 + RFC 1929 用户名/密码子协商，目标地址用 ATYP 编码。
 *
 * 隧道建成后上层即可对目标发起任意 TCP 流：本模块内置一个最小 HTTP/1.1 客户端
 * （httpRequestOverSocket，支持 Content-Length / chunked），供 testEgress 请求 IP 查询接口。
 *
 * 所有失败统一以 ProxyTestError 抛出（分类见 errors.ts）。
 */
import { connect as netConnect, isIP, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { ProxyConfig } from '../../shared/types'
import { getLogger } from '../db'
import { classifyProxyError, proxyError } from './errors'

/** 超时配置：connect 覆盖 TCP/TLS 建连 + 代理握手；response 覆盖请求目标站到响应读完 */
export interface TunnelTimeouts {
  connectTimeoutMs?: number
  responseTimeoutMs?: number
}

const DEFAULT_TIMEOUTS: Required<TunnelTimeouts> = {
  connectTimeoutMs: 10_000,
  responseTimeoutMs: 10_000
}

const UA = 'fingerprint-browser proxy-test/1.0'

// ---------- SocketReader：带超时的承诺式缓冲读取 ----------

type Waiter =
  | {
      kind: 'exact'
      n: number
      resolve(b: Buffer): void
      reject(e: Error): void
      timer: NodeJS.Timeout
    }
  | {
      kind: 'until'
      delim: Buffer
      max: number
      resolve(b: Buffer): void
      reject(e: Error): void
      timer: NodeJS.Timeout
    }
  | { kind: 'all'; resolve(b: Buffer): void; reject(e: Error): void; timer: NodeJS.Timeout }

class SocketReader {
  private buf: Buffer = Buffer.alloc(0)
  private pending: Waiter[] = []
  private sawEnd = false
  private socketError: Error | null = null

  constructor(
    private socket: Socket,
    private readonly closedMessage = '连接在响应读取完成前被关闭'
  ) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
      this.drain()
    })
    socket.on('end', () => {
      this.sawEnd = true
      this.drain()
    })
    // 对端半关闭/直接销毁都按"连接结束"处理（Connection: close 的服务器可能不发包直接关）
    socket.on('close', () => {
      this.sawEnd = true
      this.drain()
    })
    socket.on('error', (e: Error) => {
      this.socketError = e
      this.failAll(e)
    })
  }

  /** 精确读 n 字节；ms 为本次读取的超时上限 */
  read(n: number, ms: number, onTimeout: () => Error): Promise<Buffer> {
    return this.enqueue({ kind: 'exact', n }, ms, onTimeout)
  }

  /** 读到分隔符（含分隔符本身），超 max 判协议错误 */
  readUntil(delim: string, max: number, ms: number, onTimeout: () => Error): Promise<Buffer> {
    return this.enqueue({ kind: 'until', delim: Buffer.from(delim, 'utf8'), max }, ms, onTimeout)
  }

  /** 读到连接关闭为止（Connection: close 场景） */
  readToEnd(ms: number, onTimeout: () => Error): Promise<Buffer> {
    return this.enqueue({ kind: 'all' }, ms, onTimeout)
  }

  private enqueue(
    spec:
      | { kind: 'exact'; n: number }
      | { kind: 'until'; delim: Buffer; max: number }
      | { kind: 'all' },
    ms: number,
    onTimeout: () => Error
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((w) => w.timer !== timer)
        reject(onTimeout())
        this.socket.destroy()
      }, ms)
      const waiter = { ...spec, resolve, reject, timer } as Waiter
      this.pending.push(waiter)
      this.drain()
    })
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const w = this.pending[0]
      if (this.socketError) {
        this.settle(w, null, this.socketError)
        continue
      }
      if (this.sawEnd) {
        if (w.kind === 'all') {
          const out = this.buf
          this.buf = Buffer.alloc(0)
          this.settle(w, out, null)
        } else {
          this.settle(w, null, proxyError('PROXY_PROTOCOL', this.closedMessage))
        }
        continue
      }
      let consumed: Buffer | null
      try {
        consumed = this.tryConsume(w)
      } catch (e) {
        // 超过 max 等协议错误：拒绝当前及后续所有等待者（在 data 回调里不能向上抛）
        this.failAll(e as Error)
        return
      }
      if (consumed === null) break // 数据不足，等待更多字节
      this.settle(w, consumed, null)
    }
  }

  /** 满足则切片返回；不满足返回 null；超出 max 直接失败 */
  private tryConsume(w: Waiter): Buffer | null {
    if (w.kind === 'all') return null
    if (w.kind === 'exact') {
      if (this.buf.length < w.n) return null
      const out = this.buf.subarray(0, w.n)
      this.buf = this.buf.subarray(w.n)
      return out
    }
    const idx = this.buf.indexOf(w.delim)
    if (idx >= 0) {
      const end = idx + w.delim.length
      const out = this.buf.subarray(0, end)
      this.buf = this.buf.subarray(end)
      return out
    }
    if (this.buf.length > w.max) {
      throw proxyError('PROXY_PROTOCOL', '代理/目标响应头超出预期大小，疑似非代理协议')
    }
    return null
  }

  private settle(w: Waiter, data: Buffer | null, err: Error | null): void {
    clearTimeout(w.timer)
    this.pending = this.pending.filter((x) => x !== w)
    if (err) w.reject(err)
    else w.resolve(data as Buffer)
  }

  private failAll(e: Error): void {
    while (this.pending.length > 0) {
      const w = this.pending[0]
      this.settle(w, null, e)
    }
  }
}

// ---------- 建连与握手 ----------

/** IPv6 字面量去掉方括号（net/tls connect 用裸地址） */
function bareHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** CONNECT authority 形式：IPv6 补方括号 */
function authorityOf(host: string, port: number): string {
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${h}:${port}`
}

/** 基础认证头（http/https 代理 CONNECT 用） */
function basicAuthHeader(cfg: ProxyConfig): string {
  if (cfg.username === undefined || cfg.password === undefined) return ''
  const token = Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64')
  return `Proxy-Authorization: Basic ${token}\r\n`
}

export interface ProxyTransport {
  type: ProxyConfig['type']
  host: string
  port: number
}

/** TCP/TLS 连到代理服务器；有系统上游时，先经上游建立到目标代理的隧道。 */
async function connectToProxy(
  cfg: ProxyConfig,
  timeoutMs: number,
  upstream?: ProxyTransport
): Promise<Socket> {
  const peer = upstream ?? cfg
  const socket = await connectDirect(peer, timeoutMs)
  if (!upstream) return socket

  try {
    if (upstream.type === 'http' || upstream.type === 'https') {
      await httpConnectHandshake(socket, upstream, cfg.host, cfg.port, timeoutMs)
    } else {
      await socks5Handshake(socket, upstream, cfg.host, cfg.port, timeoutMs)
    }
    return socket
  } catch (error) {
    socket.destroy()
    throw classifyProxyError(error, 'proxyConnect')
  }
}

/** 直接 TCP/TLS 连到指定代理节点。 */
function connectDirect(cfg: ProxyTransport, timeoutMs: number): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const host = bareHost(cfg.host)
    const socket =
      cfg.type === 'https'
        ? tlsConnect({ host, port: cfg.port, servername: host })
        : netConnect({ host, port: cfg.port })
    socket.setNoDelay(true)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(proxyError('PROXY_TIMEOUT', `连接代理服务器超时（${cfg.host}:${cfg.port}）`))
    }, timeoutMs)
    const onConnect = (): void => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resolve(socket)
    }
    const onError = (e: Error): void => {
      clearTimeout(timer)
      reject(classifyProxyError(e, 'proxyConnect'))
    }
    socket.once(cfg.type === 'https' ? 'secureConnect' : 'connect', onConnect)
    socket.once('error', onError)
  })
}

/** http/https 代理：发 CONNECT 建立到目标的隧道（407/401 → 认证失败，5xx → 代理侧 DNS/上游失败） */
async function httpConnectHandshake(
  socket: Socket,
  cfg: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<void> {
  const reader = new SocketReader(
    socket,
    `HTTP 代理在 CONNECT 握手阶段关闭连接（${cfg.host}:${cfg.port}），未返回 HTTP 状态；请确认代理类型不是 SOCKS5、端口有效且账号/IP 已授权`
  )
  const authority = authorityOf(targetHost, targetPort)
  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\n` +
      `Host: ${authority}\r\n` +
      basicAuthHeader(cfg) +
      `User-Agent: ${UA}\r\n` +
      `Proxy-Connection: keep-alive\r\n` +
      `\r\n`
  )
  const head = await reader.readUntil('\r\n\r\n', 16 * 1024, timeoutMs, () =>
    proxyError('PROXY_TIMEOUT', '代理对 CONNECT 请求响应超时，请检查代理服务商')
  )
  const statusLine = head.subarray(0, head.indexOf('\r\n')).toString('latin1')
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)
  if (!m) {
    throw proxyError(
      'PROXY_PROTOCOL',
      `代理响应不是 HTTP 协议（${JSON.stringify(statusLine)}），请确认代理类型选择正确`
    )
  }
  const status = Number(m[1])
  if (status === 200) return
  if (status === 407 || status === 401) {
    throw proxyError('PROXY_AUTH', '代理账号或密码错误（或缺少认证信息），请检查代理认证配置')
  }
  if (status >= 500) {
    throw proxyError(
      'PROXY_DNS',
      `代理无法连接目标服务器（HTTP ${status}，DNS 解析失败或目标不可达），请检查代理服务商`
    )
  }
  throw proxyError(
    'PROXY_PROTOCOL',
    `代理拒绝 CONNECT 请求（HTTP ${status}），可能目标或出口 IP 未被代理授权`
  )
}

/** SOCKS5 地址编码：IPv4 → ATYP1；其余（域名/IPv6 字面量）→ ATYP3 域名形式 */
function socksAddress(host: string, port: number): Buffer {
  const addr = Buffer.alloc(2)
  addr.writeUInt16BE(port, 0)
  if (isIP(host) === 4) {
    const b = Buffer.from(host.split('.').map((x) => Number(x)))
    return Buffer.concat([Buffer.from([0x01]), b, addr])
  }
  const domain = Buffer.from(bareHost(host), 'utf8')
  if (domain.length > 255) throw proxyError('VALIDATION', '目标主机名过长')
  return Buffer.concat([Buffer.from([0x03, domain.length]), domain, addr])
}

/** socks5 代理：RFC 1928 握手 +（可选）RFC 1929 认证 + CONNECT 请求 */
async function socks5Handshake(
  socket: Socket,
  cfg: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<void> {
  const reader = new SocketReader(
    socket,
    `SOCKS5 代理在握手阶段关闭连接（${cfg.host}:${cfg.port}），未返回 SOCKS5 响应；请确认代理类型不是 HTTP、端口有效且账号/IP 已授权`
  )
  const hasAuth = cfg.username !== undefined && cfg.password !== undefined
  const timeoutErr = (): Error =>
    proxyError('PROXY_TIMEOUT', 'SOCKS5 代理握手响应超时，请检查代理服务商')

  // 1. 方法协商
  const methods = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
  socket.write(methods)
  const greeting = await reader.read(2, timeoutMs, timeoutErr)
  if (greeting[0] !== 0x05) {
    throw proxyError(
      'PROXY_PROTOCOL',
      '目标不是 SOCKS5 代理（握手版本错误），请确认代理类型选择为 socks5'
    )
  }
  const method = greeting[1]
  if (method === 0xff) {
    // 服务器不接受我们提供的方法：最常见原因是代理要求认证而用户未填账号密码 → 归入认证错误
    throw proxyError(
      'PROXY_AUTH',
      '代理要求用户名/密码认证（或认证方式不受支持），请检查代理认证配置'
    )
  }
  if (method === 0x02) {
    const { username, password } = cfg
    if (username === undefined || password === undefined) {
      throw proxyError('PROXY_AUTH', '该代理要求用户名/密码认证，请在代理配置中填写认证信息')
    }
    // 2. 用户名/密码子协商（RFC 1929）
    const user = Buffer.from(username, 'utf8')
    const pass = Buffer.from(password, 'utf8')
    if (user.length > 255 || pass.length > 255) {
      throw proxyError('VALIDATION', '代理用户名或密码过长（UTF-8 编码后不得超过 255 字节）')
    }
    socket.write(
      Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass])
    )
    const authReply = await reader.read(2, timeoutMs, timeoutErr)
    if (authReply[0] !== 0x01 || authReply[1] !== 0x00) {
      throw proxyError('PROXY_AUTH', '代理账号或密码错误')
    }
  } else if (method !== 0x00) {
    throw proxyError('PROXY_PROTOCOL', `代理选择了不支持的认证方式（0x${method.toString(16)}）`)
  }

  // 3. CONNECT 请求
  socket.write(
    Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), socksAddress(targetHost, targetPort)])
  )
  const replyHead = await reader.read(4, timeoutMs, timeoutErr)
  if (replyHead[0] !== 0x05) {
    throw proxyError('PROXY_PROTOCOL', 'SOCKS5 代理响应版本异常')
  }
  const rep = replyHead[1]
  if (rep !== 0x00) {
    if (rep === 0x01)
      throw proxyError('PROXY_PROTOCOL', 'SOCKS5 代理内部错误（general failure），请检查代理服务商')
    if (rep === 0x02)
      throw proxyError(
        'PROXY_PROTOCOL',
        'SOCKS5 代理规则不允许该连接（not allowed），请检查代理服务商'
      )
    if (rep === 0x07 || rep === 0x08) {
      throw proxyError('PROXY_PROTOCOL', 'SOCKS5 代理不支持该命令或地址类型')
    }
    // 0x03 网络不可达 / 0x04 主机不可达 / 0x05 拒绝 / 0x06 TTL —— 代理侧连不上目标，多为 DNS 或上游网络问题
    throw proxyError(
      'PROXY_DNS',
      '代理无法连接目标服务器（DNS 解析失败或目标不可达），请检查代理服务商'
    )
  }
  // 消费绑定地址，保持协议状态干净（隧道不复用，读掉即可）
  const atyp = replyHead[3]
  if (atyp === 0x01) await reader.read(6, timeoutMs, timeoutErr)
  else if (atyp === 0x04) await reader.read(18, timeoutMs, timeoutErr)
  else if (atyp === 0x03) {
    const lenByte = await reader.read(1, timeoutMs, timeoutErr)
    await reader.read(lenByte[0] + 2, timeoutMs, timeoutErr)
  }
}

/**
 * 建立经代理到 targetHost:targetPort 的隧道，返回可用裸 socket。
 * 失败抛 ProxyTestError；无论成败，调用方负责 socket.destroy()。
 */
export async function openProxyTunnel(
  cfg: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeouts?: TunnelTimeouts,
  upstream?: ProxyTransport
): Promise<Socket> {
  const { connectTimeoutMs } = { ...DEFAULT_TIMEOUTS, ...timeouts }
  const socket = await connectToProxy(cfg, connectTimeoutMs, upstream)
  try {
    if (cfg.type === 'http' || cfg.type === 'https') {
      await httpConnectHandshake(socket, cfg, targetHost, targetPort, connectTimeoutMs)
    } else {
      await socks5Handshake(socket, cfg, targetHost, targetPort, connectTimeoutMs)
    }
    return socket
  } catch (e) {
    socket.destroy()
    throw classifyProxyError(e, 'handshake')
  }
}

// ---------- 隧道上的最小 HTTP/1.1 客户端 ----------

interface RawHttpResponse {
  status: number
  body: string
}

/** 解析响应头块（latin1 首行 + 小写 header 表） */
function parseHead(head: Buffer): { status: number; headers: Record<string, string> } {
  const text = head.toString('latin1')
  const lines = text.split('\r\n')
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(lines[0] ?? '')
  if (!m) throw proxyError('PROXY_PROTOCOL', '目标响应不是 HTTP 协议')
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { status: Number(m[1]), headers }
}

/** 经隧道请求目标 URL（http 直连隧道；https 在隧道内再套一层 TLS），响应超时覆盖到响应体读完 */
export async function httpRequestOverSocket(
  tunnel: Socket,
  url: URL,
  responseTimeoutMs: number
): Promise<RawHttpResponse> {
  let sock: Socket = tunnel
  try {
    if (url.protocol === 'https:') {
      sock = await new Promise<Socket>((resolve, reject) => {
        const tls = tlsConnect({ socket: tunnel, servername: bareHost(url.hostname) })
        tls.once('secureConnect', () => resolve(tls))
        tls.once('error', (e) =>
          reject(proxyError('PROXY_PROTOCOL', `经代理与目标站点的 TLS 握手失败：${e.message}`))
        )
      })
    }
    const reader = new SocketReader(
      sock,
      `经 ${url.protocol === 'https:' ? 'HTTPS' : 'HTTP'} 代理访问 ${url.host} 时目标连接被提前关闭`
    )
    const path = `${url.pathname}${url.search}` || '/'
    const timeoutErr = (): Error =>
      proxyError('PROXY_TIMEOUT', '目标站点响应超时（经代理），请检查代理服务商')

    sock.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        `Connection: close\r\n` +
        `Accept: application/json\r\n` +
        `Accept-Encoding: identity\r\n` +
        `User-Agent: ${UA}\r\n` +
        `\r\n`
    )

    const head = await reader.readUntil('\r\n\r\n', 64 * 1024, responseTimeoutMs, timeoutErr)
    const { status, headers } = parseHead(head)

    let body: Buffer
    const contentLength = headers['content-length'] ? Number(headers['content-length']) : null
    if (headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
      const chunks: Buffer[] = []
      for (;;) {
        const sizeLine = await reader.readUntil('\r\n', 1024, responseTimeoutMs, timeoutErr)
        const size = parseInt(sizeLine.toString('latin1').trim(), 16)
        if (!Number.isFinite(size) || size < 0) {
          throw proxyError('PROXY_PROTOCOL', '目标响应 chunked 编码异常')
        }
        if (size === 0) {
          await reader.readUntil('\r\n', 1024, responseTimeoutMs, timeoutErr) // 结束行的 CRLF
          break
        }
        const chunk = await reader.read(size, responseTimeoutMs, timeoutErr)
        await reader.readUntil('\r\n', 16, responseTimeoutMs, timeoutErr)
        chunks.push(chunk)
      }
      body = Buffer.concat(chunks)
    } else if (contentLength !== null && Number.isFinite(contentLength) && contentLength >= 0) {
      body = await reader.read(contentLength, responseTimeoutMs, timeoutErr)
    } else {
      body = await reader.readToEnd(responseTimeoutMs, timeoutErr)
    }
    return { status, body: body.toString('utf8') }
  } catch (e) {
    throw classifyProxyError(e, 'target')
  } finally {
    tunnel.destroy()
  }
}

/** 便捷组合：建隧道 → 请求目标 URL → 响应 */
export async function fetchThroughProxy(
  cfg: ProxyConfig,
  url: string | URL,
  timeouts?: TunnelTimeouts,
  upstream?: ProxyTransport
): Promise<RawHttpResponse> {
  const parsed = typeof url === 'string' ? new URL(url) : url
  const targetPort =
    parsed.port !== '' ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  const { responseTimeoutMs } = { ...DEFAULT_TIMEOUTS, ...timeouts }
  const tunnel = await openProxyTunnel(cfg, parsed.hostname, targetPort, timeouts, upstream)
  getLogger().info('proxy.test.target_request_sent', {
    target: parsed.toString(),
    proxyType: cfg.type,
    proxyHost: cfg.host,
    proxyPort: cfg.port
  })
  return httpRequestOverSocket(tunnel, parsed, responseTimeoutMs)
}
