# 03 浏览器内核管理

> 依赖：01
> 产出：`src/main/kernel/`
> 完成标准：无内核冷启动 → 下载成功 → 可拿到 executablePath；断网/空间不足报错可重试（验收 9）

## 任务清单

- [x] T1 `kernel/locate.ts`：revision 从 playwright-core 的 `browsers.json` 读取（不硬编码——升级 playwright-core 即升级内核，§3 版本锁定策略），按 revision 计算 executablePath（`userData/chromium/{revision}/`），校验存在 + 可执行，返回 `{ready, revision, path}`
- [x] T2 `kernel/space.ts`：下载前磁盘空间预检，剩余 < 2GB 拒绝并返回 `code=DISK_FULL`
- [x] T3 `kernel/download.ts`：下载 Chromium 到 `userData/chromium/{revision}/`，支持重试与断点续传，校验完整性（损坏 → 引导重下，§9）
- [x] T4 下载进度事件：经 `browser:download-progress` 推送 `{received, total}` 到渲染层
- [x] T5 IPC `browser:ensure`：ready 直接返回；否则执行预检 → 下载；错误分类：网络失败 / 空间不足 / 校验失败，各自带 code

## 设计要点（对应审查缺口）

- **revision 不硬编码**：`readChromiumDescriptor()` 读 playwright-core 1.63 的 browsers.json（chromium → revision 1243 / browserVersion 153.0.8010.12）；平台表（EXECUTABLE_TOKENS / DOWNLOAD_ZIP）逐项对照 playwright-core 内部 EXECUTABLE_PATHS / DOWNLOAD_PATHS（CFT 布局）镜像，升级 playwright-core 后若布局变化由 ready 校验立即暴露
- **镜像轮换**（2026-09-07 修正）：playwright 1.63 对 CFT 构建官方仅列 `cdn.playwright.dev`；实测 npmmirror 已托管 `builds/cft/*`（HTTP 200，~182MB）、官方 307 可跟随、prss 直连 400。修复原实现「3 次尝试固定打前 3 个镜像、官方源永远轮不到」的缺陷：改为**全部镜像各试一次为一轮 × 最多 2 轮**，顺序 npmmirror → 官方 → ESRP 兜底；`PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` / `PLAYWRIGHT_DOWNLOAD_HOST` 命中时只用自定义源（与 playwright 语义一致）
- **完整性三道关**：传输大小核对 → zip 中央目录可读（yauzl open）→ 解压后可执行文件校验；任一失败 → `KERNEL_CORRUPT` + 清理 .part/staging，下次 `browser:ensure` 全新下载（§9 引导重下）
- **断点续传**：`.part` 文件 + Range 请求；服务器忽略 Range 回 200 时覆盖重写；416 视为已下完（由 zip 校验兜底）；30s 空闲看门狗中断僵死连接后续传
- **解压安全**（unzip.ts，复用 playwright-core 内置 yauzl，零新依赖）：保留 unix 权限位与符号链接、跳过 `__MACOSX`、realpath 防路径穿越；`.part` → staging → 原子 rename 落位
- **并发去重**：下载期间重复 invoke `browser:ensure` 复用同一 Promise；进度广播 100ms 节流

## 接线

接线：`src/main/index.ts` 在 app ready 后调用 `registerKernelIpc()`（`import { registerKernelIpc } from './kernel'`），集成阶段统一接。

## 验证记录（2026-09-07，本窗口）

- `pnpm typecheck`（node + web）✅ 0 错误；`eslint src/main/kernel --max-warnings 0` ✅ 无问题
- esbuild 打包 stub 冒烟（/tmp，未触 Electron 运行时）9/9 通过：
  1. readChromiumDescriptor → `{revision:'1243', browserVersion:'153.0.8010.12'}` ✅
  2. currentPlatform → mac-arm64 ✅
  3. downloadZipRelPath → `builds/cft/153.0.8010.12/mac-arm64/chrome-mac-arm64.zip`（与官方 cftUrl 模板一致）✅
  4. locate() 未安装 → `{ready:false, revision:'1243', path:null}`（首启正常态）✅
  5. checkDiskSpace → 231.8GB，不拦截 ✅
  6. locate() 伪造安装目录 → `ready:true` + 正确 executablePath ✅
  7. extractZip：权限位 0755 保留 / 符号链接重建 / `__MACOSX` 跳过 ✅
  8. 损坏 zip → `KERNEL_CORRUPT` ✅
  9. 构造 `../escape.txt` 恶意条目 → `KERNEL_CORRUPT` 且未逃逸 ✅
- 镜像实测：npmmirror `builds/cft/…` HTTP 200（190,970,181B）；cdn.playwright.dev 307（fetch follow）；prss 400（轮换跳过）
- **未验证（集成阶段补）**：真实 190MB 全量下载 → 启动 Chromium（需 `pnpm exec electron`，本窗口禁跑）；断网/拔盘下的 DISK_FULL 现场复现
