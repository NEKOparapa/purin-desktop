# Wintermute Desktop

Wintermute 的 Windows/macOS 桌面终端，使用 Electron、React 和 TypeScript。

## 连接 Agent

1. 启动 Wintermute 后端并启用 HTTP 接口。后端示例 `config/interfaces.example.json` 将 `http-desktop` 绑定到用户 `local` 的 `main` 会话，令牌由 `WINTERMUTE_HTTP_TOKEN` 提供。每台设备使用自己的终端 ID 和令牌，同一用户的终端可以绑定到同一个会话。
2. 打开侧栏底部的“设置”，默认进入“连接”。填写服务地址（本机默认为 `http://127.0.0.1:8080`）、终端 ID 和令牌，点击“验证并保存”。已保存的终端 ID、服务地址和连接状态也在这里查看。桌面端使用操作系统凭证加密保存令牌。
3. 应用直接打开对话。输入问题后按 Enter 发送，Shift + Enter 换行，等待期间可继续补充。用户消息、Agent 回复和后台通知分别标记。

侧栏“设置 → 外观”提供跟随系统、浅色和深色，默认跟随系统。选择立即生效，保存在当前设备上，连接 Agent 前也可以设置。

桌面端按服务地址和终端 ID 保存本机历史。已发送消息通过任务状态和终端收件箱恢复，收到回复先保存再确认投递。超时后点击“重试发送”会复用原消息 ID。处理失败、中断或服务器找不到原任务时，可以点“重新提问”生成新请求。收件箱断线后会自动轮询重连。

## 查看主 Agent 的日历

连接终端后，点侧栏「日历」。月历按电脑的本地时区显示当前会话的安排。选中日期可查看当天的触发时间、安排内容以及是否已经通知主 Agent。可在对话里让 Agent 新建、改期或取消安排。打开的日历会自动刷新，也可以手动刷新。

## 浏览后端记忆

连接终端后，点侧栏“记忆”。“对话历史”保留用户原话、Agent 回复、工具调用与结果、后台通知和活动更新。“时间线历史”单列当时追加到会话的合并更新。要追看某条记录的来源，可切换到交流、通知、感知或切片层，往前加载更早的记录。同一会话的其他终端产生的记录也可以在这里查看。

时间线历史只显示活动文字。要查看原始截图或录音，打开「切片层」，点击文件名，在系统保存窗口选择位置后开始下载。取消保存不会发出文件请求。上传协议没有原始文件名，后端按采集时间命名，分段录音保留分段编号。

在「感知层」或「切片层」选择「压缩对照」，点开一个批次即可比对活动输入、规则摘要和已生成的 AI 摘要。展开「查看原始资料」可以追到事件、文件名和已保存的转录或提取结果；尚未进入批次的采集记录也可从「记录」直接查看。要核实主 Agent 实际收到的文字，点击「查看已投递的时间线」。

## 桌面活动与分享

连接终端后，在“终端设置 → 信息采集”分别启用需要的来源。

- **桌面活动。** 开启“分享桌面活动”后，桌面端每 15 秒采样，发现应用切换后会在 5 秒门槛处复查。同一应用停留满 5 秒后继续在本机计时。同一应用内切换窗口或标签页合并计时，保留最后可读取的窗口标题。离开后向感知层发送一条 `desktop.window_span`，包含应用、标题、起止时间与估算停留秒数。误切后很快返回会沿用原时段，扣除已观察到的离开时间。空闲、锁屏、退出客户端或采样中断也会结束已确认的时段。关闭采集会清空尚未发送的自动桌面观察。macOS 读取其他应用标题可能需要允许辅助功能和自动化。
- **浏览器。** 启用“浏览器接入”，打开扩展文件夹，在 Chrome 或 Edge 的扩展管理页加载已解压的扩展，然后复制配对码到扩展。通过工具栏分享当前页，或选中文字后使用右键菜单。自动采集要对每个站点单独启用，只发送前台页的域名和标题。[扩展操作说明](browser-extension/README.md)
- **定时截取前台窗口。** 在“终端设置 → 信息采集”开启“分享桌面活动”和“定时截取前台窗口”，可选择每 1、5、15 分钟截图，默认 5 分钟。Windows 和 macOS 根据系统窗口 ID 匹配其他应用的前台窗口。设备空闲、锁屏、正在使用 Wintermute 或截图期间切换窗口时会跳过。macOS 需要系统录屏权限。JPEG 通过 `/v1/image/slices` 上传到切片层，携带前台应用、可读取的窗口标题和关联停留记录 ID。断网时本地暂存，队列达到 128 MiB 后暂停新增。关闭截图或桌面活动会清理待传定时截图。
- **主动分享。** 对话输入框旁点“分享”。可输入或粘贴文字，截取指定窗口或屏幕、粘贴一张图片，或录制最长 5 分钟的麦克风声音。检查文字、预览图片或试听后点“确认分享”。macOS 首次截图或录音时需开放相应系统权限。

