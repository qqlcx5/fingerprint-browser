# 09 打包与分发

> 依赖：01 02 03（可提前到 03 完成后跑通流水线，不必等全部功能）
> 产出：`electron-builder.yml`、`build/` 资源、发布流程
> 完成标准：验收 8/9；卸载保留 userData（§8）

## 任务清单

- [x] T1 electron-builder 基础配置：appId/产品名/图标/版本、asar、原生模块（better-sqlite3）打包验证 —— macOS `--dir` 包与包内 E2E 已通过（2026-09-08）
- [ ] T2 Windows x64：nsis 安装/启动/卸载全流程验证；卸载后 userData 保留；提供"彻底清除数据"入口（§8）—— **NSIS 配置已完成**（向导式 + license 页 + `deleteAppDataOnUninstall: false`），装机验证待阶段 4；"彻底清除数据"入口由 08-ui T10 承载
- [x] T3 macOS arm64：dmg 验证；签名/公证占位（无证书时记录 TODO）—— DMG 已生成、挂载、DMG 内 app E2E PASS（2026-09-08）；`identity: null` / `notarize: false` 的正式分发 TODO 已记录
- [x] T4 合规物料：安装协议文案（用途限制，禁"防封号"表述，§1）+ 开源许可汇总页（electron-builder licenses）+ 用户文档（§10 已知边界四条、内核升级后旧环境 UA 与新内核不一致窗口的说明义务）
- [ ] T5 发布冒烟清单：执行验收 1–9 全量回归并记录到本文档附录；量化记录性能锚点——单环境启动 ≤5s（不含代理测试）、10 并行 30 分钟整机内存 ≤6GB 无崩溃（§7/验收 7）；内核升级流程文档化（升级 playwright-core → fp-check 回归，§3）—— **清单与流程已写入下方附录**，执行待阶段 4

## 实现说明（2026-09-07，配置与物料层）

