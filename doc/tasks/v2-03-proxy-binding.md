# V2-03 代理绑定与批量预检

> 目标：实现每环境固定出口 IP、启动前变化阻断和 CSV 代理池预验证。
> 依赖：V2-01、V2-02。
> 可写路径：`src/main/proxy/**`、`doc/tasks/v2-03-proxy-binding.md`
> 禁止：直接修改 DB schema、环境编排、渲染界面或共享契约。

## 任务清单

- [x] T1 扩展代理校验：接受且要求 `networkClass` 为 `static_residential`、`sticky_residential` 或 `isp`；缺失/数据中心类型返回可读校验错误。该字段是产品规则，不作为 TikTok Shop 规则描述。
- [x] T2 实现 CSV 解析与行级校验，输出行号、代理摘要、错误原因；密码只在主进程内存中处理，预览模型不回传明文。
- [x] T3 实现代理池预检：并发受限地调用双源出口检测，生成 IP、国家、延迟、失败类型和重复出口 IP 冲突清单。
- [x] T4 实现绑定/重绑定服务：仅允许预检成功的代理写入绑定；检查出口 IP 唯一性；重绑定必须要求原因并返回旧/新出口差异。
- [x] T5 为启动器提供 `verifyBoundEgress(binding)`：出口 IP 与 `expectedEgressIp` 不一致时返回明确业务错误，禁止创建浏览器上下文。

## 验证记录

- 2026-09-09：`pnpm typecheck`、本模块 ESLint 和 Electron 冒烟通过。
- 预检最多并发 3 条；同时检查已绑定环境和同一 CSV 内重复出口 IP。
- 真实 12 条 HTTP/HTTPS/SOCKS5 代理回归留给 V2-08 T3。

## 验收

- 12 条 CSV 可生成完整预检预览，包含失败行与 IP 冲突行。
- 两个环境不能成功绑定同一出口 IP。
- 同一代理出口变化时，验证返回阻断错误，不自动更新绑定。
- HTTP、HTTPS、SOCKS5（含认证）现有测试回归通过。
