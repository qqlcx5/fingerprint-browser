# 07 业务编排（环境管理 IPC）

> 依赖：02 04 05 06
> 产出：`src/main/envManager/`
> 完成标准：需求文档 §4 IPC 契约表全部通道可用；验收 3/4/5 全链路走通

## 任务清单

- [x] T1 `env:create`：校验名称 → 生成核心指纹 + 对齐字段（§6.5 两段式）→ 落库 → 建目录 → 返回 `Env`。出口国家来源：有代理先 `proxy:test` 取 country 作为指纹生成输入；无代理用直连基准（系统 locale/时区）；代理测试失败允许保存、以直连基准生成并记日志
- [x] T2 `env:update`：改名称/备注/代理；**不做**国家变更检测（2026-09-07 决策：检测时机收敛到 env:start——启动前本就强制 proxy:test，且契约 `envStart → CountryChangeInfo|null` 已端到端支持，避免编辑时重复测代理）；`align:confirm` 已入冻结契约但为需求文档 §4 之外的新增通道，需回写需求文档
- [x] T3 确认流接口 `align:confirm`：渲染层确认后仅更新对齐字段（核心指纹只读，T-05/03 约束兜底）；取消则保留旧对齐字段
- [x] T4 `env:start / env:stop`：调 launcher（内核 ensure → 启动流水线），错误码原样透传给渲染层；env:start 成功后更新 last_launched_at
- [x] T5 `env:delete`：运行中拒绝（`code=ENV_RUNNING`）；否则 DB 记录 + 两目录全删（§6.1 二次确认由界面做）
- [x] T6 `env:list`：DB 记录 join 内存运行状态，输出列表模型（名称/代理摘要/状态/最后启动时间）
- [x] T7 IPC `env:status`：返回 `Record<id, EnvStatus>`（§4 契约通道，常量已在冻结 types.ts，此处补实现；UI 首屏状态来源）
- [x] T8 IPC `app:wipeData`：关停全部运行环境 → 删除 db + `envs/` 全部环境数据目录（内核与日志保留，避免重下 300MB；二次确认由 UI 做，§8"彻底清除数据"）；通道已冻结于 types.ts（返回 `{wipedEnvs}`）
- [x] T9 IPC `app:notices`：启动期通知队列——收集 02 的 db_reset / weak_encryption 标记，渲染层挂载后拉取一次、读后清空（拉取而非推送：通知产生于 app ready 时，早于渲染层订阅，事件会丢）

## 验证记录（2026-09-07）

- E2E 冒烟升级为完整 CRUD 链路（临时 userData，不碰真实数据）并 PASS：
  `E2E_CRUD {"created":true,"list1Count":1,"deleted":true,"list2Count":0}` + status/notices 通道正常
- 接线已进 `src/main/index.ts`：registerEnvManagerIpc() + 启动期通知注入（db_reset / weak_encryption）
- 契约回写提醒（T2 遗留）：`align:confirm` 与 `app:wipeData`/`app:notices` 为 §4 之外新增通道，需求文档 IPC 契约表需补
- 确认流语义说明：env:start 用旧对齐字段先启动，align:confirm 更新的是 DB，**下次启动生效**（契约 envStart→CountryChangeInfo|null 决定）
- env:start/stop 真实浏览器链路（验收 1/3/4/5）待内核就绪后覆盖
