# 02 数据存储

> 依赖：01
> 产出：`src/main/db/`、`src/shared/paths.ts`
> 完成标准：重启应用数据不丢；损坏 db 自动备份重建（需求文档 §9）；删除环境连目录一起删

## 任务清单

- [x] T1 `src/shared/paths.ts`：集中定义存储路径（`data/envs.db`、`envs/{id}/profile`、`envs/{id}/downloads`、`chromium/{revision}`、`logs/`），主进程唯一入口，禁止散落拼路径
- [x] T2 `db/init.ts`：打开 SQLite、建 environments 表（字段按 §5，含索引）；启动时检测库损坏 → 备份为 `.bak` → 重建空库并返回"已重置"标记（由 07 收集进 `app:notices` 队列，kind=db_reset，交界面提示）
- [x] T3 `db/envDao.ts`：`createEnv / getEnv / listEnvs / updateEnv / deleteEnv`（纯数据库层，不动文件目录）
- [x] T4 `db/secret.ts`：代理密码 `safeStorage` 加密封装 `encryptSecret / decryptSecret`；不可用时降级机器级混淆并在返回值带 `weak:true` 标记（§8；由 07 收集进 `app:notices` 队列，kind=weak_encryption）；明文仅限主进程内存使用（06/07 启动与代理测试时经 `decryptSecret` 取用，不落日志）
- [x] T5 目录生命周期：createEnv 建目录（profile + downloads）；deleteEnv 幂等删两目录，失败仅记日志不阻塞删记录 → 组装成完整删除流程
- [x] T6 `db/logger.ts`：滚动日志器（`userData/logs/`，单文件 5MB × 5 个，§5），主进程唯一日志入口；§9 崩溃退出码、孤儿清理、加密降级等均写此日志

## 验证记录（2026-09-07 集成验收）

- 代码审查 + `pnpm typecheck` 通过；`setupStorage/closeStorage` 已接入 `src/main/index.ts`
- 运行时数据链路冒烟（建环境→重启→登录态保留）随 07-env-manager 集成一并覆盖（验收 2）
- 模块内自查：`pnpm typecheck:node` 对 `src/main/db/**` 零报错；`pnpm exec eslint --no-cache 'src/main/db/**/*.ts'` 0 error / 0 warning

## 实现说明

- `db/index.ts` 桶出口：`setupStorage()`（initLogger → openDatabase → createEnvDao，返回 `{ dao, logger, reset }`）；`getEnvDao()` 未初始化抛 `STORAGE_NOT_READY` 暴露接线缺失；`closeStorage()` 关库落 WAL checkpoint
- 损坏判定 = 打开 / pragma / `quick_check(1)` 任一失败；备份 `envs.db.bak` 前先清 `-wal`/`-shm` 边车；**migrate（建表）失败属程序缺陷，直接抛出不触发重建**，避免误清健康库；重建时写 `db.corrupt.rebuilt` 日志（§9）
- 表结构：字段与 §5 逐列对齐（fingerprint/align_fields/proxy_config 为 JSON TEXT），索引 `idx_environments_created_at` / `idx_environments_updated_at`；WAL + synchronous=NORMAL；运行状态不入库（§5）
- 核心指纹只读双保险（§6.5 / 05-T3）：`EnvChanges` 类型不含 fingerprint 字段 + `updateEnv` 运行时断言抛 `FINGERPRINT_READONLY`
- 密封密码 `SealedSecret { payload, weak }`：payload = base64(JSON{v,weak,d}) 带版本号；弱混淆密钥 = sha256(hostname + userData 路径)（跨机器拷库不可解）；解密失败抛 `SECRET_DECRYPT_FAILED`（系统凭据变更场景）。weak 标记双通道上浮：`safeStorage.isEncryptionAvailable()` 启动判定（index.ts → pushNotice weak_encryption）+ 入库后可从 `EnvRecord.proxyConfig.password.weak` 读取
- 目录生命周期 `envLifecycle.ts`：`createEnvWithDirs` 先落库拿 id 再建 profile/downloads，建目录失败回滚删记录，不留"无目录环境"；`deleteEnvWithDirs` 先删记录再递归删 `envs/{id}` 整目录（force 幂等），目录删除失败仅记 `env.dirs.delete-failed` 不阻塞删记录；`assertSafeEnvId` UUID 正则校验，id 进文件操作前拦路径穿越
- 日志器：同步写（崩溃日志不丢）；写前对 `password|secret|token|authorization` 键递归脱敏（密码明文永不落日志的双保险，§8）；滚动 main.log + main.1~4.log 共 5 个 × 5MB；自身失败静默不影响业务
- 附供上层转换：`toPublicProxy`（密码不回传仅 hasPassword，§8）、`decryptProxyConfig`（明文仅主进程内存，06 启动注入 / 07 代理测试取用）

## 接线

接线：`src/main/index.ts` 已在 `app.whenReady` 内、`registerIpc()` 之前调用 `setupStorage()`（集成完成）；`storage.reset === true` → `pushNotice('db_reset', …)`、`!safeStorage.isEncryptionAvailable()` → `pushNotice('weak_encryption', …)`（经 07-T9 `app:notices` 拉取通道交界面提示）；`before-quit` 在 06-T7 `stopAllRunning()` 之后调用 `closeStorage()`。07 经 `getEnvDao()` + `createEnvWithDirs/deleteEnvWithDirs` + `toPublicProxy/decryptProxyConfig` 使用本层（envManager/index.ts、wipe.ts 已接线）。
