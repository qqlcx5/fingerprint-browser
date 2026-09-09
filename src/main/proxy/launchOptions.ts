/**
 * ProxyConfig → Playwright 启动参数（04-T5，供 06-launcher 使用）
 *
 * chromium.launchPersistentContext(userDataDir, { proxy: toPlaywrightProxy(cfg) })。
 * 环境列表的 proxySummary（如 'socks5://1.2.3.4:1080'）也可直接取返回值的 server 字段。
 *
 * ⚠ 上游限制与兜底（需求文档 §6.4"含账号密码认证"）：
 * Chromium 原生 --proxy-server 对 SOCKS5 不支持用户名/密码认证，Playwright 的
 * proxy.username/password 仅对 http/https 代理生效。因此 06-launcher 对
 * "socks5 + 账密"形态不走本函数，改用 relay.ts 的本地无认证 SOCKS5 中继
 * （proxy = { server: 'socks5://127.0.0.1:{port}' }）；本函数继续服务其余形态。
 */
import type { ProxyConfig } from '../../shared/types'

/** chromium.launchPersistentContext 的 proxy 参数形状 */
export interface PlaywrightProxyOptions {
  server: string
  username?: string
  password?: string
}

export function toPlaywrightProxy(cfg: ProxyConfig): PlaywrightProxyOptions {
  // IPv6 字面量补方括号，scheme 直接采用 ProxyType（http/https/socks5 与 Playwright 支持一致）
  const host = cfg.host.includes(':') && !cfg.host.startsWith('[') ? `[${cfg.host}]` : cfg.host
  const out: PlaywrightProxyOptions = { server: `${cfg.type}://${host}:${cfg.port}` }
  if (cfg.username !== undefined && cfg.password !== undefined) {
    out.username = cfg.username
    out.password = cfg.password
  }
  return out
}
