# dkitle

[中文](README.zh.md)

Sync video subtitles from your browser to an always-on-top desktop overlay window.

**Supported Sites:** YouTube, Bilibili

**Supported Platforms:** Windows, Linux (X11/Wayland), macOS

## Usage

### 1. Start the Desktop App

Download the latest release from [GitHub Releases](https://github.com/ywxt/dkitle/releases), or build from source (see below).

Once started, the app will:

- Open a WebSocket server at `ws://localhost:9877/ws`
- Show a manager window listing all subtitle sources

### 2. Install the Browser Extension

#### Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the `dkitle-extension` directory

#### Firefox (128+)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dkitle-extension/manifest.firefox.json`

### 3. Use

1. Make sure dkitle-app is running
2. Open a YouTube or Bilibili video with subtitles enabled
3. Subtitles will automatically sync to the desktop overlay window
4. The subtitle window is freely resizable — font size adapts automatically to the window dimensions

### Window Manager Configuration (Linux)

#### Window Identifiers

| Window          | `app_id` (Wayland)            | Description                         |
| --------------- | ----------------------------- | ----------------------------------- |
| Manager window  | `org.eu.ywxt.dkitle`          | Main window, lists subtitle sources |
| Subtitle window | `org.eu.ywxt.dkitle.subtitle` | Always-on-top subtitle overlay      |

#### Wayland Tiling Window Managers

On Wayland tiling window managers (e.g., Sway, Hyprland), the subtitle window will by default only appear on the current workspace and may be tiled. Use the `app_id` `org.eu.ywxt.dkitle.subtitle` to add window rules for floating + sticky.

**Sway** (`~/.config/sway/config`):

```
for_window [app_id="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

**Hyprland** (`~/.config/hypr/hyprland.conf`):

```
windowrulev2 = float, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
windowrulev2 = pin, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
```

**i3 (X11)** (`~/.config/i3/config`):

```
for_window [class="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

For other window managers, refer to your WM's documentation and use `app_id` (Wayland) or WM_CLASS (X11) to match the subtitle window `org.eu.ywxt.dkitle.subtitle`, then set it to floating + sticky/pin.

## Building from Source

### Desktop App

#### Requirements

- **Rust** (latest stable)
- Platform-specific dependencies for [iced](https://github.com/iced-rs/iced)

#### Build

```bash
cd dkitle-app
cargo build --release
# Output: dkitle-app/target/release/dkitle-app
```

Or run directly:

```bash
cd dkitle-app
cargo run
```

### Browser Extension

#### Requirements

- **Python 3.6+** (standard library only, no third-party packages needed)
- **Operating System**: Windows, Linux, or macOS

The browser extension is pure JavaScript — no npm, Node.js, or bundler is required.

#### Build

```bash
# Build the Firefox extension
python build.py firefox
# Output: build/dkitle-firefox.zip

# Build the Chrome extension
python build.py chrome
# Output: build/dkitle-chrome.zip

# Build both at once
python build.py all
# Output: build/dkitle-chrome.zip and build/dkitle-firefox.zip

# Development build (uncompressed directory, can be loaded directly)
python build.py all --dev
# Output: build/chrome/ and build/firefox/
```

The build script (`build.py`) copies the extension source files and the appropriate manifest (`manifest.firefox.json` for Firefox, `manifest.json` for Chrome) into a zip archive. No compilation, transpilation, or minification is performed — the output zip contains the exact same JavaScript source files as in the repository.

Wrapper scripts are also available: `./build.sh` (Linux/macOS) and `build.bat` (Windows).

## Project Structure

```text
dkitle/
├── build.py                      # Extension build script (cross-platform, Python 3)
├── build.sh                      # Linux/macOS wrapper
├── build.bat                     # Windows wrapper
├── dkitle-extension/    # Browser extension — extracts subtitles from web pages (Chrome / Firefox)
│   ├── manifest.json             # Chrome manifest (MV3)
│   ├── manifest.firefox.json     # Firefox manifest (MV3, Gecko)
│   ├── background.js             # WebSocket connection management
│   ├── providers/
│   │   ├── intercept-base.js      # Shared network interceptor base (MAIN world)
│   │   ├── provider-base.js       # Shared provider base (ISOLATED world)
│   │   ├── youtube-intercept.js   # YouTube interceptor
│   │   ├── youtube.js             # YouTube provider
│   │   ├── bilibili-intercept.js  # Bilibili interceptor
│   │   └── bilibili.js            # Bilibili provider
│   ├── popup.html
│   └── popup.js
│
└── dkitle-app/           # Rust desktop app — receives and displays subtitles in an overlay
    ├── Cargo.toml
    └── src/
        ├── main.rs       # Entry point
        ├── server.rs     # WebSocket server (port 9877)
        ├── subtitle.rs   # Subtitle data model
        └── ui.rs         # iced always-on-top subtitle window
```

## Provider Architecture

The extension abstracts provider capabilities into two shared layers:

1. **intercept-base (MAIN world)**
   - Unified hooks for `fetch` and `XMLHttpRequest`
   - Site-specific interceptors only need to register: URL matching + response parsing logic
2. **provider-base (ISOLATED world)**
   - Unified subtitle forwarding, deduplication, and `timeupdate` cue alignment
   - Built-in DOM observation and polling fallback

Site implementations only contain site-specific logic (selectors, response parsers), making it easy to add support for more websites.

## Adding New Subtitle Sources

Create two new files under `dkitle-extension/providers/`, e.g., `example-intercept.js` and `example.js`:

1. In `example-intercept.js`, call `window.__dkitleRegisterInterceptor(...)`
2. In `example.js`, call `window.__dkitleCreateProvider(...)`
3. Register the corresponding site injection order in `manifest.json` and `manifest.firefox.json` under `content_scripts`:
   - MAIN world: `intercept-base.js` → `example-intercept.js`
   - ISOLATED world: `provider-base.js` → `example.js`
