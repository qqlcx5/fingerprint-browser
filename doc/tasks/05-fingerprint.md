# 05 指纹两段式

> 依赖：01（生成器部分可独立开发，注入联调依赖 06）
> 产出：`src/main/fingerprint/`
> 完成标准：同环境多次启动核心字段一致；换代理国家仅对齐字段变（验收 3/5）

## 任务清单

- [ ] T1 `fingerprint/generate.ts`：调 fingerprint-generator（按目标国家传 locale），产出 `CoreFingerprint` JSON（UA/平台/GPU/WebGL/屏幕/并发数/内存）
- [ ] T2 `fingerprint/align.ts`：国家 → 时区/语言 映射表（内置常见国家，未覆盖回退 UTC/en-US 并记日志），产出 `AlignFields`
- [ ] T3 核心指纹只读保障：`fingerprint/readonly.ts` 深冻结 + `Readonly` 类型 + DAO 层禁止 update fingerprint 字段的断言（§6.5 代码级约束）
- [ ] T4 `fingerprint/diffCountry.ts`：比较环境当前对齐国家与新代理出口国家，输出 `{changed, from, to}` 供确认流（07）使用
- [ ] T5 `fingerprint/inject.ts`：为 `launchPersistentContext` 注入 fingerprint-injector + 对齐字段 init script（时区/Accept-Language/geo override）
- [ ] T6 `scripts/fp-check.ts`：无头启动同一环境两次，读 UA/屏幕/WebGL/时区打印 diff（验收 3 的自动化脚本）
