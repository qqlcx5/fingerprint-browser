/**
 * 04 代理模块出口（04-T4：IPC proxy:test 接线）
 *
 * proxy:test 数据流：validate（字段级校验）→ testEgress（双源测连）→ errors（分类上抛）。
 * 渲染层一次 window.api.proxyTest(ProxyConfig) 拿到 Result<EgressInfo>：
 * - ok: { ip, country, latencyMs }
 * - 失败: { code: VALIDATION | PROXY_AUTH | PROXY_TIMEOUT | PROXY_DNS | PROXY_PROTOCOL, message }
 *
 * 接线：src/main/index.ts 中调用 registerProxyIpc()（集成阶段统一接线，见模块 md 末尾说明）
 */
import { IPC, type EgressInfo, type ProxyTestInput } from '../../shared/types'
import { getLogger } from '../db'
import { defineIpc } from '../ipc'
import { getSystemProxyTransport } from './systemProxy'
import { testEgress } from './testEgress'
import { validateProxyConfig } from './validate'

export { validateProxyConfig, PROXY_TYPES } from './validate'
export {
  testEgress,
  DEFAULT_EGRESS_ENDPOINTS,
  type EgressEndpoint,
  type TestEgressOptions
} from './testEgress'
export { toPlaywrightProxy, type PlaywrightProxyOptions } from './launchOptions'
export { needsSocks5Relay, startSocks5Relay, type Socks5Relay } from './relay'
export { getSystemProxyTransport } from './systemProxy'
export { ProxyTestError, classifyProxyError, proxyError, type ProxyErrorPhase } from './errors'
export {
  openProxyTunnel,
  fetchThroughProxy,
  httpRequestOverSocket,
  type TunnelTimeouts
} from './tunnel'

/** 注册本模块全部 IPC 通道（当前仅 proxy:test） */
export function registerProxyIpc(): void {
  defineIpc<ProxyTestInput, EgressInfo>(IPC.proxyTest, async (input) => {
    const cfg = validateProxyConfig(input)
    const systemProxy = await getSystemProxyTransport()
    const upstreamProxy =
      systemProxy && !(systemProxy.host === cfg.host && systemProxy.port === cfg.port)
        ? systemProxy
        : undefined
    if (upstreamProxy) {
      getLogger().info('proxy.test.system_proxy_used', {
        proxyType: upstreamProxy.type,
        proxyHost: upstreamProxy.host,
        proxyPort: upstreamProxy.port
      })
    }
    return testEgress(cfg, { upstreamProxy })
  })
}
