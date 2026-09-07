# 需求↔任务追溯矩阵（对抗式审查产物）

> 生成：2026-09-07 对抗式审查；2026-09-08 按 `需求文档.md` v1.2、实际 IPC 和验收结果回写。
> 用法：每个需求条款 → 唯一认领任务。任务完成后在此回查，验收前按本矩阵逐行打勾，防止漏项。
> 结论：P0 代码已覆盖；真实验收以 `09-packaging.md` 附录 A 为准。P1/P2 登记于 progress.md「P1/P2 待办」，暂不作为当前发布阻塞。

## 显式契约决策记录（偏离/澄清需求文档处，验收时按此口径）

1. **EgressInfo 形状**：需求 §4 写 `{ok, ip?, country?, latencyMs?, code?}`（允许部分成功）；实现收敛为 Result 信封 + 三字段全必填（all-or-nothing：任一查询失败即整体失败）。语义更严格，04 实现按此口径。
2. **国家变更检测时机**：需求 §6.5 未明确在"改代理时"还是"启动时"弹窗（2026-09-07 决策）：收敛到 env:start——启动前本就强制 proxy:test，避免编辑时重复测代理；`envStart → CountryChangeInfo|null` + `align:confirm` 端到端承载。
3. **wipeData 语义**：清环境数据（db + envs/），内核与日志保留（避免用户误操作后重下 300MB 内核）。
4. **align:confirm / app:ping / app:notices / app:wipeData / env:crashed** 为需求 §4 之外的实现增量，已回写至需求文档 v1.2。`env:crashed` 仅可靠报告页面 `crash` 与启动期 context 异常关闭，exitCode 为 null；运行中整个 Chromium 进程退出仍按用户关窗语义处理。

## §4 IPC 契约（invoke + event）

| 通道 | 类型 | 认领任务 | 备注 |
|---|---|---|---|
| app:ping | invoke | 01-T5 ✅ | 冒烟已通过 |
| env:list | invoke | 07-T6 | |
| env:create | invoke | 07-T1 | 出口国家来源已补（审查补） |
| env:update | invoke | 07-T2 | |
| env:delete | invoke | 07-T5 | |
| env:start | invoke | 07-T4 | 补 last_launched_at 更新（审查补） |
| env:stop | invoke | 07-T4 | |
| env:status | invoke | 07-T7（审查补） | 模块文档原漏认领；常量已冻结于 types.ts |
| proxy:test | invoke | 04-T4 | |
| browser:ensure | invoke | 03-T5 | |
| align:confirm | invoke | 07-T3 | 契约外新增，已入冻结 types.ts，需回写需求文档 §4 |
| app:notices | invoke | 07-T9（审查补·二次） | 拉取式启动通知：db_reset / weak_encryption（产生早于渲染层订阅，事件会丢故用拉取） |
| app:wipeData | invoke | 07-T8（审查补） | 已入冻结 types.ts（2026-09-07 契约增量） |
| env:status-changed | event | 06-T1 | |
| env:crashed | event | 06-T6（审查补·二次） | 页面 crash / 启动期 context 异常关闭；`CrashedInfo{envId, exitCode:null}` |
| browser:download-progress | event | 03-T4 | |

## §5 数据模型与存储

| 条款 | 认领任务 |
|---|---|
| environments 表字段与索引 | 02-T2 |
| 运行状态不入库、启动置 idle | 06-T1 |
| data/envs.db | 02-T1/T2 |
| envs/{id}/profile + envs/{id}/downloads | 02-T1/T5；下载目录落地 06-T2（Playwright `downloadsPath`） |
| chromium/{revision}，revision 来源 browsers.json | 02-T1；03-T1（审查补） |
| logs/ 滚动 5MB×5 | 02-T6（审查补） |
| 代理密码 safeStorage 加密、weak 降级 | 02-T4；降级提示 08-T4 |
| 跨模块类型（含 EgressInfo） | 01-T2 ✅ 已冻结于 types.ts，审查确认覆盖 |

## §6 功能需求（P0）

| 条款 | 认领任务 |
|---|---|
| 6.1 环境管理 CRUD + 删除二次确认 | 07-T1/T2/T5；08-T5 |
| 6.2 内核管理（检测/进度/体积提示/断点续传/磁盘 2GB/损坏重下） | 03-T1~T5；08-T6 |
| 6.3 环境隔离（userDataDir + 下载目录） | 02-T5；06-T2 |
| 6.4 代理配置、四类错误区分、直连标注 | 04-T1~T5；直连标注 08-T2（审查补） |
| 6.5 指纹两段式（生成/只读/对齐跟随/变更确认/locale 一致性） | 05-T1~T4；创建时国家来源 07-T1（审查补）；确认流 07-T3；弹窗 08-T7 |
| 6.6 生命周期（流水线/关窗即停/退出逐个停止/孤儿清理/pipe 通信） | 06-T2/T3/T4/T5；应用退出钩子 06-T7（审查补） |
| 6.7 ≥10 并行 + 状态事件推送（非轮询） | 06-T1/T2；08-T2；量化回归 09-T5 |

## §7 非功能

| 条款 | 认领任务 |
|---|---|
| Windows x64 优先 / macOS arm64 次之 | 09-T2/T3 |
| Linux 兼容 | 09 注记：保留 linux target，不在 M3 验收（审查补） |
| 启动 ≤5s、10 并行整机 ≤6GB、30 分钟稳定 | 09-T5 量化记录（审查补） |
| 数据仅本地、合规分发 | 09-T4 |

## §8 安全决策

| 条款 | 认领任务 |
|---|---|
| safeStorage 加密 + 降级明确提示 | 02-T4；提示 08-T4（审查补） |
| contextIsolation + 白名单 API | 01-T4 ✅ |
| 主界面不加载远程页面 | 08-T1 注记（审查补） |
| 卸载保留 userData | 09-T2 |
| 彻底清除数据入口 | 07-T8 + 08-T10（审查补，原仅 09-T2 一句、归属错位） |

## §9 错误矩阵（7 行）

| 场景 | 主进程侧 | 界面侧 |
|---|---|---|
| 代理认证失败 | 04-T3、06-T2 阻止启动 | 08-T4 |
| 代理超时 / DNS 失败 | 04-T3 | 08-T4 |
| 内核缺失/损坏 | 03-T1/T3/T5 | 08-T6/T8 |
| 磁盘空间不足 | 03-T2/T5 | 08-T6 |
| SQLite 损坏 → 备份重建 | 02-T2 | 08-T8（经 app:notices 拉取） |
| Chromium 崩溃 → idle 回滚+日志 | 06-T6（env:crashed 事件） | 08-T9 |
| 异常退出孤儿清理 | 06-T5 | 无需用户干预 |

## §12 验收标准 1–9

| 验收 | 锚点任务 |
|---|---|
| 1 三环境不同代理并行不串号 | 04/06/07/08，回归 09-T5 |
| 2 重启保留登录态 | 02-T5、06-T2 |
| 3 同环境指纹两次启动一致 | 05-T6 自动化脚本 |
| 4 认证失败阻止启动 | 04-T3、06-T2 |
| 5 换国仅对齐字段变 | 05-T4、07-T3、08-T7 |
| 6 关窗口状态回 idle | 06-T4 |
| 7 10 并行 30 分钟 | 09-T5 |
| 8 安装包全流程 | 09-T2/T3 |
| 9 断网首启下载可重试 | 03-T3/T5、08-T6 |
