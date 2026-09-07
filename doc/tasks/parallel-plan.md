# 多窗口并行执行计划（同目录模式）

> 模式：**不开 worktree**。同一个项目目录，开多个终端窗口，每个窗口一个 agent，各做一个模块。
> 核心原则：**白名单写文件；共享文件只读；git 和安装命令只有你自己跑**。

## 1. 窗口分配（阶段 1，现在就可以开）

| 窗口 | 任务 | 只允许写这些路径 |
|---|---|---|
| A | `doc/tasks/02-storage.md` | `src/main/db/**`、`doc/tasks/02-storage.md` |
| B | `doc/tasks/03-kernel.md` | `src/main/kernel/**`、`doc/tasks/03-kernel.md` |
| C | `doc/tasks/04-proxy.md` | `src/main/proxy/**`、`doc/tasks/04-proxy.md` |
| D | `doc/tasks/05-fingerprint.md` | `src/main/fingerprint/**`、`scripts/fp-check.ts`、`doc/tasks/05-fingerprint.md` |

四个目录互不重叠，同时写不会冲突。

## 2. 同目录硬规则（贴给每个窗口）

1. **只写白名单路径**，其他一律只读
2. **禁跑**：`git` 任何命令、`pnpm install`、`pnpm build`、`pnpm dev`、`pnpm exec electron`（这些只有你本人跑；依赖已在阶段 0 冻结，谁都不需要 install）
3. **`pnpm typecheck` 允许跑**，但全仓检查会看到别人模块的半成品报错——**只对自己白名单目录里的报错负责**
4. **不改 `src/main/index.ts`**：模块写好自己的 `registerXxxIpc()` 后，在本模块 md 末尾留一行「接线：index.ts 中调用 `registerXxxIpc()`」，集成阶段统一接
5. **不改 `doc/tasks/progress.md`**（它没有白名单，多窗口同时写必冲突）；只勾自己模块 md 的子任务
6. **不改冻结文件**：`src/shared/types.ts`、`src/shared/paths.ts`、`src/main/ipc.ts`、`src/preload/**`、`package.json`、`pnpm-workspace.yaml`、`eslint.config.mjs`、`electron.vite.config.ts`。要改 → 停下，输出「需要协调：<改动内容>」，由你决定后串行改

## 3. 窗口启动提示词（复制到对应窗口）

```
你在处理任务：doc/tasks/0X-xxx.md（先读它和 doc/tasks/parallel-plan.md 第 2 节）
只允许写：<该窗口白名单>
禁止：git 命令、pnpm install/build/dev、改 src/main/index.ts、改 progress.md、动其他目录
流程：按 T1→Tn 顺序做，每个子任务完成即在 md 打勾；pnpm typecheck 只修自己目录的报错
需要改共享文件时停下，输出：需要协调：<内容>
```

## 4. 冲突热点（谁的手都不许碰）

| 文件 | 原因 | 归谁 |
|---|---|---|
| `src/main/index.ts` | 4 个窗口都要接线和它冲突 | 集成阶段由你开一个窗口统一接 |
| `doc/tasks/progress.md` | 多窗口同时改必互相覆盖 | 只有你更新 |
| `package.json` / `pnpm-lock.yaml` / `node_modules` | 并发安装会写坏 | 依赖已冻结，谁都不动 |
| git 操作（add/commit/checkout） | index 锁 + 半成品入库 | 只有你提交 |

## 5. 集成（阶段 1 四窗口都完成后）

开一个集成窗口，提示词：

```
读 doc/tasks/02~05 四个模块 md 末尾的「接线」说明，
把各模块的 registerXxxIpc() 接入 src/main/index.ts，
然后跑 pnpm typecheck、pnpm build、pnpm exec electron scripts/check-native.cjs、
E2E_SMOKE=1 pnpm exec electron .，
把结果追加到四个模块 md 的验证记录里。不要动其他逻辑。
```

通过后**由你本人** `git add <各模块目录与文档> && git commit`。

## 6. 后续阶段（同模式复用）

| 阶段 | 窗口 | 白名单 |
|---|---|---|
| 2（并行 2 窗） | 06-launcher / 09-packaging | `src/main/launcher/**` ∥ `electron-builder.yml`、`build/**`、`resources/**` |
| 3（并行 2 窗） | 07-env-manager / 08-ui | `src/main/envManager/**` ∥ `src/renderer/src/**`（07 仍不改 index.ts，接线留说明） |
| 4（单窗） | 集成 + 验收 | 全仓；执行 09-packaging T5 冒烟清单，写回 progress.md |

阶段 2/3 的窗口提示词把「02-storage.md」换成对应模块名、白名单换成对应路径即可，其余规则不变。
