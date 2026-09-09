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
import { getLogger } from '../db'
import { classifyProxyError, proxyError, proxyErrorPriority, ProxyTestError } from './errors'
import { fetchThroughProxy, type ProxyTransport, type TunnelTimeouts } from './tunnel'

export interface EgressEndpoint {
  /** IP 查询接口 URL（GET，返回 JSON） */
  url: string
  /** 从响应 JSON 提取出口信息；字段缺失时返回空值由上层兜底 */
  parse: (json: Record<string, unknown>) => { ip?: unknown; country?: unknown }
}

/** 中文国名 → ISO 3166-1 alpha-2（仅覆盖常见代理出口国家/地区，未命中返回 undefined 由上层兜底为空） */
const COUNTRY_NAME_TO_ISO: Readonly<Record<string, string>> = {
  中国: 'CN',
  香港: 'HK',
  澳门: 'MO',
  台湾: 'TW',
  日本: 'JP',
  韩国: 'KR',
  新加坡: 'SG',
  美国: 'US',
  加拿大: 'CA',
  英国: 'GB',
  德国: 'DE',
  法国: 'FR',
  荷兰: 'NL',
  俄罗斯: 'RU',
  印度: 'IN',
  澳大利亚: 'AU',
  巴西: 'BR',
  马来西亚: 'MY',
  泰国: 'TH',
  越南: 'VN',
  菲律宾: 'PH',
  印度尼西亚: 'ID',
  阿联酋: 'AE',
  土耳其: 'TR',
  意大利: 'IT',
  西班牙: 'ES'
}

/** 默认双源：国内与海外各一；任一成功即可确认代理可用，同时保留双向网络诊断。 */
export const DEFAULT_EGRESS_ENDPOINTS: EgressEndpoint[] = [
  {
    url: 'https://myip.ipip.net/json',
    parse: (j) => {
      const data = j['data'] as Record<string, unknown> | undefined
      const location = Array.isArray(data?.['location']) ? (data!['location'] as unknown[]) : []
      const name = typeof location[0] === 'string' ? location[0].trim() : ''
      return { ip: data?.['ip'], country: COUNTRY_NAME_TO_ISO[name] ?? '' }
    }
  },
  {
    url: 'https://ipinfo.io/json',
    parse: (j) => ({ ip: j['ip'], country: j['country'] })
  }
]

export interface TestEgressOptions {
  endpoints?: EgressEndpoint[]
  timeouts?: TunnelTimeouts
  /** Windows/macOS 系统代理的本地节点；用于在未启用 TUN 时转发到用户配置的远端代理。 */
  upstreamProxy?: ProxyTransport
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
  timeouts?: TunnelTimeouts,
  upstreamProxy?: ProxyTransport
): Promise<EgressInfo> {
  const startedAt = performance.now()
  getLogger().info('proxy.test.endpoint_started', {
    target: ep.url,
    proxyType: cfg.type,
    proxyHost: cfg.host,
    proxyPort: cfg.port
  })
  try {
    const res = await fetchThroughProxy(cfg, ep.url, timeouts, upstreamProxy)
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
  } catch (error) {
    const classified = classifyProxyError(error, 'target')
    getLogger().warn('proxy.test.endpoint_failed', {
      target: ep.url,
      code: classified.code,
      message: classified.message,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
    throw classified
  }
}

/** 测试代理出口：并行请求国内和海外检测源；任一路成功即通过，首个成功源作为出口结果。 */
export async function testEgress(cfg: ProxyConfig, opts?: TestEgressOptions): Promise<EgressInfo> {
  const endpoints = opts?.endpoints ?? DEFAULT_EGRESS_ENDPOINTS
  if (endpoints.length === 0) throw proxyError('INTERNAL', '出口检测源列表为空')

  const settled = await Promise.allSettled(
    endpoints.map((ep) => tryEndpoint(cfg, ep, opts?.timeouts, opts?.upstreamProxy))
  )

  const results: EgressInfo[] = []
  const errors: ProxyTestError[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.push(result.value)
      return
    }
    const error = classifyProxyError(result.reason, 'target')
    const endpoint = endpoints[index]?.url ?? `出口检测源 #${index + 1}`
    error.message = `${endpoint}：${error.message}`
    errors.push(error)
  })

  if (results.length > 0) {
    if (errors.length > 0) {
      getLogger().warn('proxy.test.partial_success', {
        passed: results.length,
        total: endpoints.length,
        failed: errors.map((error) => error.message)
      })
    }
    return results[0]
  }

  const best = errors.reduce((acc, cur) =>
    proxyErrorPriority(cur.code) < proxyErrorPriority(acc.code) ? cur : acc
  )
  const failed = errors.map((error) => error.message).join('；')
  best.message = `代理测试失败：全部 ${endpoints.length} 个检测源均失败；${failed}`
  throw best
}
