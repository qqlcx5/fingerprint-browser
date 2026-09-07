# 01 工程骨架与 IPC 框架

> 依赖：无
> 产出：`src/shared/`、`src/preload/`、`src/main/ipc.ts`
> 完成标准：渲染进程经 `window.api.ping()` 拿到主进程返回值，全链路 TS 类型正确；`pnpm typecheck` 通过

## 任务清单

- [ ] T1 清理脚手架 demo（Versions.vue、默认样式），建目录：`src/main/{db,kernel,proxy,fingerprint,launcher}/`、`src/shared/`、`src/renderer/src/{views,components}/`
- [ ] T2 `src/shared/types.ts`：定义 `Env`、`ProxyConfig`、`CoreFingerprint`、`AlignFields`、`EnvStatus`、`AppError{code,message}`、IPC 通道名常量（对齐需求文档 §4 契约表与 §5 数据模型）
- [ ] T3 主进程统一 IPC 注册器：`handle(name, fn)` 包装，业务异常统一转 `AppError{code,message}` 回传，未注册通道拒绝
- [ ] T4 preload：`contextBridge` 暴露 `window.api` 骨架（全部通道 stub），确认 `contextIsolation:true`、`nodeIntegration:false`
- [ ] T5 渲染进程 `env.d.ts` 挂载 `window.api` 类型；实现 ping 通道端到端验证
- [ ] T6 接入 better-sqlite3：安装 + postinstall rebuild + `electron-builder install-app-deps` 验证原生模块可用