文字进入切片；截图按 JPEG 上传，在服务端由支持图片输入的模型描述；录音按单声道 Ogg/Opus 上传，由服务端转录和摘要。后端 HTTP 示例启用了截图接收。录音还需启用音频处理、配置 ASR 和摘要模型，可参考后端 `config/audio.example.json`。原始媒体保存在服务端，主会话使用合并后的活动时间线。每台终端有独立待发队列。在“设置 → 信息采集”可以查看本机待发数量、失败项目和正在处理的媒体，也可以重试或丢弃失败的上传。

## 开发

使用 Node.js **24 LTS** 和 npm，依赖由 `package-lock.json` 锁定。

```sh
npm ci
npm run dev
```

`dev` 同时启动 Vite 与 Electron；关闭开发命令时两个进程一并结束。只预览网页可运行 `npm run dev:web`，访问 `http://127.0.0.1:5173`。端口固定，若已被占用会报错，避免 Electron 加载错误服务。

```sh
npm run build
npm start
```

以上命令使用 Electron 加载构建后的本地文件，不依赖开发服务器。

## 打包

```sh
npm run pack       # 当前系统的应用目录，输出 release/
npm run dist:win   # Windows NSIS 安装包，x64 + arm64
npm run dist:mac   # macOS DMG，Intel + Apple Silicon；在 macOS 上执行
```

Windows 本机预览程序位于 `release/win-unpacked/Wintermute.exe`，请保留整个目录。可以拖动窗口顶部的空白处移动窗口，使用系统窗口按钮最小化、最大化或关闭窗口。最小窗口尺寸为 860×680。macOS 保留原生菜单，关闭窗口后应用继续运行。Windows 关闭所有窗口时退出。

当前构建使用 Electron 默认应用图标及本地未签名配置。

## 验证

```sh
npm run lint
npm run build
npm run test:agent
npm run test:e2e
node scripts/smoke.cjs
node scripts/smoke.cjs release/win-unpacked/Wintermute.exe
```

`test:agent` 使用本地 HTTP 服务验证重试、收件箱去重、任务结果恢复和活动采集去重。浏览器 E2E 使用本机 Chrome 测试导航、未配置时的引导和小窗口布局。纯网页预览没有 Electron 系统采集及凭证桥接。

`scripts/smoke.cjs` 会使用临时应用资料启动真正的 Electron 窗口，验证连接、开启与关闭系统采集、发送会议问题、回复落盘和重启恢复。默认运行本地测试 HTTP 服务。要连接实际后端，可在测试进程设置 `WINTERMUTE_TEST_URL`、`WINTERMUTE_TEST_TOKEN` 和可预期的回复片段 `WINTERMUTE_TEST_REPLY`，并为这次测试绑定终端 `http-desktop`。macOS 打包程序可传入 `.app/Contents/MacOS/Wintermute`。

## 结构

- `src/App.tsx`、`src/components/agent-settings.tsx`：会话、终端设置和主页。
- `src/components/memory-browser.tsx`：后端历史浏览、分页和附件保存入口。
- `src/components/ui/`：由 shadcn CLI 生成并纳入源码的 Button、Badge、Dialog。
- `src/index.css`、`src/App.css`：主题和响应式布局。
- `electron/main.cjs`、`electron/preload.cjs`：应用生命周期和类型受限的 IPC 接口。渲染器启用 sandbox/contextIsolation。
- `electron/agent.cjs`、`electron/activity.cjs`：主进程内的认证、持久收发、队列和系统活动采样。
- `electron-builder.yml`：Windows/macOS 打包目标。

构建资源使用相对路径，支持 Electron 的 `file://` 加载。生产页面使用 CSP，Vite 开发模式单独允许 React 热更新所需的内联脚本。

可继续通过 `npx shadcn@latest add <component>` 添加组件。参考：[shadcn Vite 配置](https://ui.shadcn.com/docs/installation/vite)、[Electron 上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。
