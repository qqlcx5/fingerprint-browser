# 多 Agent 并行执行计划

> 前提：任务拆分见本目录 01–09。本文件定义哪些能并行、怎么隔离、谁改哪些文件。
> 核心原则：**接口未冻结不并行；一个 agent 一个 worktree 一个分支；共享文件只读**。

## 1. 阶段划分（串行起点 → 并行 → 收敛）

### 阶段 0：合同冻结（1 个 agent，串行，约半天）
执行 01-scaffold 全部 6 个任务，**额外**：
- [ ] 一次性把后续所有依赖加进 package.json（better-sqlite3 等），此后 package.json 冻结
- [ ] `src/shared/types.ts`：核对包含全部跨模块类型（Env / ProxyConfig / EgressInfo / CoreFingerprint / AlignFields / AppError / 通道名常量）
- [ ] `src/shared/paths.ts` 占位提交（02 会实现，签名先定）
- [ ] `src/main/ipc.ts` 定死注册约定：每模块导出 `registerIpc()`，ipc.ts 由协调者统一接线，各轨不碰此文件

完成后 merge 到 main。**此点是唯一的串行瓶颈，其他 agent 等这里。**

### 阶段 1：四轨并行（4 个 agent，约 1 天）

| Agent | Worktree / 分支 | 任务 | 允许改动 |
|---|---|---|---|
| A | `../fb-storage` @ `feat/storage` | 02-storage 全部 | `src/main/db/`、`doc/tasks/02-storage.md` |
| B | `../fb-kernel` @ `feat/kernel` | 03-kernel 全部 | `src/main/kernel/`、`doc/tasks/03-kernel.md` |
| C | `../fb-proxy` @ `feat/proxy` | 04-proxy 全部 | `src/main/proxy/`、`doc/tasks/04-proxy.md` |
| D | `../fb-fp` @ `feat/fingerprint` | 05-fingerprint 全部（T5 注入器先写成纯函数 + 单测，不接 06） | `src/main/fingerprint/`、`scripts/`、`doc/tasks/05-fingerprint.md` |

### 阶段 2：两轨并行（merge 完阶段 1 后）

| Agent | 分支 | 任务 |
|---|---|---|
| A（或新） | `feat/launcher` | 06-launcher 全部（此时 02–05 已在 main，真依赖就位） |
| B（或新） | `feat/packaging` | 09-packaging T1–T3（只依赖 01+02+03） |

### 阶段 3：编排与界面（2 个 agent）

| Agent | 分支 | 任务 |
|---|---|---|
| A | `feat/env-manager` | 07-env-manager 全部 |
| B | `feat/ui` | 08-ui 全部（此时用真 api 联调，不再 mock） |

### 阶段 4：集成验收（1 个 agent）
- [ ] 09-packaging T4–T5：开源声明 + 执行验收 1–9 全量回归
- [ ] 缺陷按模块分回各轨修复

## 2. Worktree 操作命令（协调者执行）

```bash
# 阶段 0 完成并 merge 后：
git worktree add ../fb-storage -b feat/storage
git worktree add ../fb-kernel  -b feat/kernel
git worktree add ../fb-proxy   -b feat/proxy
git worktree add ../fb-fp      -b feat/fingerprint
# 每个 worktree 内各自 pnpm install（node_modules 不共享）
```

## 3. 冲突规避规则（发给每个 agent 的硬约束）

1. **只动白名单目录**：见阶段 1 表格第 4 列；动了别人的目录 = 返工
2. **共享文件只读**：`src/shared/types.ts`、`src/shared/paths.ts`、`package.json`、`src/preload/`、`src/main/ipc.ts`、`doc/tasks/progress.md`。需要改 → 停下来报协调者，串行改完广播
3. **progress.md 只有协调者更新**；agent 只勾自己模块 md 的子任务
4. **merge 串行**：完成一个 merge 一个（建议序 02→03→04→05），落后分支先 `git rebase main` 再继续；types 冲突由协调者裁决，不允许 agent 自行改共享类型
5. **完成标准不变**：每个任务 = 实现过 `pnpm typecheck` + 模块自测通过才可勾选

## 4. 给单个 agent 的启动提示词模板

```
你在 worktree <路径>，分支 <分支名>。
1. 读 doc/tasks/<module>.md 和 doc/tasks/parallel-plan.md 第 3 节
2. 只允许改动白名单目录
3. 按 T1→Tn 顺序执行，每个子任务完成即打勾并自测
4. 需要改共享文件时停下，输出"需要协调：<改动内容>"
```
