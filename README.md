# 通用浏览器 CLI 基础设施

`browserctl → 已认证 SSH → 共用 PlaywrightSession → 官方 Playwright CLI → Chrome`

Mac 与 Windows 使用同一套会话、账号路由、租约、文件和业务用例；平台差异只存在于配置、进程启动和私有文件权限适配。**不提供 MCP 服务/入口，不注册 skill，不自行实现浏览器协议。** 官方包中的 `PLAYWRIGHT_MCP_*` 是上游环境变量名，不代表运行了模型会话 MCP。

## 连接模式

- **extension**：连接已有 Chrome 的明确 Profile，保留本人登录态。正常安装微软官方 Playwright Extension 后，用该 Profile 独有 token 配对。每个 Profile 一个持久连接；不同任务仍使用独立 actor 租约。token 有效时重连无需逐次 Allow。
- **dedicated**：官方 CLI 持有专用持久 Profile，Chrome 走调试 pipe，不公开 CDP TCP 端口；不借用机主其他 Chrome。
- **isolated**：使用隔离浏览器，不承诺既有登录态。

当前配置：Mac 使用 extension；Win01 沿用既有 dedicated Profile。Windows 的个人 Chrome 也走相同的 extension 模型，但使用前必须在目标 Profile 正常安装扩展、完成配对；不能把专用实例的验收当作个人 Profile 已验收。

`config/targets.json` 描述 SSH/Node/项目位置，`config/hosts.json` 描述平台、实例、文件根和启动方式。新增机器只增加配置与必要的平台适配，不复制一套控制实现。

## 使用

```sh
browserctl --help
browserctl help open
browserctl tools click
browserctl targets
browserctl --machine MACHINE profiles
browserctl --machine MACHINE status
browserctl --machine MACHINE --account ACCOUNT status
browserctl --machine MACHINE --account ACCOUNT pair
browserctl --machine MACHINE --account ACCOUNT start
browserctl --machine MACHINE --actor TASK --account ACCOUNT open https://example.org/
browserctl --machine MACHINE --actor TASK --account ACCOUNT pages
browserctl --machine MACHINE --actor TASK --account ACCOUNT call take_snapshot '{"pageId":2}'
browserctl --machine MACHINE --actor TASK --account ACCOUNT call click '{"pageId":2,"uid":"0_3"}'
browserctl --machine MACHINE --actor TASK --account ACCOUNT call close_page '{"pageId":2}'
```

专用实例不带 `--account`。`--profile DIR` 与 `--account` 互斥；账号接受完整邮箱或浏览器主机上的私人别名，每次读取实际 Chrome 登记信息，不长期绑定目录编号。别名位于浏览器主机 `~/.config/chrome-control/accounts.json`；冲突、缺失或未配对都明确报错，不落到默认账号。

## 配对与边界

