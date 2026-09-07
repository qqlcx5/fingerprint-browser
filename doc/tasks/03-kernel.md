# 03 浏览器内核管理

> 依赖：01
> 产出：`src/main/kernel/`
> 完成标准：无内核冷启动 → 下载成功 → 可拿到 executablePath；断网/空间不足报错可重试（验收 9）

## 任务清单

- [ ] T1 `kernel/locate.ts`：revision 从 playwright-core 的 `browsers.json` 读取（不硬编码——升级 playwright-core 即升级内核，§3 版本锁定策略），按 revision 计算 executablePath（`userData/chromium/{revision}/`），校验存在 + 可执行，返回 `{ready, revision, path}`
- [ ] T2 `kernel/space.ts`：下载前磁盘空间预检，剩余 < 2GB 拒绝并返回 `code=DISK_FULL`
- [ ] T3 `kernel/download.ts`：下载 Chromium 到 `userData/chromium/{revision}/`，支持重试与断点续传，校验完整性（损坏 → 引导重下，§9）
- [ ] T4 下载进度事件：经 `browser:download-progress` 推送 `{received, total}` 到渲染层
- [ ] T5 IPC `browser:ensure`：ready 直接返回；否则执行预检 → 下载；错误分类：网络失败 / 空间不足 / 校验失败，各自带 code
