# V2-05 轻量浏览器配置与 Profile 隔离

> 目标：保留独立 Profile 与稳定配置，删除超出 V2 范围的反检测/自动化规避行为。
> 依赖：V2-01、V2-02。
> 可写路径：`src/main/fingerprint/**`、`src/main/launcher/**`、`scripts/**`、`doc/tasks/v2-05-browser-profile.md`
> 禁止：修改代理绑定服务、数据库 schema、IPC 和渲染层。

## 任务清单

- [x] T1 审计并移除 Canvas/Audio/WebGL 噪声、`navigator.webdriver` 修改、`--disable-blink-features=AutomationControlled` 与其他自动化特征规避参数。
- [x] T2 将浏览器配置收敛为持久化的 UA、语言、时区、窗口尺寸、分辨率、像素比和可选地理位置；确保重启不重新随机生成。
- [ ] T3 保持每环境独立 persistent Profile 与下载目录；验证 Cookie、LocalStorage、IndexedDB、Service Worker 和下载文件隔离。现有冒烟仅覆盖 Cookie/下载目录，仍需补齐其余存储类型回归。
- [x] T4 按店铺站点与代理出口国家生成/建议语言和时区；国家不一致时只产生警告，不能修改核心配置或阻断启动。
- [ ] T5 更新指纹/隔离回归脚本，覆盖三次重启稳定性、两环境数据隔离、主动清除后登录态消失和无反检测注入。

## 验收

- 启动参数与页面注入脚本中不存在 TLS/JA3、渲染噪声、自动化标记隐藏或行为模拟逻辑。
- 同环境重启三次的轻量配置一致；两个环境的浏览器数据不互见。
- 平台要求重新登录或重新验证时，应用不修改该流程。
