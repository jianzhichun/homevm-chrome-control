# Chrome 统一控制层

状态：统一入口和 Mac 部署完成；Mac 现有 Chrome 的 CDP 首次授权尚未完成，不能称全自动化已上线。隔离浏览器操作验收与 Mac SSH/MCP 验收分开记录。

## 架构

`browserctl / MCP → 已认证 SSH stdio → Mac 用户私有 Unix socket → 官方 Chrome DevTools MCP 1.10.1 daemon → 当前 Chrome profile`

- 浏览器引擎直接复用 Google 的开源 Chrome DevTools MCP（Apache-2.0）；SDK 1.32.1。包版本和 npm lockfile 固定，不运行安装脚本。
- 31 个官方工具原样转发，增加 5 个状态、标签占用和文件校验工具。所有页面级操作必须传官方 `pageId`，先取得当前 actor 的 15 分钟租约；不是 AppleScript 的 tab ID。
- 官方 daemon 内部串行工具调用；不同 agent 的租约阻止互相误操作标签。租约是防误用措施，不是恶意客户端安全隔离，绕过入口直接调上游不受租约保护。
- 主机只经 SSH 认证，不转发、公开 CDP 端口。Chrome 官方调试开关只监听 Mac 回环地址，并仍要求原生 Allow。HTTP `/json/version` 在这个 approval-only 模式返回 404，不应用它判断服务坏了。
- 使用已有登录态，不提取 cookie 或复制用户配置；遥测、CrUX、自动版本查询关闭，网络敏感头过滤开启。上游有广泛浏览器权限，允许脚本执行，不保证抵御恶意脚本读取页面隐私；只操作本任务获授权页面。
- Mac 文件读写范围为项目目录、Downloads、已有 Cambridge MPhil 知识库。路径先规范化，防止符号链接逃逸。其他项目需显式扩展配置根。

## 使用

```sh
browserctl targets
browserctl --machine zengxiaoximac01 status
browserctl --machine zengxiaoximac01 --actor cambridge-team pages
browserctl --actor cambridge-team call browser_claim_page '{"pageId":1}'
browserctl --actor cambridge-team call take_snapshot '{"pageId":1}'
browserctl --actor cambridge-team call click '{"pageId":1,"uid":"1_3"}'
browserctl --actor cambridge-team call upload_file '{"pageId":1,"uid":"1_8","filePaths":["/Users/brook/workspace/chrome-control/example.txt"]}'
browserctl --actor cambridge-team call browser_wait_file '{"path":"/Users/brook/Downloads/example.pdf","timeoutMs":15000}'
browserctl --actor cambridge-team call browser_release_page '{"pageId":1}'
browserctl tools
browserctl mcp
```

UID 必须来自最新快照；页面 ID 必须来自 `pages`。文件路径是浏览器所在 Mac 的路径，不是 homevm 路径。跨 CLI 命令明确传同一个 actor；不要共用其他队员的 actor。

全局 Claude Code MCP 名为 `chrome-control`，通过官方 `mcp add --scope user` 注册；新会话自动可见，已有会话需在正常 MCP 管理界面重连或重新启动。CLI 在当前会话立即可用。不修改 assistant 的权限规则。

`status` 只验 daemon，不证明已连接浏览器；`pages` 才真正连接。当前 Mac 首次连接在原生 Allow 弹窗处超时（osascript 无辅助功能权限）。需要在 Mac 正常确认；不改 TCC 数据库、不伪造批准、不重启 Chrome。连接保存在同一个官方 daemon 里；Chrome 或 daemon 断开后可能再次要求 Allow。工具请求 30 秒、外层命令 50 秒超时，不自动重发有副作用的操作。

## 下载与能力边界

DOM、iframe 快照、真实鼠标键盘输入、网页文件上传、页面截图、网页 JS 对话框都有官方工具。工具目录来自官方 MCP `tools/list`，不从帮助文字猜 schema。

上游没有专用下载管理工具，因此正常点击触发下载，再由 Mac 文件层验证非空文件、无相应 `.crdownload`、大小稳定及 SHA256。返回明确标注“文件系统稳定证据”，不是宣称收到了浏览器完成事件。未改全浏览器下载行为，不干扰用户已有下载。操作系统弹窗、地址栏等不属于页面 CDP 完整能力；当前没有已经授权的系统 GUI 控制链。

微软官方 Playwright Extension 0.4.0＋token 是免逐次连接审批的备选，但该 Mac 本轮动态强制策略安装没有生效。系统 API `CFPreferencesAppValueIsForced` 返回 false，Chrome 策略页 Not set，因此已撤回试写的扩展策略。没有宣称扩展安装成功。若后续正常安装配对，它默认接管新建受控标签，不等于自动接管全部既有标签。未安装额外浏览器、未迁移 cookie。

## 部署与运行

代码：homevm `workspace/chrome-control`；Mac `/Users/brook/workspace/chrome-control`。入口 `~/bin/browserctl` 链接至版本化项目脚本；目标登记在 `config/targets.json`，当前仅验收该 Mac。

运行 `./apply.sh zengxiaoximac01` 增量部署，不覆盖 node_modules、日志及证据，不删除远端文件。Mac LaunchAgent `cn.imbecile.chrome-control` 在用户登录时启动官方持久 daemon；bootstrap 脚本运行后退出，所以 launchctl 的 `not running` 是引导进程状态，不代表 daemon 停止。没有空转浏览器轮询；daemon 死亡后明确 `browserctl start`，不承诺自动重连授权。

删除部署先在 Mac 正常 `launchctl bootout gui/501/cn.imbecile.chrome-control`，再 `browserctl stop`，最后删除仅本项目的 LaunchAgent、CLI 链接和 MCP 登记。不要关闭用户 Chrome 或删除用户 profile。

## 验证

```sh
npm test
node scripts/acceptance.mjs       # homevm 独立、无现有登录态的 headless Chrome
node scripts/probe-mcp.mjs        # Mac SSH/MCP，不要求连接用户浏览器
```

证据：`evidence/isolated-acceptance.json`、`evidence/mac-mcp.json`、`evidence/acceptance-report.json`。隔离验收涵盖可信输入、iframe、上传、截图、实际下载后 hash 和清理；不能替代 Mac 现有 profile 的许可验收。网页权限、网站的验证码/二次认证、外发与签署授权仍遵循正常边界。

## 上游

- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md
- https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/devtools_connection_dialog.cc
- https://github.com/microsoft/playwright/blob/main/packages/extension/README.md

## Windows

`zengxiaoxiwin01` 是物理机（不在 winfleet VM 池）。winfleet (winmcp) 已有 Click／Type／Screenshot 等原生 Windows GUI 工具，但尚未装 Chrome DevTools 扩展。

适配路径：
1. Daemon 层：Win32 持久进程 + `autoConnect`，复用 `browserctl` 现有模式开关。
2. 授权：windows-mcp 坐标点击可点 Chrome Allow 确认，与 Mac 需要用户手动操作桌面不同。
3. hubctl 感知：新增 `zengxiaoxiwin01` 的 browser target 条目，与 Mac 同 `targets.json` 格式。

待 zengxiaoxiwin01 能正常 SSH 连上后实施。不在此次验收范围内。
