# 02 数据存储

> 依赖：01
> 产出：`src/main/db/`、`src/shared/paths.ts`
> 完成标准：重启应用数据不丢；损坏 db 自动备份重建（需求文档 §9）；删除环境连目录一起删

## 任务清单

- [ ] T1 `src/shared/paths.ts`：集中定义存储路径（`data/envs.db`、`envs/{id}/profile`、`envs/{id}/downloads`、`chromium/{revision}`、`logs/`），主进程唯一入口，禁止散落拼路径
- [ ] T2 `db/init.ts`：打开 SQLite、建 environments 表（字段按 §5，含索引）；启动时检测库损坏 → 备份为 `.bak` → 重建空库并返回"已重置"标记（交界面提示）
- [ ] T3 `db/envDao.ts`：`createEnv / getEnv / listEnvs / updateEnv / deleteEnv`（纯数据库层，不动文件目录）
- [ ] T4 `db/secret.ts`：代理密码 `safeStorage` 加密封装 `encryptSecret / decryptSecret`；不可用时降级机器级混淆并在返回值带 `weak:true` 标记（§8）；明文仅限主进程内存使用（06/07 启动与代理测试时经 `decryptSecret` 取用，不落日志）
- [ ] T5 目录生命周期：createEnv 建目录（profile + downloads）；deleteEnv 幂等删两目录，失败仅记日志不阻塞删记录 → 组装成完整删除流程
- [ ] T6 `db/logger.ts`：滚动日志器（`userData/logs/`，单文件 5MB × 5 个，§5），主进程唯一日志入口；§9 崩溃退出码、孤儿清理、加密降级等均写此日志
