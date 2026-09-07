# 05 指纹两段式

> 依赖：01（生成器部分可独立开发，注入联调依赖 06）
> 产出：`src/main/fingerprint/`
> 完成标准：同环境多次启动核心字段一致；换代理国家仅对齐字段变（验收 3/5）

## 任务清单

- [x] T1 `fingerprint/generate.ts`：调 fingerprint-generator（按目标国家传 locale），产出 `CoreFingerprint` JSON（UA/平台/GPU/WebGL/屏幕/并发数/内存）
- [x] T2 `fingerprint/align.ts`：国家 → 时区/语言 映射表（内置常见国家，未覆盖回退 UTC/en-US 并记日志），产出 `AlignFields`
- [x] T3 核心指纹只读保障：`fingerprint/readonly.ts` 深冻结 + `Readonly` 类型 + DAO 层禁止 update fingerprint 字段的断言（§6.5 代码级约束）
- [x] T4 `fingerprint/diffCountry.ts`：比较环境当前对齐国家与新代理出口国家，输出 `{changed, from, to}` 供确认流（07）使用
- [x] T5 `fingerprint/inject.ts`：为 `launchPersistentContext` 注入 fingerprint-injector + 对齐字段 init script（时区/Accept-Language/geo override）
- [x] T6 `scripts/fp-check.ts`：无头启动同一环境两次，读 UA/屏幕/WebGL/时区打印 diff（验收 3 的自动化脚本）

## 设计说明

- **模块零 electron 依赖**：fingerprint/ 全部为纯逻辑，可被脚本独立调用（fp-check 已验证）。
- **两段式落地**（§6.5）：
  - 创建（07-T1）：`generateCoreFingerprint(country)` 产核心指纹；`alignFieldsForCountry(country)` 产对齐字段；`freezeCoreFingerprint` 后一并入库
  - 对齐字段跟随代理（07-T2/T3）：`diffAlignCountry(align, newCountry)` 判断是否弹 COUNTRY_CHANGED 确认；accept 后仅更新 `alignFieldsForCountry(newCountry)`
- **注入确定性（验收 3 的关键）**：injector 需要完整指纹（fonts/codecs 等），但 DB 只存 CoreFingerprint（§5 schema）。`inject.ts` 从 CoreFingerprint **确定性重建**完整指纹 + headers，同一环境每次启动注入逐字节一致（fp-check T5 断言已验证）；injector 内部的唯一随机项是 `history.length`（非核心字段）。
- **对齐字段用原生选项而非 init script**：时区（`timezoneId`）、Accept-Language（`locale` + injector headers）、geo（`geolocation` + 预授权）走 Playwright 上下文选项（CDP 级，先于页面 JS）；init script 只负责核心指纹覆盖（fingerprint-injector）。比 JS 层覆盖更稳。
- **`--disable-blink-features=AutomationControlled`**：含在 launch 选项里，否则 Playwright 下 `navigator.webdriver === true` 直接穿帮。
- **mockWebRTC = true**：防止 WebRTC 泄露代理之外的真实 IP。
- **locale 一致性**（§6.5 第 3 条）：generator 以 `localeForCountry(country)` 为入参，UA 平台/语言/屏幕与目标地区匹配（fp-check DE 用例：Windows UA + Win32 + de-DE）。

## 集成点（并行窗口注意事项）

- **接线：无**。模块 05 没有 IPC 通道（`alignConfirm` 由 07 实现），集成阶段**不需要**在 index.ts 接线。
- **02-storage**：`updateEnv()` 入口调 `assertNoProtectedUpdate(patch)`；行 JSON → `Env` 出口调 `freezeCoreFingerprint()`。不接不报错，但只读约束失效。
- **06-launcher（T2）**：`launchPersistentContext(userDataDir, { ...buildFingerprintLaunchOptions(core, align), proxy, executablePath, ... })`；context 创建后、开页前 `await injectFingerprint(context, core)`。
- **07-env-manager（T1/T2/T3）**：创建 = `generateCoreFingerprint` + `alignFieldsForCountry` + freeze 入库；启动前 = `diffAlignCountry` → changed 时抛 `fail('COUNTRY_CHANGED', ...)`；确认 = `alignConfirm` 中按 `alignFieldsForCountry(to)` 更新（核心指纹不动）。
- **日志**：align/generate 的回退告警暂用 `console.warn`（带 `[fingerprint:*]` 前缀），集成阶段统一换 02-T6 滚动日志器。

