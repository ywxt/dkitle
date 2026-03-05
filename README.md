# dkitle

将浏览器中的视频字幕同步显示在桌面置顶窗口中。

## 项目结构

```text
dkitle/
├── dkitle-extension/    # Chrome 扩展 - 从网页提取字幕
│   ├── manifest.json
│   ├── background.js     # WebSocket 连接管理
│   ├── providers/
│   │   └── youtube.js    # YouTube 字幕提取
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

### 2. 安装 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `dkitle-extension` 目录

### 3. 使用

1. 确保 dkitle-app 正在运行
2. 打开 YouTube 视频并开启字幕
3. 字幕会自动同步显示在桌面置顶窗口中
4. 可通过窗口中的滑块调整字体大小

## 添加新的字幕来源

在 `dkitle-extension/providers/` 下新增 JS 文件，例如 `bilibili.js`：

1. 编写 content script 监听对应网站的字幕元素
2. 通过 `chrome.runtime.sendMessage` 发送统一格式的消息：

   ```js
   chrome.runtime.sendMessage({
     type: "subtitle",
     provider: "bilibili",
     text: "字幕内容"
   });
   ```

3. 在 `manifest.json` 的 `content_scripts` 中注册：

   ```json
   {
     "matches": ["*://*.bilibili.com/*"],
     "js": ["providers/bilibili.js"],
     "run_at": "document_idle"
   }
   ```

## 跨平台支持

桌面应用使用 `eframe`/`egui` 构建，支持：

- **Windows** (原生)
- **Linux X11** (原生)
- **Linux Wayland** (通过 winit Wayland 后端)
- **macOS** (原生)
