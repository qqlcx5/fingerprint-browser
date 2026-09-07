# 01 工程骨架与 IPC 框架

> 依赖：无
> 产出：`src/shared/`、`src/preload/`、`src/main/ipc.ts`
> 完成标准：渲染进程经 `window.api.ping()` 拿到主进程返回值，全链路 TS 类型正确；`pnpm typecheck` 通过

## 任务清单

- [x] T1 清理脚手架 demo（Versions.vue、默认样式），建目录：`src/main/{db,kernel,proxy,fingerprint,launcher}/`、`src/shared/`、`src/renderer/src/{views,components}/`
- [x] T2 `src/shared/types.ts`：定义 `Env`、`ProxyConfig`、`CoreFingerprint`、`AlignFields`、`EnvStatus`、`AppError{code,message}`、IPC 通道名常量（对齐需求文档 §4 契约表与 §5 数据模型）
- [x] T3 主进程统一 IPC 注册器：`handle(name, fn)` 包装，业务异常统一转 `AppError{code,message}` 回传，未注册通道拒绝
- [x] T4 preload：`contextBridge` 暴露 `window.api` 骨架（全部通道 stub），确认 `contextIsolation:true`、`nodeIntegration:false`
- [x] T5 渲染进程 `env.d.ts` 挂载 `window.api` 类型；实现 ping 通道端到端验证
- [x] T6 接入 better-sqlite3：安装 + postinstall rebuild + `electron-builder install-app-deps` 验证原生模块可用

## 契约要点（后续模块必读）

1. **返回信封**：所有 invoke 通道返回 `Result<T> = { ok:true, data } | { ok:false, error: AppError }`，主进程**永不 throw 到渲染层**。业务错误用 `ipc.ts` 的 `fail(code, message)` 抛出
2. **模块接线方式**：各模块在自己的目录内 `defineIpc(IPC.xxx, handler)`，导出 `registerXxxIpc()`；由协调者在 `src/main/index.ts` 统一调用（各轨**不改** index.ts）
3. **事件广播**：主进程→渲染层用 `broadcast(channel, payload)`（`src/main/ipc.ts`）
4. **未接线通道**：`registerIpc()` 自动注册 `NOT_IMPLEMENTED` 占位，渲染层可安全调用
5. **冻结文件**：`src/shared/types.ts`、`src/shared/paths.ts`、`src/main/ipc.ts`、`src/preload/**`、`package.json`、`pnpm-workspace.yaml`、`eslint.config.mjs`、`electron.vite.config.ts`

## 验证记录（2026-09-07）

- `pnpm typecheck` ✅　`pnpm lint` ✅　`pnpm build` ✅
- `pnpm exec electron scripts/check-native.cjs` → `NATIVE_OK sqlite_version=3.53.4`（Electron ABI 下 better-sqlite3 可用）
- `E2E_SMOKE=1 pnpm exec electron .` → `E2E_RESULT PASS`
  - ping：`{"ok":true,"data":{"pong":true,"arch":"arm64","sqlite":true}}`
  - envList：`{"ok":false,"error":{"code":"NOT_IMPLEMENTED"}}`（占位符合预期）
- 冒烟模式已内置于 `src/main/index.ts`（`E2E_SMOKE=1` 分支），后续模块接线后自动覆盖新通道

## 环境坑位记录（worktree 里 pnpm install 会复用）

- pnpm 10 原生模块构建许可在 `pnpm-workspace.yaml` 的 `allowBuilds`（better-sqlite3 已置 true）
- `node-gyp` 不随 pnpm 提供，已 `npm i -g node-gyp`（全局，worktree 复用）
- `.npmrc` 已配 npmmirror（registry / node 头文件 / electron / better-sqlite3 预编译二进制）

## 协调变更记录

- 2026-09-07 二次审查（对抗式复核 01，验证记录全部复现 PASS）：冻结契约**增量** +3 通道——`env:crashed`（事件，CrashedInfo）、`app:notices`（invoke 拉取，StartupNotice）、`app:wipeData`（invoke）；types.ts 与 preload Api 已同步，纯增量未动既有通道。补建 `src/main/{db,kernel,proxy,fingerprint,launcher}/` 与 `renderer/src/components/`（.gitkeep）。检测时机/wipeData 语义等决策见 traceability.md「显式契约决策记录」。
