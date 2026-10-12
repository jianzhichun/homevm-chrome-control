# v1：研究流水线下载腿按出版商路由到 win01（2026-10-12）

## 接线
- research 侧：`transport/netlayer/download/publisher_download/win01_leg.py`
  - 路由是数据：`PUBLISHER_ROUTES`（springer → win01-daemon）+ `RESEARCH_WIN01_ROUTES` json 覆盖；Elsevier 不在表里 → 走本地 cascade（craft 反爬不尝试，v0 立档）。
  - 腿：`browserctl download`（win01 上的分层 CLI）→ Cambridge 会话 tab 同源 fetch（%PDF- 魔数预检）→ 分块 base64 回家 → sha256 校验 → 暂存。
  - cascade 入口挂了策略钩子：路由命中 → 腿失败即回落本地 cascade（每个失败形状都回落，不吞）。
- 测试：tests/test_win01_download_leg.py（路由表/哈希不符拒收/HTML 拒收/SSH 失败/异步入口），8 个。
- 常驻语义：daemon 常驻（pid 55340 since 10:14，跨多次下载无重启）；每篇论文的边际成本=一次导航+同源 fetch。

## 全链验证（DOI 10.1007/s10921-023-01030-z, JNDE 2023）
- 路由判定 → win01 下载 → 回传 → sha256/%PDF 校验 → 与 papers 库既有副本**逐字节一致**（3,787,740 B，sha256 3b718353…9945）。
- 产物留档：~/tmp/keep/chrome-control-v1/win01-e2e-01030-z.pdf。

## 耗时
- win01-daemon 全腿（browserctl download 含 150s inline 观察等待）：2m38s。
- 其中同源 fetch+提取仅 ~2s；等待是 inline 出版商在 Chrome 下载管线里不落盘导致的固定浪费。
- 已知优化（后续）：extraction-first 重排——先找已有 tab 直接提取，观察等待只在附件类出版商走。预期全腿 <20s。
- homevm 直下：无 Cambridge 会话，entitled PDF 结构性不可得（旧路径 9444 浏览器路线有 CDP-over-WG 会话断裂问题，即本改造的动机）。

## 边界
Elsevier（craft 反爬）不尝试绕过；9444 与 Brook profile 的会话边界保持；只读诊断，未动路由/选择逻辑。
