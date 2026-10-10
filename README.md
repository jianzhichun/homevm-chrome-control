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

不再注册全局 Claude Code MCP（`chrome-control` 于 2026-10-09 移除：近期会话实际靠 `browserctl call` 即可，MCP 还常连不上）；统一用 `browserctl` CLI，任何会话立即可用。

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
## Windows

`zengxiaoxiwin01` 是物理机（WireGuard 10.9.0.99，用户 `PC`，自动登录；SSH 登录 shell 是 MSYS/Git-Bash）。

### 方案（2026-10-10）

| 问题 | 选择 | 理由 |
| --- | --- | --- |
| 驱动哪个 Chrome | **专用 profile** `%LOCALAPPDATA%\chrome-control\profile`，headless | 机主日常 Chrome 不碰。驱动它要机主在 chrome://inspect 开开关，并在每次 daemon 连接时点 Allow；用 wmcp 代点等于伪造批准，这是用户的决定，不由本层做。研究浏览器 `C:\win01-cdp\cdp-profile` 也不碰、不复用。headless 是为了不在机主桌面上弹窗。 |
| 浏览器引擎 | 同 Mac，官方 chrome-devtools-mcp 1.10.1 的持久 daemon，模式改为启动 Chrome：`--userDataDir … --headless --executablePath …` | 上游自己用 `--remote-debugging-pipe` 启动并持有 Chrome，Chrome 崩了下次调用自动重启；工具目录与 Mac 一致（36 个），不自写 CDP。 |
| 端口 | **不开 TCP 端口，也就无需发布** | Chrome 走 pipe；daemon 走用户命名管道 `\\.\pipe\chrome-devtools-mcp-cc001-PC\server.sock`（上游 Windows 实现）。所以重启后随机的排除端口段与它无关，也不会落进 cdp-serve 的候选端口（9444/8666/9999/7333/8443/8888/9000/9111）被它误认或误杀。 |
| 常驻 | 计划任务 `\chrome-control`：登录触发器、InteractiveToken、LeastPrivilege；动作 `wscript.exe launch.vbs <node> <cli>`，以 SW_HIDE 跑 `cli.mjs service boot` | 必须在交互登录会话里起 Chrome：SSH 会话（密钥登录）拿不到用户 DPAPI 密钥，Chrome 无法保存登录 cookie，且 SSH 断开时会话进程可能被回收。wscript 是 GUI 子系统，不闪控制台（同 cdp-serve 已验证的做法）；上游 daemon 再以 `windowsHide` 分离启动。不加 5 分钟轮询，语义与 Mac LaunchAgent 一致：死了就 `browserctl start`，它在 Windows 上等于 `schtasks /Run` 再等 daemon 就绪。 |
| 租约 | 不变：同 Mac，`%LOCALAPPDATA%\chrome-control\runtime\leases\<daemon pid>`，15 分钟 | 领域层与平台无关。 |
| Node | 官方便携 zip v24.21.0 LTS，SHA256 对 SHASUMS256.txt 校验，装到 `%LOCALAPPDATA%\chrome-control\node-v24.21.0-win-x64` | 不跑 MSI/UAC、不改系统 PATH。 |
| 参数转义 | `targets.json` 给 Windows 目标加 `env: MSYS2_ARG_CONV_EXCL=*`，browserctl 以 `env K=V …` 前置 | 防止 Git-Bash 把 JSON 参数里的 `/…` 当路径改写。 |

### 现成工具对照（不重复造轮子）

- **chrome-devtools-mcp（Google，Apache-2.0）**：采用。已原生支持 Windows 命名管道 daemon、pipe 启动、autoConnect；与 Mac 同一套工具和租约。
- **Playwright MCP `--extension`（Microsoft）**：免逐次 Allow 地接管机主现有 Chrome，但要在机主 Chrome 里装扩展、配 token，等于动机主浏览器，留给用户决定；其托管浏览器模式与上面重复，且工具 schema 与 Mac 不一致。
- **mcp-chrome（hangwin）/ BrowserMCP**：同样靠机主 Chrome 里的扩展＋native messaging；前者 2026-01 后无提交且有 Windows stdio 问题报告，后者 2025-04 后停更。不采用。
- **chrome-devtools-mcp-persistent-bridge（esmaesx）**：思路相同（Windows 持久 daemon＋UIA 点 Allow），但 0 star、绑 Codex；只借鉴“交互用户、LeastPrivilege、无 TCP 监听”这几条。
- **常驻**：WinSW / Servy / Shawl / NSSM 都是 session 0 服务，要用户密码才能以本人身份跑，且拿不到交互会话的 DPAPI；pm2 在 Windows 无开机自启。用系统自带计划任务（本机 cdp-serve 已验证同一做法）。VBScript 预计 2027 年起默认关闭，届时 cdp-serve 与本任务一起改用 `conhost.exe --headless`。

### 代码分层

- `domain/host-profile.mjs`：纯逻辑，按平台规格算 runtime、文件根、daemon 参数。
- `config/hosts.json`：darwin / win32 两份主机规格（数据，不含逻辑）。
- `adapters/host.mjs`：读规格、组装当前主机的 daemon、文件层、启动器；`adapters/logon-task.mjs`：Windows 计划任务启动器。
- `application/control.mjs`：用例（工具调用、租约、start）。
- `interfaces/cli.mjs`、`interfaces/mcp.mjs`；homevm 侧 `bin/browserctl`。
- 部署：`apply.sh <target>` 按 `os` 分派，Windows 走 `scripts/windows/deploy.sh`（tar over ssh、便携 Node、`npm ci`、注册任务）。
