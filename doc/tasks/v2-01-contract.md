# V2-01 契约与迁移协调

> 目标：为 V2 数据、IPC 和迁移建立唯一契约，避免并行 Agent 同时修改共享文件。
> 依赖：无。必须串行完成。
> 可写路径：`src/shared/types.ts`、`src/preload/**`、`src/main/ipc.ts`、`src/main/index.ts`、`doc/tasks/v2-01-contract.md`
> 禁止：修改业务目录实现、安装依赖、修改其他任务文档。

## 任务清单

- [ ] T1 定义 V2 领域类型：`ShopSite`、`ShopMetadata`、`SecurityStatus`、`ProxyNetworkClass`、`ProxyBinding`、`ProxyImportRow` 和 `ProxyImportPreview`；明确 TOTP 仅保存 `totpSecretRef`，不得在 SQLite 存储密钥。
- [ ] T2 为现有 `Env`、创建/更新/导入模型增加店铺站点、店铺标识、角色备注、安全状态和代理绑定字段；为旧记录定义可回退的默认值。
- [ ] T3 定义并登记 IPC：代理 CSV 预检/提交绑定、代理重绑定、环境安全状态读取/更新、TOTP 启用/清除；所有调用保持 `Result<T>` 信封。
- [ ] T4 同步 preload、`window.api` 声明和 IPC 白名单；未实现的通道由现有 `NOT_IMPLEMENTED` 占位返回，禁止暴露通用 IPC 调用。
- [ ] T5 编写迁移契约说明：字段默认值、旧导出文件兼容策略、不可逆迁移的备份步骤和模块接线顺序。

## 验收

- `pnpm typecheck` 通过。
- 主进程、preload、渲染进程对所有新增通道的参数与返回类型一致。
- 不含 TOTP 密钥、代理密码明文或验证码的类型可被渲染进程访问。
- 协调者在本文件记录类型/通道变更后，才允许下游模块开工。
