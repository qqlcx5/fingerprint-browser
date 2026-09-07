/**
 * 代理错误分类（04-T3，需求文档 §6.4 / §9 矩阵）
 *
 * 四类错误码与用户可读文案一一对应，保证"认证 / 超时 / DNS / 协议"文案可区分：
 * - PROXY_AUTH     代理账号或密码错误
 * - PROXY_TIMEOUT  连接超时 / 无法连接代理（网络类，附"检查代理服务商"建议）
 * - PROXY_DNS      DNS 解析失败（代理域名解析失败，或代理侧解析目标域名失败）
 * - PROXY_PROTOCOL 代理协议错误（类型不匹配、响应异常、连接被重置等）
 *
 * 约定：模块内所有失败都以 ProxyTestError 抛出，IPC 层（toAppError）原样保留 code。
 */
import type { AppErrorCode } from '../../shared/types'

/** 出错阶段：用于细化文案（连代理 / 代理握手建隧道 / 经隧道请求目标） */
export type ProxyErrorPhase = 'proxyConnect' | 'handshake' | 'target'

export class ProxyTestError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'ProxyTestError'
    this.code = code
  }
}

/** 快捷构造 */
export function proxyError(code: AppErrorCode, message: string): ProxyTestError {
  return new ProxyTestError(code, message)
}

/** 各错误类别的文案优先级：数值越小越具体，多源全失败时优先上报更可诊断的错误 */
const CODE_PRIORITY: AppErrorCode[] = ['PROXY_AUTH', 'PROXY_PROTOCOL', 'PROXY_DNS', 'PROXY_TIMEOUT']

export function proxyErrorPriority(code: AppErrorCode): number {
  const idx = CODE_PRIORITY.indexOf(code)
  return idx === -1 ? CODE_PRIORITY.length : idx
}

const TLS_HINTS = ['certificate', 'ssl', 'tls', 'handshake', 'alert'] as const

/**
 * 把底层 socket/TLS/未知错误归类为 ProxyTestError。
 * 已是 ProxyTestError 的原样返回；其余按 errno / message 特征分桶。
 */
export function classifyProxyError(
  e: unknown,
  phase: ProxyErrorPhase = 'proxyConnect'
): ProxyTestError {
  if (e instanceof ProxyTestError) return e

  const errno = (e as NodeJS.ErrnoException | null)?.code
  const raw = e instanceof Error ? e.message : String(e)
  const lower = raw.toLowerCase()

  // 本地 DNS 解析失败（解析的是"代理主机名"）
  if (errno === 'ENOTFOUND' || errno === 'EAI_AGAIN') {
    return proxyError('PROXY_DNS', `代理域名解析失败（DNS）：${raw}，请检查代理主机名填写是否正确`)
  }
  // 连接类网络错误归入"超时/不可达"桶，文案按 errno 细分
  if (errno === 'ETIMEDOUT') {
    return proxyError('PROXY_TIMEOUT', '代理连接超时，请检查代理服务商与当前网络')
  }
  if (errno === 'ECONNREFUSED') {
    return proxyError(
      'PROXY_TIMEOUT',
      `无法连接代理服务器（连接被拒绝，${phaseHint(phase)}），请检查代理地址与端口`
    )
  }
  if (errno === 'EHOSTUNREACH' || errno === 'ENETUNREACH' || errno === 'ENETDOWN') {
    return proxyError(
      'PROXY_TIMEOUT',
      `无法连接代理服务器（网络不可达，${phaseHint(phase)}），请检查本机网络与代理地址`
    )
  }
  if (errno === 'ECONNRESET' || errno === 'EPIPE') {
    return proxyError(
      'PROXY_PROTOCOL',
      `连接被${phaseHint(phase)}重置，请确认代理类型选择是否正确（http/https/socks5）与服务商状态`
    )
  }
  if (TLS_HINTS.some((h) => lower.includes(h))) {
    return proxyError(
      'PROXY_PROTOCOL',
      `与代理建立 TLS 连接失败（${raw}），若代理非加密类型请改用 http 或 socks5`
    )
  }
  return proxyError('PROXY_PROTOCOL', `代理连接异常（${phaseHint(phase)}）：${raw}`)
}

function phaseHint(phase: ProxyErrorPhase): string {
  switch (phase) {
    case 'proxyConnect':
      return '连接代理阶段'
    case 'handshake':
      return '代理握手阶段'
    case 'target':
      return '经代理访问目标阶段'
  }
}
