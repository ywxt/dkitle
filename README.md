# dkitle

[中文](README.zh.md)

Sync video subtitles from your browser to an always-on-top desktop overlay window.

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

## Usage

### 1. Start the Desktop App

```bash
cd dkitle-app
cargo run
```

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

> **Packaging for release** (from the project root, requires Python 3):
>
> ```bash
> ./build.sh all             # Linux/macOS — build Chrome + Firefox .zip
> build.bat all              # Windows
> ```
>
> **Development build** (outputs uncompressed directory, can be loaded directly in the browser):
>
> ```bash
> ./build.sh all --dev       # Linux/macOS — outputs build/chrome/ and build/firefox/
> build.bat all --dev        # Windows
> ```
>
> You can also call directly: `python build.py chrome|firefox|all [--dev]`
>
> - Default mode: builds `build/dkitle-chrome.zip` / `build/dkitle-firefox.zip`
> - `--dev` mode: builds `build/chrome/` / `build/firefox/` directories that can be loaded directly

### 3. Use

1. Make sure dkitle-app is running
2. Open a YouTube or Bilibili video with subtitles enabled
3. Subtitles will automatically sync to the desktop overlay window
4. The subtitle window is freely resizable — font size adapts automatically to the window dimensions

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

## Cross-Platform Support

The desktop app is built with iced and supports:

- **Windows** (native)
- **Linux X11** (native)
- **Linux Wayland** (via winit Wayland backend)
- **macOS** (native)

## Window Identifiers

| Window          | `app_id` (Wayland)            | Description                        |
| --------------- | ----------------------------- | ---------------------------------- |
| Manager window  | `org.eu.ywxt.dkitle`          | Main window, lists subtitle sources |
| Subtitle window | `org.eu.ywxt.dkitle.subtitle` | Always-on-top subtitle overlay     |

## Wayland Tiling Window Manager Configuration

On Wayland tiling window managers (e.g., Sway, Hyprland), the subtitle window will by default only appear on the current workspace and may be tiled.

The subtitle window's `app_id` is `org.eu.ywxt.dkitle.subtitle`. You can use this to add window rules for floating + sticky (visible on all workspaces).

### Sway

Add to `~/.config/sway/config`:

```
for_window [app_id="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

### Hyprland

Add to `~/.config/hypr/hyprland.conf`:

```
windowrulev2 = float, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
windowrulev2 = pin, class:^(org\.eu\.ywxt\.dkitle\.subtitle)$
```

### i3 (X11)

Add to `~/.config/i3/config`:

```
for_window [class="org.eu.ywxt.dkitle.subtitle"] floating enable, sticky enable
```

### Other Window Managers

Refer to your WM's documentation and use `app_id` (Wayland) or WM_CLASS (X11) to match the subtitle window `org.eu.ywxt.dkitle.subtitle`, then set it to floating + sticky/pin.
