# dkitle

将浏览器中的视频字幕同步显示在桌面置顶窗口中。

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
│   │   ├── bilibili-intercept.js  # bilibili 拦截器
│   │   └── bilibili.js            # bilibili provider
│   ├── popup.html
│   └── popup.js
│
└── dkitle-app/           # Rust 桌面应用 - 接收并置顶显示字幕
    ├── Cargo.toml
    └── src/
        ├── main.rs       # 入口
        ├── server.rs     # WebSocket 服务器 (端口 9877)
        ├── subtitle.rs   # 字幕数据模型
        └── ui.rs         # egui 置顶字幕窗口
```

## 使用方法

### 1. 启动桌面应用

```bash
cd dkitle-app
cargo run
```

应用启动后会：

- 在 `ws://localhost:9877/ws` 开启 WebSocket 服务器
- 显示一个置顶的字幕窗口

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

> **打包发布**（在项目根目录，需要 Python 3）：
>
> ```bash
> ./build.sh all             # Linux/macOS — 打包 Chrome + Firefox .zip
> build.bat all              # Windows
> ```
>
> **调试开发**（输出未压缩目录，可直接在浏览器加载）：
>
> ```bash
> ./build.sh all --dev       # Linux/macOS — 输出 build/chrome/ 和 build/firefox/
> build.bat all --dev        # Windows
> ```
>
> 也可直接调用：`python build.py chrome|firefox|all [--dev]`
>
> - 默认模式：构建产物为 `build/dkitle-chrome.zip` / `build/dkitle-firefox.zip`
> - `--dev` 模式：构建产物为 `build/chrome/` / `build/firefox/` 目录，可直接加载

### 3. 使用

1. 确保 dkitle-app 正在运行
2. 打开 YouTube 或 bilibili 视频并开启字幕
3. 字幕会自动同步显示在桌面置顶窗口中
4. 可通过窗口中的滑块调整字体大小

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
   - MAIN world: `intercept-base.js` -> `example-intercept.js`
   - ISOLATED world: `provider-base.js` -> `example.js`

## 跨平台支持

桌面应用使用 `eframe`/`egui` 构建，支持：

- **Windows** (原生)
- **Linux X11** (原生)
- **Linux Wayland** (通过 winit Wayland 后端)
- **macOS** (原生)