| 文件                              | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron-builder.yml`            | appId `com.fingerprint-browser.app`（与主进程 `setAppUserModelId` 一致）；productName `Fingerprint Browser`；asar 开启 + `resources/**` 解包；win nsis 向导式（license 页 = `build/license.txt`、可改安装目录、`deleteAppDataOnUninstall: false` 保留 userData）；mac dmg（`identity: null` 时跳过签名、`notarize: false`、category、entitlements 沿用 `build/entitlements.mac.plist`）；linux 保留 target（不在 M3 验收范围）；`npmRebuild: false`（postinstall 已按 Electron ABI 重编，包内用 `scripts/check-native.cjs` 验证）；publish 为 generic 占位（P2 自动更新）；Win/Mac 代码签名均留 TODO 注释 |
| `build/license.txt`               | 安装协议（NSIS 许可页展示）：用途限制（合法多账号运营）、明确"不提供也不承诺防封号/绕过风控"、隐私（数据仅本地）、开源许可指引、免责声明                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `build/third-party-licenses.md`   | §3 组件许可索引表（Electron/Chromium/playwright-core/指纹双件套/better-sqlite3 等）+ 发布前用 `electron-builder --licenses` 重新生成完整清单的说明                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resources/docs/user-guide.zh.md` | 随包用户文档：快速上手、两段式指纹、数据与隐私（路径表/卸载保留/清除入口/safeStorage 降级）、内核升级 UA 滞后窗口说明义务、§10 四条已知边界、故障排查表                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 决策记录

1. **productName 与 userData 路径**：打包后 `app.getName()` 取 productName（`Fingerprint Browser`），与开发态（`fingerprint-browser`）目录分离，属预期隔离；`dev-app-update.yml` 的 updaterCacheDirName 不受影响。
2. **安装协议进安装器而非仅文档**：§1 要求"安装协议注明用途限制"，NSIS license 页是装机唯一强制展示点；mac 无对应机制，靠随包文档 + 应用内首启提示（08-ui 范畴）补齐。
3. **无证书仅作受控内测**：Win 与 Mac 均不签名；Mac 的 `identity: null` 会使 electron-builder 跳过签名，受控机器可手动放行，外部分发前必须补 Developer ID 签名与公证——补法已写入 yml 注释。

## 验证记录

### macOS 包内验证（2026-09-08）

- `pnpm build && pnpm exec electron-builder --dir --mac --config electron-builder.yml` ✓
  - 产物：`dist/mac-arm64/Fingerprint Browser.app`（约 299MB）
- `E2E_SMOKE=1 "dist/mac-arm64/Fingerprint Browser.app/Contents/MacOS/Fingerprint Browser"` ✓
  - `E2E_RESULT PASS`；包内 `sqlite:true`，环境创建 → 列表 → 删除 CRUD 全链路通过
- `pnpm exec electron-builder --mac --config electron-builder.yml` ✓
  - 产物：`dist/fingerprint-browser-1.0.0.dmg`（120MB）及 `.blockmap`
- DMG 只读挂载后，从挂载卷内运行 `E2E_SMOKE=1 "Fingerprint Browser.app/..."` → `E2E_RESULT PASS` ✓
- 预期项：未签名（`identity: null`）且未公证（`notarize: false`）；正式外部分发前仍需补 Apple 签名与公证

### 配置层（2026-09-07，本窗口）

- electron-builder.yml 语法校验通过（YAML parse）
- 与 `src/main/index.ts` 的 AUMID 一致性人工核对：`com.fingerprint-browser.app` ✓
- `build/license.txt`、`build/third-party-licenses.md`、`resources/docs/user-guide.zh.md` 与需求 §1/§3/§7/§8/§10 逐条对照 ✓
- 装机验证类命令（并行规则禁跑 build，**待阶段 4 集成窗口执行**）：

```bash
pnpm build:unpack                              # T1：产物生成 + 原生模块
pnpm exec electron scripts/check-native.cjs    # T1：包外先验 ABI（开发态）
# T1 包内验证：以打包产物启动，看 sqlite ping = true（E2E_SMOKE 亦覆盖）
pnpm build:win && dist/fingerprint-browser-*-setup.exe   # T2：装→启→卸→检查 userData 仍在
pnpm build:mac && hdiutil attach dist/fingerprint-browser-*.dmg          # T3：dmg 挂载启动
```

## 附录 A：发布冒烟清单（T5 模板，执行后在此记录结果）

前置：`pnpm build`（含 typecheck）通过；内核已下载或准备断网场景。

| #   | 验收项（需求 §12）                                | 结果 | 备注                         |
| --- | ------------------------------------------------- | ---- | ---------------------------- |
| 1   | 3 环境 × 不同代理并行：不串号、不掉线             | ☐    | 记录代理类型组合             |
| 2   | 重启应用重开环境：登录态保留                      | ☐    |                              |
| 3   | 同环境两次启动 browserleaks/creepjs：核心指纹一致 | ☐    | UA/屏幕/WebGL/并发数截图存档 |
| 4   | 代理密码错误：阻止启动 + 明确"认证失败"           | ☐    |                              |
| 5   | 换代理国家变化：确认后仅对齐字段变，核心指纹不变  | ☐    |                              |
| 6   | 关某环境窗口：该环境 idle，其他不受影响           | ☐    |                              |
| 7   | 10 环境并行 30 分钟：无崩溃、无串数据、状态实时   | ☐    | 性能锚点见附录 B             |
| 8   | Win/mac 安装→运行→卸载，卸载后登录态保留          | ☐    | Win NSIS + mac dmg           |
| 9   | 断网首启：内核下载明确失败提示，可重试            | ☐    |                              |

### 附录 B：性能锚点（§7，随 T5 实测填数）

| 锚点                                 | 达标线        | 实测    |
| ------------------------------------ | ------------- | ------- |
| 单环境启动（内核就绪，不含代理测试） | ≤ 5s          | ☐ ___s  |
| 10 并行 30 分钟整机内存              | ≤ 6GB，无崩溃 | ☐ ___GB |
| 单环境 Chromium 内存                 | ≤ 500MB       | ☐ ___MB |
| 主进程空闲内存                       | ≤ 200MB       | ☐ ___MB |
| 每环境数据目录                       | 100–300MB     | ☐ ___MB |

### 附录 C：内核升级发布流程（§3 版本锁定策略）

1. 升级 `package.json` 中 `playwright-core` 版本（单一事实源，Chromium revision 与之一一对应）；
2. 按 `scripts/fp-check.ts` 文件头记录的 esbuild 编译命令执行 `FP_CHECK_OFFLINE=1` 离线回归，再执行不带该环境变量的浏览器端完整回归；
3. 跑附录 A 全量（至少 1/2/3/6/7）；
4. 发布说明中必须写明：旧环境 UA 版本号与新内核存在不一致窗口（§10 第 4 条）；
5. 版本号 + tag + 产物归档，更新 `build/third-party-licenses.md` 索引表。