扩展：[微软官方商店页](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。安装/扩展权限由机主正常确认；状态页显示的 token 经 `pair` 的不回显终端输入或 stdin 保存，不作为远程命令参数。

- 配对文件只在浏览器主机：`~/.config/chrome-control/pairings/`。POSIX 使用 0700/0600，Windows 使用当前用户的受保护 DACL。
- 配对可撤销：卸载扩展或重置 token 后需重新配对。网页权限、验证码、二次认证、外发和签署授权仍按正常边界处理；不自动点击 Allow，不伪造 Chrome 策略，不复制 Cookie。
- Mac 上游默认会把 token URL 放进 Chrome 启动参数；锁定版本仅替换 URL 打开动作，经私有 stdin 和精确 Profile 锚点 IPC 传递，不改变上游调试协议。Windows 专用模式不需要配对 token。
- 扩展仅控制其受控标签组，不自动接管用户已有标签。`pages` 只列当前代次已绑定标签；Moodle 另行核实站内身份，其他站点明确标为未验证。
- Page ID 绑定 CLI 进程代次；重启后旧 ID/租约不获新授权。并发启停由跨平台文件锁串行化，状态文件原子替换；不自动重发有副作用的操作。
- 租约用于防误操作，不是同用户恶意进程之间的安全隔离。只操作任务获授权页面，只关闭自有标签。

## 能力与文件

两平台共用：创建/关闭标签、导航、DOM/iframe 快照、点击/坐标点击、悬停、填写表单、键盘、脚本、上传、PNG/JPEG 截图、等待文本和调整视口。快照 UID 兼容已有 CLI 调用；旧 DevTools 性能、内存、网络/控制台工具和 JS 对话框接口未迁移，不伪装支持。`tools TOOL` 返回当前实际支持的契约。

文件路径属于浏览器主机。项目目录与配置中的文件根先做真实路径校验，不能通过符号链接逃逸；文件不可覆盖。截图需显式 `filePath`。PDF 下载在正确账号的同源受控标签内执行，校验 PDF 魔数、字节数和 SHA256，每份进入新的独立目录：

```sh
browserctl --machine MACHINE --actor TASK --account ACCOUNT --out paper.pdf download URL
browserctl --machine MACHINE --actor TASK --account ACCOUNT call browser_wait_file '{"path":"HOST_PATH","timeoutMs":15000}'
```

`browser_wait_file` 是文件系统稳定性证据，不冒充浏览器下载事件。Cambridge 既有登录流程仍只允许专用实例：`browserctl --machine MACHINE login [ENTRY_URL]`；凭据从本机私有文件经 SSH stdin 传入，每个凭据只提交一次，重复拒绝/二次认证不确定就停止，不重置或复制个人 Profile。

## 运行与部署

- `PlaywrightSession`、`PlaywrightConnection`、`PlaywrightCli` 共用连接与调用层；账号/绑定/租约/文件在既有 domain/application/adapters 层。
- Mac 已有浏览器按需连接，不再登录启动旧 autoConnect 服务；部署先备份再移除仅本项目的旧 LaunchAgent。
- Windows 必须在交互登录会话启动，以使用本人 DPAPI/登录态且不被 SSH 会话回收。复用系统计划任务与隐藏启动器，不降到 Session 0 服务。专用实例登录及每五分钟幂等恢复；个人 Profile 只在显式请求时连接。
- `stop` 会影响同一实例的共享连接；Windows 专用任务之后会恢复它，需长期停止时先禁用对应任务。禁止按 chrome.exe/node.exe 名称批量杀进程。
- `./apply.sh TARGET` 先保存源码回滚包，再部署锁定依赖、精确删除已退役的源文件并核对源码摘要；不删除用户 Profile、日志或其他项目。旧历史证据保留在 `evidence/` 和 Git 历史，不代表现行能力。

显式运维覆盖可通过 `CHROME_CONTROL_MODE`、`CHROME_CONTROL_RUNTIME`、`CHROME_CONTROL_USER_DATA_DIR`、`CHROME_CONTROL_INSTANCE`、`CHROME_CONTROL_START_TASK` 传递；适合独立验收实例，不作为静默回退。后端固定官方 CLI，原 autoConnect 模式已移除。

## 验证

开发仅跑相关契约；发布前一次全量、导入闭包和代码形状检查。两平台使用同一个真实验收脚本，URL 必须是自有测试夹具，绝不指向业务写操作：

```sh
npm test
python3 -I scripts/smoke.py --machine MACHINE --account ACCOUNT --url OWNED_FIXTURE_URL --evidence-dir HOST_ALLOWED_DIRECTORY
```

专用实例省略 `--account`。验收覆盖快照→表单/点击→独立 DOM 读回→截图→真实 PDF 下载/SHA256→自有标签清理；另验证主动重连、并发启停和既有只读消费者。不得为验收重启整机或干扰不属于本项目的浏览器。

上游：[Playwright CLI](https://github.com/microsoft/playwright-cli) · [官方扩展配对说明](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)
