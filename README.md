# Chrome 统一控制层

状态：2026-10-22 补齐 Mac 多账号路由：按邮箱／私人别名选择 Profile，经 Chrome 官方 IPC 创建一次性本地锚点并绑定 pageId，支持 Moodle 站内身份复核。Mac 继续使用现有 Chrome 与登录态，不复制账号配置或重启浏览器。Windows 专用 headless 实例保留原行为，本次不发布 Windows 服务。

## 架构

`browserctl / MCP → 已认证 SSH stdio → Mac 用户私有 Unix socket → 官方 Chrome DevTools MCP 1.10.1 daemon → 当前 Chrome profile`

- 浏览器引擎直接复用 Google 的开源 Chrome DevTools MCP（Apache-2.0）；SDK 1.32.1。包版本和 npm lockfile 固定，不运行安装脚本。
- 31 个官方工具，增加 7 个状态、租约、文件验证、指定账号打开及身份工具。`--account`／`--profile` 下 `new_page` 统一走可信账号创建，其他页面动作需要 Profile 绑定和当前 actor 的 15 分钟租约；pageId 不是 AppleScript tab ID。
- 官方 daemon 内部串行工具调用；不同 agent 的租约阻止互相误操作标签。租约是防误用措施，不是恶意客户端安全隔离，绕过入口直接调上游不受租约保护。
- 主机只经 SSH 认证，不转发、公开 CDP 端口。Chrome 官方调试开关只监听 Mac 回环地址，并仍要求原生 Allow。HTTP `/json/version` 在这个 approval-only 模式返回 404，不应用它判断服务坏了。
- 使用已有登录态，不提取 cookie 或复制用户配置；遥测、CrUX、自动版本查询关闭，网络敏感头过滤开启。上游有广泛浏览器权限，允许脚本执行，不保证抵御恶意脚本读取页面隐私；只操作本任务获授权页面。
- Mac 文件读写范围为项目目录、Downloads、已有 Cambridge MPhil 知识库。路径先规范化，防止符号链接逃逸。其他项目需显式扩展配置根。

## 多账号：按邮箱或别名操作

```sh
browserctl --machine zengxiaoximac01 profiles
browserctl --machine zengxiaoximac01 --actor my-task --account cambridge open https://www.vle.cam.ac.uk/my/
browserctl --machine zengxiaoximac01 --actor my-task --account cambridge pages
browserctl --machine zengxiaoximac01 --actor my-task --account cambridge identity <pageId>
browserctl --machine zengxiaoximac01 --actor my-task --account cambridge call take_snapshot '{"pageId":<pageId>}'
browserctl --machine zengxiaoximac01 --actor my-task --account cambridge call close_page '{"pageId":<pageId>}'
```

