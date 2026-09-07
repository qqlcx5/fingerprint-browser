# 09 打包与分发

> 依赖：01 02 03（可提前到 03 完成后跑通流水线，不必等全部功能）
> 产出：`electron-builder.yml`、`build/` 资源、发布流程
> 完成标准：验收 8/9；卸载保留 userData（§8）

## 任务清单

- [ ] T1 electron-builder 基础配置：appId/产品名/图标/版本、asar、原生模块（better-sqlite3）打包验证
- [ ] T2 Windows x64：nsis 安装/启动/卸载全流程验证；卸载后 userData 保留；提供"彻底清除数据"入口（§8）
- [ ] T3 macOS arm64：dmg 验证；签名/公证占位（无证书时记录 TODO）
- [ ] T4 合规物料：安装协议文案（用途限制，禁"防封号"表述，§1）+ 开源许可汇总页（electron-builder licenses）
- [ ] T5 发布冒烟清单：执行验收 1–9 全量回归并记录到本文档附录