## 验证记录（2026-09-07）

- `pnpm typecheck:node` → fingerprint/ 目录 0 错误（kernel/ 的报错属 03 窗口半成品，与本模块无关）
- `scripts/fp-check.ts` 离线自检（`FP_CHECK_OFFLINE=1`）**21/21 PASS**，覆盖：
  - T1 生成：UA/平台/屏幕/WebGL/并发/内存合法性；两次调用随机性；country=DE → Windows UA + Win32 + de-DE locale 一致
  - T2 对齐：表内国家时区/语言正确；未知国家（ZZ）回退 UTC/en-US 并告警
  - T3 只读：深冻结生效（strict 改写抛 TypeError）；DAO patch 带 fingerprint 被断言拦截、不带放行
  - T4 差异：US→DE 变更 / DE→DE 不变 / null→US 变更 / 测连无国家不触发 / 对齐字段反查国家
  - T5 注入确定性：同核心指纹重建注入指纹逐字节一致（2469B）；启动选项含时区/UA/viewport
- 浏览器端到端（验收 3）**PASS**（2026-09-07，Chromium Headless Shell 153.0.8010.12，`playwright-core install chromium` 下载至用户缓存，未动项目依赖）：
  - DE 用例：两次启动 UA/平台/并发数/屏幕/WebGL/时区/语言完全一致，且与持久化核心指纹逐字段一致（UA Chrome/146 + Europe/Berlin + de-DE）
  - US 用例：同上（Windows UA + Win32 + 1536x864@1.25 + Intel HD 620 + America/New_York + en-US）
  - 注入生效证据：未注入时 UA 为 HeadlessChrome/153，注入后变为核心指纹的 Chrome/146
  - 已知边界：Headless Shell 153 已移除 `navigator.deviceMemory` API（`in navigator === false`），读出 null——非注入缺陷，站点统一读不到，两次启动一致；正式内核若保留该 API，injector 会覆盖为核心指纹值
  - fp-check 修复：Playwright ≥1.4x 对字符串只做表达式求值，evaluate 必须传真实函数引用（原字符串箭头函数返回函数对象序列化为 undefined）
- `pnpm exec eslint src/main/fingerprint` → 0 错误；`prettier --check` → 全部合规（scripts/ 在 eslint ignore 列表，属 01 配置）
- 追加用例：`FP_CHECK_COUNTRY=JP` → ja-JP + Asia/Tokyo 对齐链路 PASS

## 复验记录（2026-09-07，同日复核）

- 复跑全套验证：离线自检 21/21 PASS；`pnpm typecheck:node` 0 错误；eslint 0 错误
- 修复 `scripts/fp-check.ts` 的 prettier 格式（此前仓库级 `prettier --check .` 对该文件告警；修复后 src/main/fingerprint + scripts/fp-check.ts 全部合规。仓库级告警仅剩各窗口的 md 文档，非本模块范围）
- 浏览器端到端复跑 US/DE 双用例 PASS：同环境两次启动 UA/平台/并发/屏幕/WebGL/时区/语言全字段一致，且与持久化核心指纹逐字段一致；DE 用例 locale 一致性成立（de-DE + Europe/Berlin）
- 澄清（避免复验困惑）：核心指纹的 UA 大版本/平台/硬件参数在**生成时**随机抽取，生成后随环境冻结不变——不同批次生成可能得到 Chrome/146 或 /147、Windows 或 macOS 平台；验收 3 判定的是"同环境多次启动核心字段一致"，与具体固定值无关
