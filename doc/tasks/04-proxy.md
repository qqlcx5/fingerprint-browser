# 04 代理配置与测试

> 依赖：01
> 产出：`src/main/proxy/`
> 完成标准：四类错误（认证/超时/DNS/协议）文案可区分；能返回出口 IP、国家、延迟（需求文档 §6.4）

## 任务清单

- [ ] T1 `proxy/validate.ts`：ProxyConfig 校验（type ∈ http/https/socks5、host、port 范围、认证字段成对出现），非法给出字段级错误
- [ ] T2 `proxy/testEgress.ts`：经代理请求 IP 查询接口，解析出 `{ok, ip, country, latencyMs}`；测两个不同源避免单点误判
- [ ] T3 `proxy/errors.ts`：错误分类映射——认证失败 / 连接超时 / DNS 失败 / 协议错误 → 各自 `code` + 用户可读文案（§9 矩阵前两行）
- [ ] T4 IPC `proxy:test`：接 validate → testEgress → errors，渲染层一个调用拿到全部结果
- [ ] T5 `proxy/launchOptions.ts`：把 ProxyConfig 转 `chromium.launchPersistentContext` 的 proxy 参数（含认证），供 06-launcher 使用
