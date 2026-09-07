# 06 启动/停止与生命周期

> 依赖：01 02 03 04 05
> 产出：`src/main/launcher/`
> 完成标准：验收 1/2/6 的运行时部分；崩溃/强退后无孤儿 Chromium 进程

## 任务清单

- [ ] T1 `launcher/status.ts`：内存状态表 `Record<id, EnvStatus>`，应用启动时全部置 idle（状态不落库，§5）；变化时推 `env:status-changed`
- [ ] T2 `launcher/launch.ts`：启动流水线——内核校验 → 代理测试 → 国家变更检测 → 指纹/对齐注入 → `launchPersistentContext`（分配随机空闲调试端口）
- [ ] T3 `launcher/stop.ts`：优雅 `close()`，5s 超时强杀进程树（Windows 需 taskkill /T）
- [ ] T4 窗口关闭 = 停止：监听 context close 事件，状态回写 idle（§6.6 语义）
- [ ] T5 `launcher/orphan.ts`：主进程启动时按 userDataDir 路径匹配进程命令行，清理上次崩溃留下的孤儿 Chromium
- [ ] T6 崩溃处理：进程异常退出 → 状态回 idle + 推送通知事件 + 退出码写日志（§9）
