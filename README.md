# My Cat Desktop Pet

一只运行在 macOS 桌面的轻量悬浮猫咪桌宠，使用 Electron、React、TypeScript 和 Vite 构建。

它本身不是聊天机器人或 AI Agent，只观察 Codex 与 DeepSeek Harness 的生命周期状态，并将其转换成统一的桌宠反馈。

## 当前功能

- 240 × 240 透明、无边框、始终置顶的 macOS 窗口
- 透明区域鼠标穿透，不影响下方应用
- 五种状态：`IDLE / WORKING / WAITING / DONE / ERROR`
- 五张独立透明 PNG，以及加载失败占位图
- 克制的 CSS 呼吸、等待、完成和错误动画
- 拖动桌宠、悬停反馈和 IDLE 轻互动
- 状态提醒气泡与 WAITING 低频持续提醒
- macOS Tray 菜单：显示、隐藏、退出、当前状态
- `Command + Option + C` 全局快捷键召唤猫咪
- 生产环境登录启动能力
- Codex 生命周期状态接入
- DeepSeek Harness 官方 Cordis Plugin 状态接入
- Codex / DeepSeek 双来源状态聚合

## 状态聚合规则

桌宠不会采用“最后写入者控制状态”的方式，而是分别保存 Codex 和 DeepSeek 的状态，再按以下优先级计算最终状态：

```text
ERROR > WAITING > DONE > WORKING > IDLE
```

`DONE` 是每个来源各自维护的短暂事件。某个来源完成约 3 秒后，只将该来源恢复为 `IDLE`，再重新聚合。因此 DeepSeek 完成而 Codex 仍在工作时，猫会短暂显示 `DONE`，然后恢复 `WORKING`。

## 开发环境启动

要求：macOS、Node.js 20 或更高版本、npm。

```bash
npm install
npm run dev
```

Electron 下载较慢时，可以使用镜像安装依赖：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

生产构建检查：

```bash
npm run build
```

本地生产模式运行：

```bash
npm start
```

当前项目尚未加入正式 `.app` 打包发布流程。登录启动选项只会在正式打包的 macOS 应用中启用，开发模式不会注册登录项。

## 开发状态快捷键

在 `npm run dev` 模式中，点击桌宠让窗口接收键盘事件后，可以使用：

- `1` → `IDLE`
- `2` → `WORKING`
- `3` → `WAITING`
- `4` → `DONE`
- `5` → `ERROR`

这些快捷键只用于本地开发测试。

## 替换猫咪素材

正式状态素材位于：

```text
src/assets/cat/
├── idle.png
├── working.png
├── waiting.png
├── done.png
└── error.png
```

保持文件名不变，直接覆盖对应 PNG 即可。组件使用固定显示区域、`object-fit: contain` 和底部锚点控制视觉稳定性，不会根据原图画布改变 Electron 窗口大小。

状态与图片的集中映射位于 `src/utils/catImageMap.ts`。

## Codex 状态接入

Codex Adapter 位于 `src/adapters/codex/`。Hook 只写入桌宠需要的最小状态：

```text
~/.my-cat-pet/codex-state.json
```

仓库中的 `src/adapters/codex/hooks.json` 是配置示例。使用前需要把其中的 `/absolute/path/to/my-cat-desktop-pet` 替换为本项目在你电脑上的绝对路径，再安全合并到现有 Codex Hook 配置中。

不要直接覆盖已有 Codex 配置；修改前应先备份，并保留现有模型、权限、MCP 和其他 Hook。

状态文件不保存 Prompt、回复正文、代码或聊天记录。

## DeepSeek Harness 状态接入

DeepSeek Adapter 和 Cordis Plugin 位于：

```text
src/adapters/deepseek/
└── harness-plugin/
```

在已安装 DeepSeek Harness 的环境中，可以通过官方插件命令安装本地插件：

```bash
dsh plugin --profile web add ./src/adapters/deepseek/harness-plugin
```

然后将 `src/adapters/deepseek/harness-plugin/cordis.patch.yml` 中的插件插入项安全合并到当前 web profile 的 `cordis.patch.yml`。修改 Harness 配置前请先备份，且不要覆盖已有插件、模型、Provider、权限、Agent、MCP 或 Tools 设置。

插件监听官方生命周期事件，并写入：

```text
~/.my-cat-pet/deepseek-state.json
```

它不会控制 Harness，也不会保存 Prompt、回复、工具参数、代码、聊天记录或凭据。状态写入失败时不会影响 Harness 工作流。

## 项目结构

```text
src/
├── adapters/
│   ├── codex/
│   └── deepseek/
├── animations/
├── assets/cat/
├── components/
│   ├── CatPet/
│   └── PetStatusBubble/
├── electron/
├── state/
├── utils/
├── App.tsx
└── main.tsx
```

关键模块：

- `src/electron/codexStateBridge.ts`：Codex 独立状态文件监听
- `src/electron/deepseekStateBridge.ts`：DeepSeek 独立状态文件监听
- `src/state/stateAggregator.ts`：双来源状态聚合
- `src/components/CatPet/`：猫咪渲染、拖动和轻互动
- `src/components/PetStatusBubble/`：Codex / DeepSeek 共用状态气泡

## 隐私边界

状态桥只保存：来源、状态、会话标识、Turn 标识和更新时间。项目不会保存或上传用户 Prompt、AI 回复、项目代码、完整聊天历史、工具参数或凭据。
