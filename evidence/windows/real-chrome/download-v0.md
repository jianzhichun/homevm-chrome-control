# 下载腿 v0 全链验证（2026-10-11）

## 链路
1. `browserctl --machine zengxiaoxiwin01 download <url> --out NAME --profile "Profile 1"` → win01 上 open-request.txt + `\chrome-control-open` 任务在交互会话里把 URL 转发进正在运行的 Chrome（指定 profile），轮询 Chrome 下载目录的新完成文件，挪进暂存 `Downloads\chrome-control\<NAME>`，返回 {path,bytes,sha256,final_url,http_status,profile,identity}。
2. `scripts/pull-download.sh` 经现有 ssh 通道 tail -c 分块续传拉回，sha256 + %PDF- 魔数双校验后落位。

## 结果
- **真 PDF 全链成功（Springer JNDE, DOI 10.1007/s10921-023-01042-9）**：
  - win01 暂存：C:\Users\PC\Downloads\chrome-control\s10921-023-01042-9.pdf，7,210,377 字节，%PDF-1.4，content-type application/pdf
  - sha256 = 5cb65463dedc1bd86d8a4e0a6a88b37d7cd8a2d44853d496e479e6c74157993c（win01 算、homevm 拉回后复核一致）
  - homevm 落位：~/tmp/keep/chrome-control-v0/s10921-023-01042-9.pdf（该文未在 ~/papers，暂存 keep；如需入库由调用方移动）
- **Elsevier/ScienceDirect 被机器人挑战拦截（craft）**：/pdfft 经 crasolve 进 craft/challenge（52397B HTML，含 /craft/hosnb beacon），beacon 经 ezproxy 返回 404 → 挑战永远完不成 → 无 PDF 响应。触发面是调试协议附着（Chrome 顶栏"自动化测试软件正在控制"横幅），属 Chrome 设计行为，本层不隐藏（既定边界）。作为对照，watch/stage/pull/verify 的机制本身用该挑战页字节走通了全程，且 %PDF- 魔数校验正确拒收了 HTML。
- **Chrome 内联渲染 PDF 的通用解**： Publishers inline 渲染时不产生下载文件。download 用例内置 fallback：在已认证 tab 上同源 fetch（带 credentials）→ %PDF- 魔数预检 → 分块 base64 拉回 → root 内落盘（ Springer 实测 7.2MB 无损；Elsevier 因 craft 挑战 fetch 拿不到 PDF，会带诊断信息失败）。

## 身份与 profile 认定
- Cambridge 会话在机主真实 Chrome 的哪个 profile：登录 tab 所在 profile（重登脚本在其 tab 上完成用户名→密码→push→OTP→保持登录）。**"Profile 1=Brook 持有会话"的旧假设不成立**——open task 打到 Profile 1 的 tab 卡在 Entra 登录页；会话跟的是 tab 所在 profile（SNSS 归属是历史证据，不能当实时断言）。流水线接线时：先跑登录，再在**同一 profile** 立即下载（会话约数小时过期；过期单次重登、失败告警、不循环——按既定护栏）。
- 每个新 daemon 客户端首次连接需人工点一次原生"允许"（Chrome 设计）；daemon 常驻不复发。

## 环境备注
- homevm↔win01 WG 白天抖动（#51 在查）：两次中断长命令（一次 ssh 重登流被断、一次 pull 首试）。缓解：长活用 windows-mcp 会话内分离进程 + 远端日志文件轮询；pull 脚本本身可续传。
- 机主 17:4x（UK）回到机器前操作（关掉了 tab 堆、开了任务管理器）；自动化随即收手，未再开新 tab。
