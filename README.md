# Wintermute Desktop

Wintermute 的桌面端初步 demo，使用 **React + TypeScript + shadcn/ui + Tailwind CSS + Vite**，通过 **Electron** 提供 Windows/macOS 应用入口。

主页展示问候、声音波形、今日概览、记忆切片、今日简报和设备状态。支持侧栏导航、记忆搜索/筛选、详情弹窗和模拟聊天。所有数据均为本地示例，无需后端、账号或 API Key；没有真实同步、录音或设备配对。聊天在关闭应用后清空。

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

Windows 本机预览程序位于 `release/win-unpacked/Wintermute.exe`，请保留整个目录。macOS 使用原生菜单和关闭窗口后保留应用的行为；Windows 关闭所有窗口时退出。两者保留原生窗口标题栏与窗口控制，最小窗口为 860×680，布局随窗口宽度调整。

当前为未签名的开发 demo，使用 Electron 默认应用图标。正式分发前需配置 Windows 签名、macOS Developer ID 签名和 notarization；这里没有发布应用或上传安装包。

## 验证

```sh
npm run lint
npm run build
npm run test:e2e
node scripts/smoke.cjs release/win-unpacked/Wintermute.exe
```

E2E 使用本机 Chrome，覆盖主页、搜索空状态、详情、设备页、模拟消息，以及小窗口无横向溢出。`scripts/smoke.cjs` 接收已打包可执行文件路径，验证真正的 Electron 应用加载本地资源、模拟聊天和渲染器隔离，并在 `test-results/` 保存截图。macOS 可传入 `.app/Contents/MacOS/Wintermute`。

已配置 Windows/macOS CI，执行检查和本机应用打包；需推送仓库后运行，本地 Windows 验证不代表 macOS 实机验证。

2026-10-31 本机验证：TypeScript/Vite 构建、lint、2 项 E2E、Windows 打包和打包应用启动/模拟聊天均通过。生产依赖 `npm audit --omit=dev` 无告警；打包开发工具链仍有 minimatch 相关 moderate 告警，未强制降级 electron-builder。

## 结构

- `src/App.tsx`：演示导航、主页和本地交互。
- `src/data/demo.ts`：静态数据，后续服务接入点。
- `src/components/ui/`：由 shadcn CLI 生成并纳入源码的 Button、Badge、Dialog。
- `src/index.css`、`src/App.css`：主题和响应式布局。
- `electron/main.cjs`：应用生命周期；开启 sandbox/contextIsolation，关闭 nodeIntegration，拒绝额外窗口、页面导航和设备权限。
- `electron-builder.yml`：Windows/macOS 打包目标。

构建资源使用相对路径，支持 Electron 的 `file://` 加载。生产页面使用 CSP；Vite 开发模式单独允许 React 热更新所需的内联脚本。没有 preload 桥接或任意文件/命令接口。

可继续通过 `npx shadcn@latest add <component>` 添加组件。参考：[shadcn Vite 配置](https://ui.shadcn.com/docs/installation/vite)、[Electron 上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。