- `--account` 接受完整邮箱或私人别名，每次现场读取 Chrome `Local State` 解析目录；`--profile "Profile 1"` 仍可用，二者互斥。目录编号不作长期账号标识。多邮箱命中／未知别名不猜。
- 别名配置在**浏览器机器** `~/.config/chrome-control/accounts.json`（0600），例如 `{"school":{"email":"owner@example.org","sites":{"https://www.vle.cam.ac.uk":{"username":"expected-user"}}}}`。不含密码；`cambridge` 已在指定 Mac 私人配置中登记，个人邮箱不写进源码。直接用邮箱也继承同一网站身份策略。
- `open` 调现有 Chrome 的 `--profile-directory` IPC，在目标 Profile 打开随机本地 HTML，再从 MCP 精确匹配 URL、取得 pageId 和租约，最后导航。锚点无网络；实测带 fragment 的 `about:blank` 会被 Chrome 换成新标签页，不能拿它可靠定位。业务 URL 不加标记，不干扰 SPA 路由；原生开标签可能切换窗口，账号限定的 `new_page` 不接受无法保证的 `background:true`。
- `pages` 只列可信创建的绑定标签；用户原有标签不会自动被接管，不再读取 SNSS 历史作证。同一登录态操作用 `open` 新建任务标签；只关闭自己的任务标签。
- Profile 登记邮箱不等于网站当前登录身份。Moodle 验证当前 user ID 与本人 Profile 页用户名；结果是 `matched/mismatch/signed_out/unverified/observed`。其他站点明确报告 `unverified`。配置了预期 Moodle 用户时，自动下载必须匹配。
- 绑定按 daemon PID＋启动时间隔离；标签关闭／断线重连后失效。租约过期需重新 claim。无法看到目标 Profile 时只报错，不改用默认账号、不复制 Cookie、不重启 Chrome、不代点 Allow。此机制是可信工具链中的路由防误用，不是恶意客户端隔离。
- `--account ... mcp` 使用同一作用域；`browser_open`、`browser_identity` 对应 CLI 的 `open`／`identity`。未带作用域的旧 CLI 仍用于诊断，不声称能核实标签归属。Mac 个人 Chrome 下载必须显式选择账号。
- 复用社区 [chrome-profile](https://github.com/kaitranntt/chrome-profile/blob/main/SKILL.md) 的邮箱解析＋Chrome IPC 思路；改为随机、无网络本地锚点，不采用固定 fragment、历史 URL 或“最高 pageId”猜测。[官方连接与原生授权说明](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)。

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

**日常接口只有现成的 `browserctl` CLI，不依赖 skill，也不用在会话中注册／连接 MCP。** 底层继续复用官方 Chrome DevTools MCP daemon 作为浏览器引擎；`mcp` 子命令仅保留给需要该协议的客户端。2026-10-22 按用户要求撤掉额外安装的 skill，部署不再注册它。用法和参数按需查询，不向模型上下文灌一份操作手册：

```sh
browserctl --help
browserctl help open          # 或 browserctl open --help，本地帮助不连接浏览器
browserctl tools click        # 只看这个工具的参数 schema，不枚举全部
browserctl help call
```

代码归属：CLI 参数／帮助在 `bin/browserctl` 与 `config/cli-help.json`；命令分发在 `interfaces/commands.mjs`；账号路由、绑定与身份验证在 application/domain/adapters 层。说明随源码测试、提交、部署，不另维护 skill 副本。

`status` 只验 daemon，不证明已连接浏览器；`pages` 才真正连接。2026-10-08 Mac 首次连接曾在原生 Allow 弹窗处超时（osascript 无辅助功能权限）；2026-10-10 复验时已连接，`pages` 真实返回（`evidence/windows/mac-reverify.txt`）。需要在 Mac 正常确认；不改 TCC 数据库、不伪造批准、不重启 Chrome。连接保存在同一个官方 daemon 里；Chrome 或 daemon 断开后可能再次要求 Allow。工具请求 30 秒、外层命令 50 秒超时，不自动重发有副作用的操作。

## 下载与能力边界

DOM、iframe 快照、真实鼠标键盘输入、网页文件上传、页面截图、网页 JS 对话框都有官方工具。工具目录来自官方 MCP `tools/list`，不从帮助文字猜 schema。

`download URL --out NAME --account EMAIL_OR_ALIAS` 在账号绑定的同源标签中读取 PDF，校验魔数、字节数及落盘 SHA256。每份下载进入 `Downloads/chrome-control/download-随机目录/NAME`，不覆盖同名旧文件；脚本不在下载目录执行。普通网页点击下载仍可用 `browser_wait_file` 验证稳定性和 SHA256，明确是文件系统证据，不冒充 CDP 完成事件。不改全浏览器下载设置；系统弹窗仍按原生授权边界处理。

微软官方 Playwright Extension 0.4.0＋token 是免逐次连接审批的备选，但该 Mac 本轮动态强制策略安装没有生效。系统 API `CFPreferencesAppValueIsForced` 返回 false，Chrome 策略页 Not set，因此已撤回试写的扩展策略。没有宣称扩展安装成功。若后续正常安装配对，它默认接管新建受控标签，不等于自动接管全部既有标签。未安装额外浏览器、未迁移 cookie。

## 部署与运行

代码：homevm `workspace/chrome-control`；Mac `/Users/brook/workspace/chrome-control`；Windows `C:\Users\PC\workspace\chrome-control`。入口 `~/bin/browserctl` 链接至版本化项目脚本；目标登记在 `config/targets.json`（怎么到达），主机布局在 `config/hosts.json`（按平台）。

运行 `./apply.sh <target>` 增量部署（Mac：`scripts/deploy-mac.py`；Windows：原 `scripts/windows/deploy.sh`）。Mac 先保存代码回滚包到远端 `evidence/rollback/`，不覆盖日志／证据，不删除远端文件；lock 未变且依赖存在时不重装 node_modules。发布后核对全部运行源码 hash 与能力清单。`capabilities`／`status` 可读回协议和源码版本；旧端会在 `scoped` 入口明确拒绝账号请求，客户端提示版本不匹配，不退到无作用域调用。Mac LaunchAgent `cn.imbecile.chrome-control` 保持原配置，已有 daemon 不重启；无常驻轮询。daemon 死亡后明确 `browserctl start`，不承诺自动批准重连。

删除部署先在 Mac 正常 `launchctl bootout gui/501/cn.imbecile.chrome-control`，再 `browserctl stop`，最后删除仅本项目的 LaunchAgent、CLI 链接和 MCP 登记。不要关闭用户 Chrome 或删除用户 profile。

## 验证

```sh
npm test
node scripts/acceptance.mjs       # homevm 独立、无现有登录态的 headless Chrome
node scripts/probe-mcp.mjs        # Mac SSH/MCP，不要求连接用户浏览器
node scripts/probe-mcp.mjs zengxiaoxiwin01 'C:\Users\PC\workspace\chrome-control' evidence/windows/mcp.json
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
| 常驻 | 计划任务 `\chrome-control`：登录触发器 ＋ 每 5 分钟的时间触发器（TimeTrigger PT5M），InteractiveToken、LeastPrivilege；动作 `wscript.exe //B launch.vbs <node> <cli>`，以 SW_HIDE 跑 `cli.mjs service boot`。boot 幂等：daemon 正常应答时什么都不做，也不写日志 | 必须在交互登录会话里起 Chrome：SSH 会话（密钥登录）拿不到用户 DPAPI 密钥，Chrome 无法保存登录 cookie，且 SSH 断开时会话进程可能被回收。wscript 是 GUI 子系统，不闪控制台（同 cdp-serve）；上游 daemon 再以 `windowsHide` 分离启动。5 分钟心跳放在时间触发器上，没有放在登录触发器的 Repetition 里：后者要等下一次登录事件才开始重复，任务重新注册后到下次登录之间根本不跑（2026-10-11 实测 cdp-serve：NextRunTime 为空，最后一次运行停在 10-10 22:49）。daemon 被杀时，它的 Chrome 随 pipe 关闭一起退出，不会留下占着 profile 锁的孤儿进程。 |
| UA | `--chromeArg=--user-agent=… Chrome/<major>.0.0.0 …`，major 在 daemon 启动时从 chrome.exe 版本资源读取（`adapters/chrome-version.mjs`） | headless 默认 UA 是 `HeadlessChrome/<v>`，有出版商会拒（研究侧 cdp-serve 已同样处理，参考 a488c241fd06ef15）。读不到版本就不启动（下一次心跳重试），不会退回到 Headless UA。Chrome 更新后，UA 在下一次 daemon 启动时跟上。 |
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
- `adapters/host.mjs`：读规格、组装当前主机的 daemon、文件层、启动器；`adapters/logon-task.mjs`：Windows 计划任务启动器；`adapters/chrome-version.mjs`：从 chrome.exe 读主版本号（UA 用）。
- `application/control.mjs`：用例（工具调用、租约、start）。
- `interfaces/cli.mjs`、`interfaces/mcp.mjs`；homevm 侧 `bin/browserctl`。
- 部署：`apply.sh <target>` 按 `os` 分派，Windows 走 `scripts/windows/deploy.sh`（tar over ssh、便携 Node、`npm ci`、注册任务）。

### 使用

```sh
browserctl --machine zengxiaoxiwin01 status        # 只验 daemon
browserctl --machine zengxiaoxiwin01 start         # = schtasks /Run \chrome-control，等 daemon 就绪
browserctl --machine zengxiaoxiwin01 --actor me pages
browserctl --machine zengxiaoxiwin01 --actor me call browser_claim_page '{"pageId":1}'
browserctl --machine zengxiaoxiwin01 --actor me call navigate_page '{"pageId":1,"type":"url","url":"https://example.com/"}'
browserctl --machine zengxiaoxiwin01 --actor me call evaluate_script '{"pageId":1,"function":"() => document.title"}'
```

文件路径用 Windows 路径（`C:\Users\PC\Downloads\…`），文件根是项目目录和 Downloads。专用 profile 初始没有任何登录；需要登录的网站要在这个 profile 里登录一次（它在磁盘上持久，用户 DPAPI 加密）。UA 与普通 Chrome 一致（`navigator.userAgent` 和 client-hint brands 都没有 Headless），但 `navigator.webdriver` 为 true（上游默认带 `--enable-automation`），仍可能被识别为自动化。

### 下载腿（生产路径：专用实例，2026-10-12）

`browserctl --machine zengxiaoxiwin01 download <url> --out NAME [--profile DIR] [--identity NOTE]`：选一个**目标 origin 上的 tab**，在页内做同源带凭据的 fetch，先校验 `%PDF-` 再分块 base64 回传，写进暂存目录 `Downloads\chrome-control\<NAME>`，返回 `{path, bytes, sha256, finalUrl, profile, via, identity}`。donor 页走租约（`LeasedPage`）。

- **默认 profile = `chrome-control`（专用实例）**，这也是生产路径。实例由我们自己用 `--remote-debugging-pipe` 拉起，独立 user-data-dir，**没有 Allow 弹窗**，5 分钟心跳守护；机主不在场也能跑。目标 origin 没有 tab 时，下载腿自己开一个、用完关掉；如果被重定向离开该 origin（会话失效），会报 `No session on <origin>`，提示先跑 `login`。
- 2026-10-22 更正：`--profile`／`--account` 不再按 SNSS 推断现有标签，改用可信创建的受控标签。指定 Profile 新建标签目前在 Mac 实装；Windows 个人 Chrome 此路径明确报不支持，本次未部署。Windows 生产仍走专用实例。autoConnect 新连接的原生 Allow 不能绕过。（2026-10-12 误设的 `DeveloperToolsAvailability=2` 是全机禁用 DevTools，已撤销。）
- homevm 回传：`scripts/pull-download.sh <machine> <remotePath> <dest> <sha256> [--pdf]`。

`browserctl --machine zengxiaoxiwin01 login [ENTRY]`：在专用实例里无人值守登录 Cambridge（Raven/Entra），已获机主授权。凭据文件（默认 `~/.config/cambridge/credentials`，可用 `--credentials` 指定）经 ssh **stdin** 传过去，不进 argv。流程：开一个 tab → 进入 ENTRY（默认是 ScienceDirect 文章页，走 ezproxy）→ 用户名 → 密码 → push 提示切到 PhoneAppOTP → TOTP → 保持登录 → 关 tab。护栏：
- 每个凭据最多提交一次，同一个字段再次出现就视为被拒，立即停止，避免锁号。
- 账号注册了 passkey：提交用户名前先把 `PublicKeyCredential` 去掉。如果仍被路由到 `bridge/fido`，点一次页面的“上一步”；还不行就停下并报“需要人处理”。
- 出现“选择登录方法”时选“使用我的密码”。
- 只在专用实例里跑，`--profile` 指向机主 profile 时直接拒绝。
代码：`domain/entra.mjs`（凭据解析、TOTP、选择器、页内表达式）、`application/sign-in.mjs`（流程本身）、`interfaces/login.mjs`（命令入口）。

### 机主真实 Chrome（2026-10-11，`evidence/windows/real-chrome/`）

Windows 上新增命名实例 `real`：autoConnect 连机主正在用的 Chrome（两个 profile `Default`=BrookZeng、`Profile 1`=Brook 共属同一浏览器进程，一个 daemon 全都看得见）。前提是在机主 Chrome 的 `chrome://inspect/#remote-debugging` 打开"Allow remote debugging for this browser instance"（一次性 GUI 动作，2026-10-11 用 wmcp 代点完成，机主本人已全权委托本次任务）；之后每个**新的** daemon 客户端首次连接仍会弹一次原生 Allow 对话框，批准后该 daemon 连接持续有效，5 分钟心跳守护它不掉。

- `browserctl --machine zengxiaoxiwin01 profiles`：读 `Local State` 的 `info_cache`，列目录名/显示名/登录账号（macOS 同一份结构，同一实现）。
- 历史记录：10/11 曾按 SNSS URL 指纹推断 `--profile` 标签归属；该证据不可靠，10/22 已从源码移除。新账号路由见顶部，不能拿这里的历史验收当作当前 Profile 绑定证明。`chrome-control` 专指专用 headless 实例。
- 计划任务成对注册：`\chrome-control`（专用 headless）与 `\chrome-control-real`（机主 Chrome），各自 runtime 目录与 daemon 会话（默认 `cc001`，命名实例取哈希），互不挤占。
- Cambridge 登录（历史记录）：2026-10-11 用已删除的 `scripts/cambridge-login.mjs` 在机主 Chrome 里登录过，证据见 `cambridge-login.json`、`sciencedirect-authenticated.png`、`multi-profile.txt`。现在登录只走专用实例，用 `browserctl login`，见上文“下载腿”一节。

### 验收（2026-10-10，`evidence/windows/`）

- `acceptance.txt`：targets / status / pages；claim → navigate_page（URL 带 `/a:b/c`）→ evaluate_script 读回标题 `Example Domain`；他人 actor 被租约拦下；release。
- `mcp.json`：经 SSH 的 MCP stdio，36 个工具、租约拦截、Windows 路径文件盘点。
- `user-agent.txt`（2026-10-11）：daemon 参数里带上版本号 155 的 UA，页面里 `navigator.userAgent` 不含 Headless，brands 是 `Google Chrome/155, Chromium/155`。
- `self-heal.txt`（2026-10-11）：`stop` 之后 31 s 被 5 分钟心跳拉起；`Stop-Process -Force` 硬杀 daemon（按命令行里的 daemon.js ＋ 本 profile 匹配）后，本 Chrome 随之退出，3 分 38 s 后被心跳拉起，`pages` 正常，全程没有手动 start；之后的空跑心跳任务结果 0，daemon pid 不变，startup.log 不增行。研究浏览器主进程（pid 25208，10-10 22:48:42 启动）和 9444 全程不变。
- `restart.txt`：`stop` 只结束本 profile 的 7 个 Chrome 进程（研究浏览器 8 个不动）→ `start` 经计划任务恢复；按 profile 杀掉本 Chrome 主进程后，下一次调用由上游自动重启它，page id 前进（1→2），旧租约不会落到新页面上。进程表显示本 Chrome 位于会话 1、`--headless=new --remote-debugging-pipe`、**无任何监听端口**；研究浏览器仍独占 `127.0.0.1:9444`。
- `mac-reverify.txt`：分层重构部署到 Mac 后 daemon 未重启（pid 不变、参数不变），`pages` 真实连接，`probe-mcp` 通过。
- `research-browser-*.json`：研究浏览器前后状态。之后 9444 仍只由 cdp-profile 的 Chrome 监听，19444 隧道 `/json/version` 正常。exit-pool 的 `remote-port-unavailable` 和 research-watch 的 `probe:browser` 是两个已有的告警，与本项目无关，已报给 team-lead：前者是 exit-pool-check 的 systemd 沙箱里 ssh 拒绝 `/etc/ssh/ssh_config.d/10-physical-windows.conf`（root 映射成 nobody），后者是 research-watch.service 的 PATH 里没有 `~/bin`。

未测：注销 / 重启后的登录触发器。会打断机主会话（自动登录的物理机），没做。登录触发器与 cdp-serve 是同一种机制，而 `start` 跑的就是同一个任务动作；所以只差“登录事件会不会触发它”这一步没有亲眼验证。

### 风险与边界

- 不碰研究浏览器：不开 TCP 端口，不落进 cdp-serve 的候选端口，按 profile 匹配进程，不按映像名；没改 `C:\win01-cdp` 和 `cdp-serve` 任务。
- 不碰机主 Chrome：要驱动它（autoConnect 或 Playwright 扩展）需要机主本人同意并在桌面上批准，这一步留给用户；`config/hosts.json` 的 `win32.browser.mode` 改成 `autoConnect` 即可切换。
- 注销后 daemon 随会话结束，下次登录由任务拉起；daemon 崩溃后最多 5 分钟自动恢复。也因此 `browserctl stop` 只停到下一次心跳；要真正停掉，先 `schtasks //Change //TN chrome-control //DISABLE` 再 stop（恢复用 `//ENABLE`）。
- SSH 到这台机建立会话本身约 2.9 s，`status` 合计约 4 s，离 hubctl 的 5 s 探测超时不远。
- VBScript 预计 2027 年起默认关闭，见上文对照。
- MSYS 会把以 `/` 开头的独立参数改写成 Windows 路径（实测 `/tmp/report.pdf` → `C:/Users/PC/AppData/Local/Temp/report.pdf`）；JSON 参数以 `{` 开头不受影响，`MSYS2_ARG_CONV_EXCL=*` 作为防线保留。
- 卸载：`schtasks //Delete //TN chrome-control //F`，`browserctl --machine zengxiaoxiwin01 stop`，删除 `C:\Users\PC\workspace\chrome-control` 和 `%LOCALAPPDATA%\chrome-control`，再从 `targets.json` 去掉条目。
