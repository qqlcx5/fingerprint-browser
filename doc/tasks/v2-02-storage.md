# V2-02 存储与数据迁移

> 目标：将现有环境记录升级为 V2 店铺、代理绑定和安全状态模型，同时保留既有环境可启动。
> 依赖：V2-01。
> 可写路径：`src/main/db/**`、`doc/tasks/v2-02-storage.md`
> 禁止：修改共享类型、IPC、启动器、界面和依赖文件；需要新契约时回报协调者。

## 任务清单

- [x] T1 为 environments 表增加 `site`、`shop_identifier`、`role_note`、`security_status` 和 `totp_secret_ref` 字段；为 `expected_egress_ip` 建唯一索引，并写可重复执行的 schema migration。
- [x] T2 将代理配置拆分或规范化为 `ProxyBinding` 持久化模型，保存 `networkClass`、出口 IP、国家、验证时间、变更时间和变更原因；认证凭据只保存安全存储引用或密封值。
- [x] T3 更新 DAO 与导入导出转换：旧环境回退到 `site=UNKNOWN`、无安全状态、无绑定出口；导出绝不包含密码、TOTP 引用、Cookie、审计日志或登录态。
- [x] T4 完成目录与删除流程：删除环境、清除本地数据、导入失败回滚时，清理 Profile、下载目录和关联安全存储引用。
- [ ] T5 增加 SQLite 迁移和 DAO 测试，覆盖旧库升级、出口 IP 重复拒绝、空出口开发环境、导入回滚和敏感字段不导出。

## 验收

- 在包含旧 environments 数据的临时数据库上升级后，旧环境可以被读取和启动。
- 两个业务环境写入同一非空 `expectedEgressIp` 时数据库层返回明确冲突。
- 日志、导出 JSON 和 DAO 的公共返回值不包含任何代理密码或 TOTP 密钥。
