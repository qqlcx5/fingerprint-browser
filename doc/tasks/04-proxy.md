# 04 代理配置与测试

> 依赖：01
> 产出：`src/main/proxy/`
> 完成标准：四类错误（认证/超时/DNS/协议）文案可区分；能返回出口 IP、国家、延迟（需求文档 §6.4）

## 任务清单

- [x] T1 `proxy/validate.ts`：ProxyConfig 校验（type ∈ http/https/socks5、host、port 范围、认证字段成对出现），非法给出字段级错误
- [x] T2 `proxy/testEgress.ts`：经代理请求 IP 查询接口，解析出 `{ok, ip, country, latencyMs}`；测两个不同源避免单点误判
- [x] T3 `proxy/errors.ts`：错误分类映射——认证失败 / 连接超时 / DNS 失败 / 协议错误 → 各自 `code` + 用户可读文案（§9 矩阵前两行）
- [x] T4 IPC `proxy:test`：接 validate → testEgress → errors，渲染层一个调用拿到全部结果
- [x] T5 `proxy/launchOptions.ts`：把 ProxyConfig 转 `chromium.launchPersistentContext` 的 proxy 参数（含认证），供 06-launcher 使用

## 实现说明

### 文件结构

| 文件 | 职责 |
|---|---|
| `errors.ts` | `ProxyTestError` + 四类错误归类（errno/HTTP 状态/SOCKS 回复码 → code + 中文文案） |
| `validate.ts` | `validateProxyConfig(unknown): ProxyConfig`，字段级错误清单；空字符串认证字段视为未填写，其余必须成对 |
| `tunnel.ts` | 隧道层：HTTP CONNECT（Basic 认证）/ SOCKS5（RFC 1928 + 1929 认证）手写实现 + 隧道上的最小 HTTP/1.1 客户端（Content-Length/chunked） |
| `testEgress.ts` | `testEgress(cfg)` → `EgressInfo`；默认双源 `api.mir6.com` + `myip.ipip.net`（国内源）并行，任一成功即返回，全失败按 认证>协议>DNS>超时 优先级汇总上抛 |
| `launchOptions.ts` | `toPlaywrightProxy(cfg)` → `{server, username?, password?}`（server 含 scheme，IPv6 自动补方括号） |
| `index.ts` | `registerProxyIpc()`：注册 `proxy:test`（validate → testEgress）+ 模块统一出口 |

### 依赖下游接口的说明

- **07-env-manager**：启动前测连直接调 `testEgress(cfg)`；创建环境前的出口国家探测同样用它（失败降级直连基准，由 07 决策）
- **06-launcher**：`toPlaywrightProxy(cfg)` 直接放入 `launchPersistentContext` 的 `proxy` 参数；`server` 字段亦可作列表页 `proxySummary`（如 `socks5://1.2.3.4:1080`）
- 默认超时：连接/握手 10s，响应 10s（`TunnelTimeouts` 可覆写）；latencyMs 口径 = 建隧道到响应读完的总耗时

### 已知边界（需集成阶段决策）

1. **SOCKS5 认证 × Chromium 上游限制（已兜底，2026-09-09）**：Chromium `--proxy-server` 不支持 SOCKS5 用户名/密码认证，Playwright 的 `proxy.username/password` 仅对 http/https 代理生效。已实现 `proxy/relay.ts` 本地无认证 SOCKS5 中继：06-launcher 对 "socks5 + 账密" 环境在 127.0.0.1 随机端口起独立 relay，内核连 `socks5://127.0.0.1:{port}`，relay 经 `tunnel.ts` 的带认证 SOCKS5 隧道双向转发；中继随 context 关闭/启动失败清理（`launcher/launch.ts` relays 表）。目标域名经 SOCKS5 ATYP=3 交给代理侧解析，无本地 DNS 泄漏。
2. 双源均成功但国家字段不一致时取首选源（不做仲裁，出口漂移以启动对齐流程为准）
3. 依赖已冻结，未新增包：隧道协议为手写实现（含 mock E2E 覆盖）

## 验证记录（2026-09-07）

- `pnpm typecheck`（node + web 全仓）：通过，无错误
- `pnpm exec eslint src/main/proxy`：无问题
- 模块 E2E（mock 目标接口 ×2 / HTTP CONNECT 代理（认证/407/502/停滞）/ SOCKS5 代理（认证失败/方法拒绝），`/tmp` 内运行，未动仓库白名单外文件）：**21 passed, 0 failed**，覆盖：
  - 校验：合法三类型、port 越界/非数字、host 非法、认证不成对、非对象、空字符串认证归一化
  - 出口测试：http 认证代理成功取 IP/国家/延迟、407→PROXY_AUTH、502→PROXY_DNS、停滞→PROXY_TIMEOUT、类型选错→PROXY_PROTOCOL、socks5 成功/密码错/未填认证、双源回落、双源全失败汇总、代理拒连
  - 映射：含认证、IPv6 补括号、无认证省略字段

## 验证记录·补充（2026-09-07，真实网络）

在首轮 21 项 mock E2E 基础上追加 4 项，**全部通过（4 passed, 0 failed）**；离线套件回归 **21 passed, 0 failed**；`pnpm typecheck` 全仓复验无错误。

- 协议边界（离线）：chunked 响应解码 ✓；HTTP/1.0 无 Content-Length（读连接关闭定界）✓
- 真实网络（本地代理转发到真实 ipinfo.io / ipwho.is，https 目标）：
  - http 型 CONNECT 代理 → 真实 TLS 握手 + JSON 解析 ✓（出口 60.249.27.69 TW，约 400ms）
  - socks5 型代理 → ATYP=0x03 域名请求路径端到端 ✓（首次覆盖；此前离线用例均走 IPv4 字面量）
- 排障记录：真实网络首轮失败，定位为测试 mock 的 SOCKS 请求解析 off-by-one（ATYP=3 时端口偏移应含长度字节），**客户端实现无缺陷**（`socksAddress` 编码 RFC 正确）

## 接线（集成阶段）

`src/main/index.ts` 中调用：

```ts
import { registerProxyIpc } from './proxy'
registerProxyIpc()
```
