# dkitle

[English](README.md)

将浏览器中的视频字幕同步显示在桌面置顶窗口中。

**支持站点：** YouTube、Bilibili

**支持平台：** Windows、Linux（X11/Wayland）、macOS

## 使用方法

### 1. 启动桌面应用

从 [GitHub Releases](https://github.com/ywxt/dkitle/releases) 下载最新版本，或从源码构建（见下方）。

应用启动后会：

- 在 `ws://localhost:9877/ws` 开启 WebSocket 服务器
- 显示一个管理窗口，列出所有字幕来源

### 2. 安装浏览器扩展

#### Chrome

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `dkitle-extension` 目录

#### Firefox（128+）

1. 打开 Firefox，访问 `about:debugging#/runtime/this-firefox`
2. 点击 **加载临时附加组件**
3. 选择 `dkitle-extension/manifest.firefox.json`

### 3. 使用

1. 确保 dkitle-app 正在运行
2. 打开 YouTube 或 Bilibili 视频并开启字幕
3. 字幕会自动同步显示在桌面置顶窗口中
4. 字幕窗口可自由调整大小，字体会根据窗口尺寸自动适应

### 窗口管理器配置（Linux）

#### 窗口标识

| 窗口     | `app_id`（Wayland）           | 说明                 |
| -------- | ----------------------------- | -------------------- |
| 管理窗口 | `org.eu.ywxt.dkitle`          | 主窗口，列出字幕来源 |
| 字幕窗口 | `org.eu.ywxt.dkitle.subtitle` | 置顶字幕叠加窗口     |

#### Wayland 平铺窗口管理器

在 Wayland 平铺窗口管理器（如 Sway、Hyprland）中，字幕窗口默认只会在当前工作区显示，且可能被平铺管理。使用 `app_id` `org.eu.ywxt.dkitle.subtitle` 添加窗口规则实现浮动 + 置顶。

**Sway**（`~/.config/sway/config`）：

```
for_window [app_id="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

**Hyprland**（`~/.config/hypr/hyprland.conf`）：

```
windowrulev2 = float, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
windowrulev2 = pin, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
```

**i3（X11）**（`~/.config/i3/config`）：

```
for_window [class="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

其他窗口管理器请参考相应文档，使用 `app_id`（Wayland）或 WM_CLASS（X11）匹配字幕窗口 `org.eu.ywxt.dkitle.subtitle`，并设置为浮动 + 固定（sticky/pin）。

## 从源码构建

### 桌面应用

#### 系统要求

- **Rust**（最新稳定版）
- [iced](https://github.com/iced-rs/iced) 所需的平台依赖

#### 构建

```bash
cd dkitle-app
cargo build --release
# 输出：dkitle-app/target/release/dkitle-app
```

或直接运行：

```bash
cd dkitle-app
cargo run
```

### 浏览器扩展

#### 系统要求

- **Python 3.6+**（仅使用标准库，无需安装第三方包）
- **操作系统**：Windows、Linux 或 macOS

浏览器扩展为纯 JavaScript，不需要 npm、Node.js 或任何打包工具。

#### 构建

```bash
# 构建 Firefox 扩展
python build.py firefox
# 输出：build/dkitle-firefox.zip

# 构建 Chrome 扩展
python build.py chrome
# 输出：build/dkitle-chrome.zip

# 同时构建两者
python build.py all
# 输出：build/dkitle-chrome.zip 和 build/dkitle-firefox.zip

# 开发构建（输出未压缩目录，可直接在浏览器加载）
python build.py all --dev
# 输出：build/chrome/ 和 build/firefox/
```

构建脚本（`build.py`）将扩展源文件和对应的 manifest（Firefox 使用 `manifest.firefox.json`，Chrome 使用 `manifest.json`）打包为 zip 文件。不进行任何编译、转译或压缩 — 输出的 zip 包含与仓库中完全相同的 JavaScript 源文件。

也可使用封装脚本：`./build.sh`（Linux/macOS）和 `build.bat`（Windows）。

## 项目结构

```text
dkitle/
├── build.py                      # 扩展构建脚本（跨平台，Python 3）
├── build.sh                      # Linux/macOS wrapper
├── build.bat                     # Windows wrapper
├── dkitle-extension/    # 浏览器扩展 - 从网页提取字幕（支持 Chrome / Firefox）
│   ├── manifest.json             # Chrome manifest (MV3)
│   ├── manifest.firefox.json     # Firefox manifest (MV3, Gecko)
│   ├── background.js             # WebSocket 连接管理
│   ├── providers/
│   │   ├── intercept-base.js      # 公共网络拦截基础层（MAIN world）
│   │   ├── provider-base.js       # 公共 provider 基础层（ISOLATED world）
│   │   ├── youtube-intercept.js   # YouTube 拦截器
│   │   ├── youtube.js             # YouTube provider
│   │   ├── bilibili-intercept.js  # Bilibili 拦截器
│   │   └── bilibili.js            # Bilibili provider
│   ├── popup.html
│   └── popup.js
│
└── dkitle-app/           # Rust 桌面应用 - 接收并置顶显示字幕
    ├── Cargo.toml
    └── src/
        ├── main.rs       # 入口
        ├── server.rs     # WebSocket 服务器（端口 9877）
        ├── subtitle.rs   # 字幕数据模型
        └── ui.rs         # iced 置顶字幕窗口
```

## Provider 架构说明

扩展已将 provider 能力抽象为两层公共接口：

1. **intercept-base（MAIN world）**
   - 统一 hook `fetch` 与 `XMLHttpRequest`
   - 站点 intercept 仅需注册：URL 匹配 + 响应解析逻辑
2. **provider-base（ISOLATED world）**
   - 统一处理字幕发送、去重、`timeupdate` cue 对齐
   - 内置 DOM 观察与轮询兜底

站点实现只保留差异逻辑（选择器、响应解析器），便于继续扩展更多网站。

## 添加新的字幕来源

在 `dkitle-extension/providers/` 下新增两个文件，例如 `example-intercept.js` 与 `example.js`：

1. 在 `example-intercept.js` 中调用 `window.__dkitleRegisterInterceptor(...)`
2. 在 `example.js` 中调用 `window.__dkitleCreateProvider(...)`
3. 在 `manifest.json` 和 `manifest.firefox.json` 的 `content_scripts` 中注册对应站点注入顺序：
   - MAIN world: `intercept-base.js` → `example-intercept.js`
   - ISOLATED world: `provider-base.js` → `example.js`
