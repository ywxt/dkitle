# dkitle

[中文](README.zh.md)

Sync video subtitles from your browser to an always-on-top desktop overlay window.

**Supported Sites:** YouTube, Bilibili

**Supported Platforms:** Windows, Linux (X11/Wayland), macOS

## Screenshots

|            Main Window             |        Chrome Extension         |
| :--------------------------------: | :-----------------------------: |
| ![Main Window](imgs/main-view.png) | ![Chrome](imgs/chrome-view.png) |

|           YouTube Subtitles            |               Bilibili Video               |                 Bilibili Subtitles                 |
| :------------------------------------: | :----------------------------------------: | :------------------------------------------------: |
| ![YouTube](imgs/youtube-main-view.png) | ![Bilibili Video](imgs/bilibili-video.png) | ![Bilibili Subtitles](imgs/bilibili-subtitles.png) |

## Usage

### 1. Start the Desktop App

Download the latest release from [GitHub Releases](https://github.com/ywxt/dkitle/releases), or build from source (see below).

Once started, the app will:

- Open a WebSocket server at `ws://localhost:9877/ws`
- Show a manager window listing all subtitle sources

### 2. Install the Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) in your browser
2. [Click here to install dkitle.user.js](https://greasyfork.org/en/scripts/568843-dkitle-subtitle-sync)
3. Confirm the installation in your userscript manager

> Works across all browsers (Chrome, Firefox, Edge, Safari) with no store review required.

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

### Requirements

- **Rust** (latest stable)
- **Python 3.6+** (for icon generation and packaging, standard library only)
- Platform-specific dependencies for [iced](https://github.com/iced-rs/iced)

### Build

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

### Package for Release

```bash
# Generate icons (required before first build)
python scripts/generate_icons.py

# Package for current platform
python build.py package

# Package for a specific target
python build.py package --target x86_64-unknown-linux-gnu
```

## Project Structure

```text
dkitle/
├── dkitle.user.js           # Userscript — subtitle interception & sync (Tampermonkey/Violentmonkey)
├── build.py                 # Desktop app packaging script (cross-platform, Python 3)
├── build.sh                 # Build script (Linux/macOS)
├── build.bat                # Build script (Windows)
├── scripts/
│   └── generate_icons.py    # Icon generation (PNG, ICO, ICNS)
│
└── dkitle-app/              # Rust desktop app — receives and displays subtitles in an overlay
    ├── Cargo.toml
    ├── build.rs
    ├── assets/
    │   ├── icon.png
    │   ├── icon.ico
    │   ├── dkitle.desktop
    │   └── macos/
    │       ├── Info.plist
    │       └── AppIcon.icns
    └── src/
        ├── main.rs          # Entry point
        ├── server.rs        # WebSocket server (port 9877)
        ├── subtitle.rs      # Subtitle data model
        └── ui.rs            # iced always-on-top subtitle window
```

## Adding New Subtitle Sites

To add support for a new video site, edit `dkitle.user.js`:

1. Add a `@match` rule in the userscript header
2. Add a new entry to the `SITES` array with:
   - `name` — site identifier
   - `urlMatch` — regex to match video page URLs (used for video sync registration)
   - `interceptUrlTest` — function to match subtitle API URLs
   - `parseResponse` — function to parse subtitle data into `{ start_ms, end_ms, text }` cues
3. Add the hostname detection in the `detectSite()` function
