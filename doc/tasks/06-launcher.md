# 06 启动/停止与生命周期

> 依赖：01 02 03 04 05
> 产出：`src/main/launcher/`
> 完成标准：验收 1/2/6 的运行时部分；崩溃/强退后无孤儿 Chromium 进程

## 任务清单

- [x] T1 `launcher/status.ts`：内存状态表 `Record<id, EnvStatus>`，应用启动时全部置 idle（状态不落库，§5）；变化时推 `env:status-changed`
- [x] T2 `launcher/launch.ts`：启动流水线——内核校验 → 代理测试（经 `decryptSecret` 解密代理密码，明文仅内存）→ 国家变更检测 → 指纹/对齐注入 → `launchPersistentContext`（Playwright `--remote-debugging-pipe`，无需调试端口）；用原生 `downloadsPath` 将下载目录设为 `envs/{id}/downloads`（§5，Chromium 默认下载目录不在 profile 内）
- [x] T3 `launcher/stop.ts`：优雅 `close()`，5s 超时强杀进程树（Windows 需 taskkill /T）
- [x] T4 窗口关闭 = 停止：监听 context close 事件，状态回写 idle（§6.6 语义）
- [x] T5 `launcher/orphan.ts`：主进程启动时按 userDataDir 路径匹配进程命令行，清理上次崩溃留下的孤儿 Chromium
- [x] T6 崩溃处理：启动期 context 异常关闭或页面 `crash` 事件 → 状态回 idle + 经 `env:crashed` 事件推送 `CrashedInfo{envId, exitCode:null}` + 日志记录（Playwright context API 不提供浏览器进程退出码；运行中 context close 按用户关窗语义处理，§9）
- [x] T7 应用退出钩子：before-quit 逐个优雅停止所有活动环境（含 starting/stopping），单个 5s 超时强杀（§6.6），防止孤儿进程与脏状态

## 验证记录（2026-09-07）

- `pnpm typecheck` / `pnpm lint` / `pnpm build` / E2E 冒烟全绿（启动路径含 initStatuses + 孤儿清理）
- 2026-09-08 对抗式修复：Windows 孤儿清理根路径改用 `dirname(envProfileDir(''))`；启动 context 建立后立即登记监听；页面崩溃与启动期 context 异常关闭会推 `env:crashed`；退出/清除数据覆盖所有非 idle 状态，并以取消令牌阻止启动中的任务在停止后继续创建 Chromium。生产态 `pnpm build` + E2E CRUD/非法代理校验 PASS；真实 Chromium 与 Windows 孤儿场景仍待目标环境回归。

## 实现偏离记录（更优方案，不影响验收）

1. **下载目录**：用 playwright 原生 `downloadsPath` 选项，替代任务文档写的 CDP `Browser.setDownloadBehavior`（等价、少一次 CDP 会话）
2. **随机调试端口**：不再需要。playwright 默认走 `--remote-debugging-pipe` 管道通信，无端口冲突（§6.6 该条作废）
3. **崩溃检测（T6）**：Playwright persistent context 未提供浏览器进程退出码；启动期 context 异常关闭与页面 `crash` 可推 `env:crashed`（exitCode 恒 null），运行中 context close 按用户关窗语义处理。整个 Chromium 进程异常退出仍需真实环境回归确认。
4. **运行时真实启动**（验收 1/2/6）需内核就绪，随 07/M3 稳定性测试覆盖
