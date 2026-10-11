---
name: chrome-control
description: 通过统一浏览器控制层操作远端现有 Chrome、页面快照、输入、上传下载与截图；避免每次手写 SSH/AppleScript。
---

# Chrome 控制

只用 `browserctl` CLI（`chrome-control` MCP 已于 2026-10-09 移除）。目标：`zengxiaoximac01`（Mac，用户本人的 Chrome）、`zengxiaoxiwin01`（Windows，专用无头 profile，不是机主的 Chrome）。实现与现状在 `/home/dev/workspace/chrome-control/README.md`，实际连接以当前探针为准，不凭安装状态推断在线。

1. `browserctl targets` 核目标；`browserctl --machine <alias> --actor <你的唯一名字> pages` 实际连接并列出官方 pageId。
2. 仅选用户授权的业务标签，先 `call browser_claim_page '{"pageId":N}'`，再 `take_snapshot`，用最新 uid 调官方输入/上传工具。每一步显式 pageId，不操作 active tab。不共用其他队员 actor，pageId 不等于 AppleScript tab ID。
3. 上传、截图及文件输出路径位于浏览器所在机器。下载沿浏览器正常行为；用 `browser_wait_file` 对真实落盘文件验大小、无相应 crdownload、稳定性、SHA256。不要把网络响应或点击成功当作落盘完成。
4. 页面任务结束释放租约。只关闭你创建的标签，先核对应 URL；不要关闭用户浏览器、改默认下载路径或重启用户 profile。
5. MCP 工具错误和原生连接许可阻塞真实报告。`status` 只验 daemon；原生 Chrome Allow 与 OS Accessibility 不能由遥测开关、root 或 broad task consent 伪造。隔离测试不等于登录态验收。无权限时不反复轮询；仍可做文件层盘点。
6. 不读取 cookie、密码或无关私有页面；网站验证码、二次认证、提交、外发、签署与取消预约仍按各任务授权边界。上游可执行 JS，不把这套工具称恶意客户端安全隔离。

具体工具契约用 `browserctl tools`，不猜参数。范围是已登记的 `zengxiaoximac01`（用户现有 Chrome）和 `zengxiaoxiwin01`（专用 headless profile，不是机主的 Chrome，也不是研究浏览器；路径用 Windows 路径）；新增机器先正常部署并实际验收。
