/**
 * ProxyConfig 校验（04-T1，需求文档 §5 proxy_config / §6.4）
 *
 * 规则：
 * - type ∈ http | https | socks5
 * - host 非空、无空白与非法字符（支持 IPv4 / 域名 / [IPv6]）
 * - port 为 1–65535 整数（接受数字或纯数字字符串，统一收敛为 number）
 * - username / password 必须成对出现；空字符串视为未填写
 *
 * 非法时抛 ProxyTestError('VALIDATION')，message 为字段级错误清单（"字段: 原因"用"；"连接）。
 * 注意：本文件禁止运行时依赖 electron（便于独立测试）；用 ProxyTestError 承载 VALIDATION，
 * IPC 层 toAppError 会原样保留 code。
 */
import { isIP } from 'node:net'
import type { ProxyConfig, ProxyType } from '../../shared/types'
import { ProxyTestError, proxyError } from './errors'

export const PROXY_TYPES: readonly ProxyType[] = ['http', 'https', 'socks5']

interface FieldIssue {
  field: string
  message: string
}

/** 归一化中间结果（校验通过后转 ProxyConfig） */
interface NormalizedProxy {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

/**
 * 校验并归一化代理配置；非法抛 ProxyTestError('VALIDATION', 字段级清单)。
 * 接受 IPC 线上来的 unknown 载荷，返回严格类型的 ProxyConfig（多余字段丢弃）。
 */
export function validateProxyConfig(input: unknown): ProxyConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw proxyError('VALIDATION', '代理配置无效：必须是一个对象')
  }
  const raw = input as Record<string, unknown>
  const issues: FieldIssue[] = []

  // ---- type ----
  let type: ProxyType | undefined
  if (typeof raw.type === 'string' && PROXY_TYPES.includes(raw.type as ProxyType)) {
    type = raw.type as ProxyType
  } else {
    issues.push({ field: 'type', message: `必须为 ${PROXY_TYPES.join(' / ')} 之一` })
  }

  // ---- host ----
  let host: string | undefined
  if (typeof raw.host === 'string') {
    const trimmed = raw.host.trim()
    if (!trimmed) {
      issues.push({ field: 'host', message: '不能为空' })
    } else if (/\s/.test(trimmed)) {
      issues.push({ field: 'host', message: '不能包含空白字符' })
    } else if (trimmed.length > 253 || !isValidProxyHost(trimmed)) {
      issues.push({ field: 'host', message: '不是合法的主机名 / IP 地址' })
    } else {
      host = trimmed
    }
  } else {
    issues.push({ field: 'host', message: '必须为字符串' })
  }

  // ---- port（接受 number 或纯数字字符串） ----
  let port: number | undefined
  const rawPort: unknown = typeof raw.port === 'string' ? raw.port.trim() : raw.port
  if (typeof rawPort === 'number' && Number.isInteger(rawPort)) {
    port = rawPort
  } else if (typeof rawPort === 'string' && /^\d+$/.test(rawPort)) {
    port = Number(rawPort)
  } else {
    issues.push({ field: 'port', message: '必须为 1–65535 的整数' })
  }
  if (port !== undefined && !(port >= 1 && port <= 65535)) {
    issues.push({ field: 'port', message: '必须在 1–65535 范围内' })
    port = undefined
  }

  // ---- 认证字段：空字符串视为未填写，其余必须成对 ----
  const username = normalizeOptionalString(raw.username)
  const password = normalizeOptionalString(raw.password)
  if (username === null && password !== null) {
    issues.push({ field: 'username', message: '已填写密码，用户名不能为空（认证字段须成对出现）' })
  }
  if (password === null && username !== null) {
    issues.push({ field: 'password', message: '已填写用户名，密码不能为空（认证字段须成对出现）' })
  }

  if (issues.length > 0 || type === undefined || host === undefined || port === undefined) {
    const detail = issues.map((i) => `${i.field}: ${i.message}`).join('；')
    throw proxyError('VALIDATION', `代理配置无效${detail ? `：${detail}` : ''}`)
  }

  const normalized: NormalizedProxy = { type, host, port }
  if (username !== null && password !== null) {
    normalized.username = username
    normalized.password = password
  }
  return normalized
}

/** 主机名校验：IPv4 / 域名 / [IPv6]（裸 IPv6 也放行，启动参数转换时再补方括号） */
function isValidProxyHost(host: string): boolean {
  if (isIP(host) !== 0) return true
  if (host.startsWith('[') && host.endsWith(']')) return isIP(host.slice(1, -1)) === 6
  // 域名：不含 @ / : \ 等定界与凭据注入字符，且形如点分标签
  if (/[@:/\\?#%]/.test(host)) return false
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/.test(
    host
  )
}

/** '' / 全空白 → null（未填写）；undefined → null；非字符串 → 报错由字段类型问题兜底 */
function normalizeOptionalString(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string')
    throw new ProxyTestError('VALIDATION', '代理配置无效：认证字段必须为字符串')
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}
