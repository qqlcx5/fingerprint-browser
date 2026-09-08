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
import { decryptProxyConfig, getEnvDao } from '../db'
import { defineIpc } from '../ipc'
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
export { ProxyTestError, classifyProxyError, proxyError, type ProxyErrorPhase } from './errors'
export {
  openProxyTunnel,
  fetchThroughProxy,
  httpRequestOverSocket,
  type TunnelTimeouts
} from './tunnel'

/** 注册本模块全部 IPC 通道（当前仅 proxy:test） */
export function registerProxyIpc(): void {
  defineIpc<ProxyTestInput, EgressInfo>(IPC.proxyTest, async (payload) => {
    let input = payload
    const savedPasswordEnvId =
      payload !== null && typeof payload === 'object' ? payload.savedPasswordEnvId : undefined
    const missingPassword =
      payload !== null && typeof payload === 'object' && payload.password === undefined
    if (missingPassword && typeof savedPasswordEnvId === 'string') {
      const stored = getEnvDao().getEnv(savedPasswordEnvId)?.proxyConfig
      if (stored?.password) {
        // 密码只在主进程中解密，供本次测试使用；不会进入 IPC 返回值或日志。
        input = { ...input, password: decryptProxyConfig(stored).password }
      }
    }
    const cfg = validateProxyConfig(input)
    return testEgress(cfg)
  })
}
