# 第三方开源许可汇总（Third-Party Licenses）

> 本文件为随包分发的人工汇总版。发布前需重新生成完整的传递依赖许可清单并随包分发：
>
> ```bash
> pnpm exec electron-builder --licenses > build/THIRD-PARTY-LICENSES.txt
> ```
>
> 生成后检查文件非空且覆盖 dependencies 全部直接依赖（§7：分发保留各开源组件版权声明）。

本软件（Fingerprint Browser）使用了以下开源组件，感谢原作者社区：

| 组件 | 用途 | 许可证 | 版权归属 |
|---|---|---|---|
| Electron | 应用壳 | MIT | GitHub Inc. 及 Electron 贡献者 |
| Chromium | 浏览器内核（经 Playwright 分发） | BSD-3-Clause | The Chromium Authors |
| playwright-core | 内核下载与启动层 | Apache-2.0 | Microsoft Corporation |
| fingerprint-generator | 核心指纹生成 | MIT | Apify Technologies |
| fingerprint-injector | 指纹注入 | Apache-2.0 | Apify Technologies |
| better-sqlite3 | 本地存储（SQLite 绑定） | MIT | Joshua Wise 及贡献者 |
| SQLite | 嵌入式数据库引擎 | Public Domain | D. Richard Hipp |
| electron-vite / Vue 3 | 构建脚手架与界面框架 | MIT | 相应社区作者 |
| electron-builder / electron-updater | 打包与自动更新 | MIT | JetBrains s.r.o.（electron-builder 维护方） |

各组件均按其原始许可证条款使用与再分发。上述许可证全文以重新生成的
`THIRD-PARTY-LICENSES.txt` 为准；本表仅作快速索引，若两者不一致，以全文为准。

明确不使用（需求文档 §3）：CloakBrowser（二进制禁止再分发）、VirtualBrowser（内核授权不明）。
