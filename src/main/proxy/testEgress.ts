/**
 * 出口连通性测试（04-T2，需求文档 §6.4）
 *
 * 经代理请求 IP 查询接口，返回 {ip, country, latencyMs}。
 * 同时测两个不同源（并行），避免单一接口抖动/限流造成误判：
 * - 任一源成功 → 采用首个成功源（顺序即优先级）的结果
 * - 两源均成功但国家字段不一致 → 仍取首选源（不做仲裁，代理出口漂移时以启动对齐流程为准）
 * - 全部失败 → 按 errors.ts 的优先级挑最有诊断价值的错误上抛，并附"多源均失败"说明
 *
 * latencyMs = 该次成功请求从建立隧道到响应读完的总耗时（用户感知的代理延迟）。
 */
import type { EgressInfo, ProxyConfig } from '../../shared/types'
import { classifyProxyError, proxyError, proxyErrorPriority, ProxyTestError } from './errors'
import { fetchThroughProxy, type TunnelTimeouts } from './tunnel'

export interface EgressEndpoint {
  /** IP 查询接口 URL（GET，返回 JSON） */
  url: string
  /** 从响应 JSON 提取出口信息；字段缺失时返回空值由上层兜底 */
  parse: (json: Record<string, unknown>) => { ip?: unknown; country?: unknown }
}

/** 默认双源：均为免费匿名接口，返回 IP + ISO 3166-1 alpha-2 国家码 */
export const DEFAULT_EGRESS_ENDPOINTS: EgressEndpoint[] = [
  {
    url: 'https://ipinfo.io/json',
    parse: (j) => ({ ip: j['ip'], country: j['country'] })
  },
  {
    url: 'https://ipwho.is/',
    parse: (j) => ({ ip: j['ip'], country: j['country_code'] })
  }
]

export interface TestEgressOptions {
  endpoints?: EgressEndpoint[]
  timeouts?: TunnelTimeouts
}

/** 出口信息校验：ip 必须形如 IPv4/IPv6，country 允许为空字符串（接口偶发缺字段不算失败） */
function normalizeEgress(ip: unknown, country: unknown, latencyMs: number): EgressInfo {
  const ipStr = typeof ip === 'string' ? ip.trim() : ''
  const isV4 =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ipStr) && ipStr.split('.').every((n) => Number(n) <= 255)
  const isV6 = ipStr.includes(':')
  if (!isV4 && !isV6) {
    throw proxyError('PROXY_PROTOCOL', `出口检测源返回了无法识别的 IP（${JSON.stringify(ipStr)}）`)
  }
  const countryStr = typeof country === 'string' ? country.trim().toUpperCase() : ''
  return { ip: ipStr, country: countryStr, latencyMs: Math.max(0, Math.round(latencyMs)) }
}

/** 单个端点的完整尝试：建隧道 → 请求 → 解析。失败抛 ProxyTestError */
async function tryEndpoint(
  cfg: ProxyConfig,
  ep: EgressEndpoint,
  timeouts?: TunnelTimeouts
): Promise<EgressInfo> {
  const startedAt = performance.now()
  const res = await fetchThroughProxy(cfg, ep.url, timeouts)
  if (res.status < 200 || res.status >= 300) {
    throw proxyError('PROXY_PROTOCOL', `出口检测源返回 HTTP ${res.status}`)
  }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(res.body) as Record<string, unknown>
  } catch {
    throw proxyError('PROXY_PROTOCOL', '出口检测源返回了非 JSON 响应')
  }
  const { ip, country } = ep.parse(json)
  return normalizeEgress(ip, country, performance.now() - startedAt)
}

/** 测试代理出口：并行请求默认双源，成功即返回；全失败抛分类后的 ProxyTestError */
export async function testEgress(cfg: ProxyConfig, opts?: TestEgressOptions): Promise<EgressInfo> {
  const endpoints = opts?.endpoints ?? DEFAULT_EGRESS_ENDPOINTS
  if (endpoints.length === 0) throw proxyError('INTERNAL', '出口检测源列表为空')

  const settled = await Promise.allSettled(
    endpoints.map((ep) => tryEndpoint(cfg, ep, opts?.timeouts))
  )

  // 首个成功源（endpoints 顺序 = 优先级）
  for (const s of settled) {
    if (s.status === 'fulfilled') return s.value
  }

  // 全部失败：挑最有诊断价值的错误（认证 > 协议 > DNS > 超时）
  const errors = settled.map((s): ProxyTestError =>
    s.status === 'rejected'
      ? classifyProxyError(s.reason, 'target')
      : proxyError('INTERNAL', 'unreachable')
  )
  const best = errors.reduce((acc, cur) =>
    proxyErrorPriority(cur.code) < proxyErrorPriority(acc.code) ? cur : acc
  )
  if (errors.length > 1) {
    best.message = `${best.message}；全部 ${errors.length} 个出口检测源均失败，请检查代理服务商`
  }
  throw best
}
