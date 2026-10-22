---
name: chrome-control
description: 通过统一浏览器控制层操作远端现有 Chrome、页面快照、输入、上传下载与截图；避免每次手写 SSH/AppleScript。
---

# Chrome 控制

只用 `browserctl` CLI（`chrome-control` MCP 已于 2026-10-09 移除）。目标：`zengxiaoximac01`（Mac，用户本人的 Chrome）、`zengxiaoxiwin01`（Windows，专用无头 profile，不是机主的 Chrome）。实现与现状在 `/home/dev/workspace/chrome-control/README.md`，实际连接以当前探针为准，不凭安装状态推断在线。

1. `browserctl targets` 核机器；`profiles` 现场读 Chrome 登记账号。多账号优先用 `--account <完整邮箱或私人别名>`，不要让用户描述窗口或凭历史 URL 猜账号。已登记的 Mac `cambridge` 别名包含目标邮箱及 Moodle 预期用户名；具体映射读现场配置，不凭本说明推断。
2. `browserctl --machine <alias> --actor <唯一名字> --account <账号> open <业务URL>` 会在指定 Profile 创建受控标签、返回绑定 pageId 和站内身份。后续每个 `pages`／`identity`／`call`／`download` 都带同一 `--account` 与 actor。用户原有未绑定标签不自动接管；租约过期再显式 claim。仅用最新 snapshot 的 uid，pageId 不是 AppleScript tab ID，不操作 active tab。
3. `download <URL> --out NAME --account <账号>` 在同源绑定标签取 PDF、验证魔数及落盘 SHA256，每份进入浏览器机器独立随机目录，不覆盖旧文件。普通点击下载用 `browser_wait_file` 核实稳定性／无 crdownload。Mac 个人 Chrome 下载不接受隐式默认账号。
4. 页面任务结束释放租约。只关闭你创建的标签，先核对应 URL；不要关闭用户浏览器、改默认下载路径或重启用户 profile。
5. MCP 工具错误和原生连接许可阻塞真实报告。`status` 只验 daemon；原生 Chrome Allow 与 OS Accessibility 不能由遥测开关、root 或 broad task consent 伪造。隔离测试不等于登录态验收。无权限时不反复轮询；仍可做文件层盘点。
6. 不读取 cookie、密码或无关私有页面；网站验证码、二次认证、提交、外发、签署与取消预约仍按各任务授权边界。上游可执行 JS，不把这套工具称恶意客户端安全隔离。

具体工具契约用 `browserctl tools`，不猜参数。范围是已登记的 `zengxiaoximac01`（用户现有 Chrome）和 `zengxiaoxiwin01`（专用 headless profile，不是机主的 Chrome，也不是研究浏览器；路径用 Windows 路径）；新增机器先正常部署并实际验收。
