# 07 业务编排（环境管理 IPC）

> 依赖：02 04 05 06
> 产出：`src/main/envManager/`
> 完成标准：需求文档 §4 IPC 契约表全部通道可用；验收 3/4/5 全链路走通

## 任务清单

- [ ] T1 `env:create`：校验名称 → 生成核心指纹 + 对齐字段（§6.5 两段式）→ 落库 → 建目录 → 返回 `Env`。出口国家来源：有代理先 `proxy:test` 取 country 作为指纹生成输入；无代理用直连基准（系统 locale/时区）；代理测试失败允许保存、以直连基准生成并记日志
- [ ] T2 `env:update`：改名称/备注/代理；代理变更时经 `proxy:test` 取新出口国家 → 国家变化返回 `NEEDS_CONFIRM` 标记（不自动改对齐字段）；`align:confirm`（T3）已入冻结契约但为需求文档 §4 之外的新增通道，需回写需求文档
- [ ] T3 确认流接口 `align:confirm`：渲染层确认后仅更新对齐字段（核心指纹只读，T-05/03 约束兜底）；取消则保留旧对齐字段
- [ ] T4 `env:start / env:stop`：调 launcher（内核 ensure → 启动流水线），错误码原样透传给渲染层；env:start 成功后更新 last_launched_at
- [ ] T5 `env:delete`：运行中拒绝（`code=ENV_RUNNING`）；否则 DB 记录 + 两目录全删（§6.1 二次确认由界面做）
- [ ] T6 `env:list`：DB 记录 join 内存运行状态，输出列表模型（名称/代理摘要/状态/最后启动时间）
- [ ] T7 IPC `env:status`：返回 `Record<id, EnvStatus>`（§4 契约通道，常量已在冻结 types.ts，此处补实现；UI 首屏状态来源）
- [ ] T8 IPC `app:wipeData`：关停全部运行环境 → 删除 userData 下环境数据目录与数据库（二次确认由 UI 做，§8"彻底清除数据"）；通道常量尚未入冻结 types.ts，需协调者补充
