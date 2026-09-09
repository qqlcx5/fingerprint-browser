# V2-01 契约与迁移协调

> 目标：为 V2 数据、IPC 和迁移建立唯一契约，避免并行 Agent 同时修改共享文件。
> 依赖：无。必须串行完成。
> 可写路径：`src/shared/types.ts`、`src/preload/**`、`src/main/ipc.ts`、`src/main/index.ts`、`doc/tasks/v2-01-contract.md`
> 禁止：修改业务目录实现、安装依赖、修改其他任务文档。

## 任务清单

- [x] T1 定义 V2 领域类型：`ShopSite`、`ShopMetadata`、`SecurityStatus`、`ProxyNetworkClass`、`ProxyBinding`、`ProxyImportRow` 和 `ProxyImportPreview`；明确 TOTP 仅保存 `totpSecretRef`，不得在 SQLite 存储密钥。
- [x] T2 为现有 `Env`、创建/更新/导入模型增加店铺站点、店铺标识、角色备注、安全状态和代理绑定字段；为旧记录定义可回退的默认值。
- [x] T3 定义并登记 IPC：代理 CSV 预检/提交绑定、代理重绑定、环境安全状态读取/更新、TOTP 启用/清除；所有调用保持 `Result<T>` 信封。
- [x] T4 同步 preload、`window.api` 声明和 IPC 白名单；未实现的通道由现有 `NOT_IMPLEMENTED` 占位返回，禁止暴露通用 IPC 调用。
- [x] T5 编写迁移契约说明：字段默认值、旧导出文件兼容策略、不可逆迁移的备份步骤和模块接线顺序。

## 迁移契约

- 数据库启动时增量添加 V2 列；旧环境回退为 `site=UNKNOWN`、空店铺标识、默认安全状态、无代理绑定与无 TOTP 引用。
- `expected_egress_ip` 使用部分唯一索引，只有非空业务绑定参与冲突检查；旧的 `proxy_config` 仅为兼容读取，V2 绑定写入 `proxy_binding`。
- 导出格式升级为 V2，且永远排除密码、TOTP 引用、登录态和审计日志。旧 V1 导出兼容导入仍由 V2-02 完成。
- 迁移前 SQLite WAL 会保留；升级发布前必须备份 `userData/data/envs.db`，出现失败可恢复备份后回退旧版本。
- 接线顺序：V2-01 契约 -> V2-02 迁移 -> V2-03/04/05 服务 -> V2-06 IPC 编排 -> V2-07 UI -> V2-08 发布。

## 验收

- `pnpm typecheck` 通过。
- 主进程、preload、渲染进程对所有新增通道的参数与返回类型一致。
- 不含 TOTP 密钥、代理密码明文或验证码的类型可被渲染进程访问。
- 协调者在本文件记录类型/通道变更后，才允许下游模块开工。
