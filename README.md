# Hound Whiteboard

基于 Tauri 2 的桌面白板应用，采用 Worker 架构分离核心与 UI。

## 架构概述

本项目专注于白板核心引擎与 Tauri 桌面端：

- **Core Worker** — 对象管理、区块系统、层叠图、渲染调度，运行在 Web Worker 中
- **Devices DAG** — 输入设备路由图，将鼠标/键盘/触摸等输入信号路由到对应的工具处理器
- **UI Renderer** — 脏区渲染、位图合成、Overlay UI 渲染
- **Tool System** — 创建、选择、修改、擦除等交互工具

UI Kit 另由 [HoundTek/hound-react-ui-kit](https://github.com/HoundTek/hound-react-ui-kit) 独立开发，使用 Cell DSL 构建 UI，为后续 React UI 迁移做准备。

## 准备工作

确保已安装：

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) ≥ 1.70
- [Tauri CLI](https://v2.tauri.app/)（通过 `cargo install tauri-cli` 或随 `yarn` 自动管理）

## 快速开始

```bash
# 安装 JS 依赖
yarn install

# 生成应用图标（⚠️ 必须先执行这一步）
yarn icon

# 启动开发模式（热更新）
yarn dev
```

> **⚠️ 很重要：`yarn icon` 是构建的前置必要条件。**
>
> Tauri 在编译时会将图标直接嵌入二进制文件，因此图标文件必须在编译前存在。
> 若缺少图标，Rust 编译会在 `tauri::generate_context!()` 处 panic 并失败。
>
> 图标源文件为项目根目录的 `icon.png`，各平台产物由 `tauri icon` 自动生成到 `src-tauri/icons/`。
> 该目录已加入 `.gitignore`，因此新克隆仓库后必须执行 `yarn icon`。

## 可用命令

| 命令               | 说明                               |
| ------------------ | ---------------------------------- |
| `yarn dev`         | Tauri 开发模式（带热更新）         |
| `yarn build`       | 通用生产构建                       |
| `yarn build:mac`   | macOS 构建（dmg + app）            |
| `yarn build:win`   | Windows 构建（nsis + msi）         |
| `yarn build:linux` | Linux 构建（deb + appimage + rpm） |
| `yarn test`        | 运行全部测试                       |
| `yarn bench`       | 运行全部性能基准                   |
| `yarn icon`        | 从 `icon.png` 生成各平台图标       |

## 许可

GNU General Public License v3.0
