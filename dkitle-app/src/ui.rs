use iced::widget::{button, column, container, row, scrollable, text};
use iced::window;
use iced::{Element, Length, Size, Subscription, Task, Theme};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::subtitle::{Provider, SubtitleCue, SubtitleMessage};

/// Messages for the iced application
#[derive(Debug, Clone)]
pub enum Message {
    /// High-frequency tick (~16ms) to update subtitle display based on estimated video time
    Tick,
    /// Open a subtitle overlay window for a source
    OpenSubtitleWindow(String),
    /// A window was closed — clean up state
    WindowClosed(window::Id),
    /// Window was resized — track new size
    WindowResized(window::Id, Size),
}

/// Represents a subtitle source (one per browser tab)
struct SubtitleSource {
    provider: Provider,
    tab_title: String,
    /// All subtitle cues for this source (sorted by start_ms)
    cues: Vec<SubtitleCue>,
    /// Last synced video time in milliseconds
    sync_video_time_ms: f64,
    /// Local Instant when we received the last sync
    sync_instant: Instant,
    /// Whether the video is currently playing
    playing: bool,
    /// Video playback rate (e.g. 0.5, 1.0, 1.5, 2.0)
    playback_rate: f64,
    /// Currently displayed subtitle text (cached to avoid unnecessary redraws)
    current_text: String,
    /// Whether this source is still active (false after tab close/refresh)
    active: bool,
}

impl SubtitleSource {
    /// Estimate the current video playback time in milliseconds.
    fn estimated_time_ms(&self) -> f64 {
        if self.playing {
            let elapsed = self.sync_instant.elapsed().as_secs_f64() * 1000.0;
            self.sync_video_time_ms + elapsed * self.playback_rate
        } else {
            self.sync_video_time_ms
        }
    }

    /// Find the subtitle cue active at the given time using binary search.
    /// If the current time falls in a gap between two cues, keep showing
    /// the previous cue until the next one starts (avoids flickering).
    fn find_cue_at(&self, time_ms: f64) -> Option<&SubtitleCue> {
        // Binary search for the last cue whose start_ms <= time_ms
        let idx = self.cues.partition_point(|cue| cue.start_ms <= time_ms);
        if idx == 0 {
            return None;
        }
        let cue = &self.cues[idx - 1];
        if time_ms < cue.end_ms {
            // Within the cue's time range
            Some(cue)
        } else if idx < self.cues.len() {
            // In the gap between this cue and the next — keep showing current
            Some(cue)
        } else {
            // After the very last cue — nothing to show
            None
        }
    }

    /// Update the current displayed text based on estimated time.
    /// Returns true if text changed.
    fn update_current_text(&mut self) -> bool {
        let time_ms = self.estimated_time_ms();
        let new_text = match self.find_cue_at(time_ms) {
            Some(cue) => cue.text.clone(),
            None => String::new(),
        };
        if new_text != self.current_text {
            self.current_text = new_text;
            true
        } else {
            false
        }
    }
}

/// The main subtitle application with multi-window support.
///
/// Uses `iced::daemon` (multi-window mode):
/// - Manager window: lists all subtitle sources, each with an "Open" button
/// - Subtitle windows: always-on-top overlay windows, one per source
pub struct SubtitleApp {
    subtitle_rx: tokio::sync::mpsc::UnboundedReceiver<SubtitleMessage>,
    /// Shutdown signal sender for the WebSocket server
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    /// ID of the manager (main) window
    main_window_id: window::Id,
    /// All known subtitle sources: source_id → SubtitleSource
    sources: HashMap<String, SubtitleSource>,
    /// Opened subtitle overlay windows: window_id → source_id
    subtitle_windows: HashMap<window::Id, String>,
    /// Per-window tracked size
    window_sizes: HashMap<window::Id, Size>,
}

const DEFAULT_SUBTITLE_WIDTH: f32 = 600.0;
const DEFAULT_SUBTITLE_HEIGHT: f32 = 140.0;
const MIN_FONT_SIZE: f32 = 10.0;
const MAX_FONT_SIZE: f32 = 120.0;
/// Padding on each side of the subtitle window
const SUBTITLE_PADDING: f32 = 16.0;
/// Vertical space used by provider label + spacing (no slider anymore)
const SUBTITLE_OVERHEAD_HEIGHT: f32 = 30.0;

impl SubtitleApp {
    pub fn new(
        subtitle_rx: tokio::sync::mpsc::UnboundedReceiver<SubtitleMessage>,
        shutdown_tx: tokio::sync::watch::Sender<bool>,
    ) -> (Self, Task<Message>) {
        let (main_id, open_task) = window::open(manager_window_settings());
        let app = Self {
            subtitle_rx,
            shutdown_tx,
            main_window_id: main_id,
            sources: HashMap::new(),
            subtitle_windows: HashMap::new(),
            window_sizes: HashMap::new(),
        };
        (app, open_task.discard())
    }

    // ── title / theme (per window) ─────────────────────

    pub fn title(&self, window_id: window::Id) -> String {
        if window_id == self.main_window_id {
            return String::from("dkitle");
        }
        if let Some(source_id) = self.subtitle_windows.get(&window_id) {
            if let Some(source) = self.sources.get(source_id) {
                if source.tab_title.is_empty() {
                    return format!("[dkitle-subtitle] {}", source.provider);
                } else {
                    return format!(
                        "[dkitle-subtitle] {} — {}",
                        source.provider, source.tab_title
                    );
                }
            }
        }
        String::from("[dkitle-subtitle]")
    }

    pub fn theme(&self, window_id: window::Id) -> Theme {
        if window_id == self.main_window_id {
            Theme::Light
        } else {
            Theme::Dark
        }
    }

    // ── update ─────────────────────────────────────────

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Tick => {
                // Drain all pending subtitle messages from the channel
                while let Ok(msg) = self.subtitle_rx.try_recv() {
                    self.handle_subtitle_message(msg);
                }

                // Update current subtitle text for all sources based on estimated time
                for source in self.sources.values_mut() {
                    source.update_current_text();
                }
            }

            Message::OpenSubtitleWindow(source_id) => {
                // Don't open twice for the same source
                if self.subtitle_windows.values().any(|sid| sid == &source_id) {
                    return Task::none();
                }
                let (id, open_task) = window::open(subtitle_window_settings());
                self.subtitle_windows.insert(id, source_id);
                return open_task.discard();
            }

            Message::WindowClosed(id) => {
                if id == self.main_window_id {
                    // Signal the server to shut down gracefully
                    let _ = self.shutdown_tx.send(true);
                    // Close the main window first, then exit the daemon
                    return window::close(id).chain(iced::exit());
                } else {
                    // Subtitle window closed → remove from tracking and actually close it
                    self.subtitle_windows.remove(&id);
                    self.window_sizes.remove(&id);
                    return window::close(id);
                }
            }

            Message::WindowResized(id, size) => {
                self.window_sizes.insert(id, size);
            }
        }
        Task::none()
    }

    fn handle_subtitle_message(&mut self, msg: SubtitleMessage) {
        match msg {
            SubtitleMessage::Cues {
                provider,
                source_id,
                tab_title,
                mut cues,
            } => {
                // Sort cues by start time for binary search
                cues.sort_by(|a, b| a.start_ms.partial_cmp(&b.start_ms).unwrap());

                let source = self
                    .sources
                    .entry(source_id)
                    .or_insert_with(|| SubtitleSource {
                        provider: provider.clone(),
                        tab_title: String::new(),
                        cues: Vec::new(),
                        sync_video_time_ms: 0.0,
                        sync_instant: Instant::now(),
                        playing: false,
                        playback_rate: 1.0,
                        current_text: String::new(),
                        active: true,
                    });
                source.cues = cues;
                source.provider = provider;
                source.active = true; // reactivate if it was deactivated
                if !tab_title.is_empty() {
                    source.tab_title = tab_title;
                }
            }
            SubtitleMessage::Sync {
                source_id,
                video_time_ms,
                playing,
                playback_rate,
                timestamp,
            } => {
                if let Some(source) = self.sources.get_mut(&source_id) {
                    // Compensate for transmission delay:
                    // The sender recorded Date.now() as `timestamp`.
                    // We compare with our own system time to estimate transit delay.
                    let now_epoch_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let transit_delay_ms = now_epoch_ms.saturating_sub(timestamp) as f64;

                    // Adjust synced time forward by transit delay if playing
                    let adjusted_time = if playing {
                        video_time_ms + transit_delay_ms
                    } else {
                        video_time_ms
                    };

                    source.sync_video_time_ms = adjusted_time;
                    source.sync_instant = Instant::now();
                    source.playing = playing;
                    source.playback_rate = playback_rate;

                    // Immediately update displayed text on sync
                    source.update_current_text();
                }
            }
            SubtitleMessage::Deactivate { source_id } => {
                if let Some(source) = self.sources.get_mut(&source_id) {
                    source.active = false;
                    source.playing = false;
                    source.current_text = String::new();
                }
            }
        }
    }

    // ── view (per window) ──────────────────────────────

    pub fn view(&self, window_id: window::Id) -> Element<'_, Message> {
        if window_id == self.main_window_id {
            self.view_manager()
        } else {
            self.view_subtitle(window_id)
        }
    }

    /// Management window: lists all active subtitle sources
    fn view_manager(&self) -> Element<'_, Message> {
        let title_row = text("dkitle").size(20);

        if self.sources.is_empty() {
            let content = column![
                title_row,
                text("Waiting for subtitle sources...")
                    .size(14)
                    .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            ]
            .spacing(12)
            .padding(16);

            return container(content)
                .width(Length::Fill)
                .height(Length::Fill)
                .into();
        }

        let mut list = column![].spacing(4);

        for (source_id, source) in &self.sources {
            let is_open = self.subtitle_windows.values().any(|sid| sid == source_id);

            // Colors depend on active state
            let label_color = if source.active {
                iced::Color::BLACK
            } else {
                iced::Color::from_rgb(0.7, 0.7, 0.7)
            };
            let status_color = if source.active {
                iced::Color::from_rgb(0.4, 0.4, 0.4)
            } else {
                iced::Color::from_rgb(0.75, 0.75, 0.75)
            };

            // Provider + tab title label
            let label = if source.tab_title.is_empty() {
                format!("📺 {}", source.provider)
            } else {
                format!("📺 {} — {}", source.provider, source.tab_title)
            };

            // Status info
            let status = if !source.active {
                "Inactive".to_string()
            } else if source.cues.is_empty() {
                "No cues".to_string()
            } else {
                let playing_str = if source.playing { "▶" } else { "⏸" };
                format!("{} {} cues", playing_str, source.cues.len())
            };

            // Subtitle text preview (truncated)
            let preview = truncate_str(&source.current_text, 50);

            let info_col = column![
                text(label).size(13).color(label_color),
                text(status).size(11).color(status_color),
                text(preview)
                    .size(11)
                    .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            ]
            .spacing(2)
            .width(Length::Fill);

            // Open / Opened / Inactive button
            let btn = if !source.active {
                // Inactive source: disabled button
                button(text("Inactive").size(11))
            } else if is_open {
                button(text("Opened").size(11))
            } else {
                button(text("Open").size(11))
                    .on_press(Message::OpenSubtitleWindow(source_id.clone()))
            };

            let entry = row![info_col, btn]
                .align_y(iced::Alignment::Center)
                .spacing(8);

            list = list.push(entry);
            list = list.push(container(text("")).width(Length::Fill).height(1).style(
                |_theme: &Theme| container::Style {
                    background: Some(iced::Background::Color(iced::Color::from_rgb(
                        0.85, 0.85, 0.85,
                    ))),
                    ..Default::default()
                },
            ));
        }

        let content = column![
            title_row,
            text(format!("{} source(s)", self.sources.len()))
                .size(12)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            scrollable(list).height(Length::Fill),
        ]
        .spacing(8)
        .padding(16);

        container(content)
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
    }

    /// Subtitle overlay window: shows subtitles for one specific source.
    /// Font size is determined entirely by window size.
    fn view_subtitle(&self, window_id: window::Id) -> Element<'_, Message> {
        let (provider_str, subtitle_str) =
            if let Some(source_id) = self.subtitle_windows.get(&window_id) {
                if let Some(source) = self.sources.get(source_id) {
                    let label = if source.tab_title.is_empty() {
                        format!("📺 {}", source.provider)
                    } else {
                        format!("📺 {} — {}", source.provider, source.tab_title)
                    };
                    (label, source.current_text.as_str())
                } else {
                    (String::from("📺"), "Waiting...")
                }
            } else {
                (String::from("📺"), "Waiting...")
            };

        let window_size = self
            .window_sizes
            .get(&window_id)
            .copied()
            .unwrap_or(Size::new(DEFAULT_SUBTITLE_WIDTH, DEFAULT_SUBTITLE_HEIGHT));

        // Compute font size from window height, then shrink if text wraps
        let effective_font_size = auto_font_size(subtitle_str, &window_size);

        let provider_label = text(provider_str)
            .size(12)
            .color(iced::Color::from_rgb(0.6, 0.6, 0.6));

        let subtitle_text = text(subtitle_str)
            .size(effective_font_size)
            .color(iced::Color::WHITE);

        let content = column![provider_label, subtitle_text]
            .spacing(4)
            .align_x(iced::Alignment::Center);

        container(content)
            .width(Length::Fill)
            .height(Length::Fill)
            .center_x(Length::Fill)
            .center_y(Length::Fill)
            .padding(16)
            .style(|_theme: &Theme| container::Style {
                background: Some(iced::Background::Color(iced::Color::from_rgba(
                    0.08, 0.08, 0.08, 0.85,
                ))),
                ..Default::default()
            })
            .into()
    }

    // ── subscription ───────────────────────────────────

    pub fn subscription(&self) -> Subscription<Message> {
        // High-frequency tick for smooth subtitle updates (~60fps)
        let tick = iced::time::every(Duration::from_millis(16)).map(|_| Message::Tick);

        Subscription::batch([
            tick,
            window::close_events().map(Message::WindowClosed),
            window::resize_events().map(|(id, size)| Message::WindowResized(id, size)),
        ])
    }
}

/// Manager window settings (normal window)
fn manager_window_settings() -> window::Settings {
    window::Settings {
        size: iced::Size::new(420.0, 340.0),
        ..Default::default()
    }
}

/// Subtitle overlay window settings (always-on-top, with distinctive app_id for WM rules)
fn subtitle_window_settings() -> window::Settings {
    window::Settings {
        size: iced::Size::new(600.0, 140.0),
        level: window::Level::AlwaysOnTop,
        decorations: true,
        resizable: true,
        #[cfg(target_os = "linux")]
        platform_specific: window::settings::PlatformSpecific {
            application_id: String::from("dkitle-subtitle"),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Truncate a string to at most `max_chars` characters, appending "…" if truncated.
fn truncate_str(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = chars[..max_chars].iter().collect();
        format!("{}…", truncated)
    }
}

/// Estimate character width at a given font size.
/// CJK characters are roughly square (width ≈ font_size),
/// Latin/ASCII characters are roughly half-width (width ≈ font_size * 0.55).
fn char_width(ch: char, font_size: f32) -> f32 {
    if is_cjk(ch) {
        font_size
    } else {
        font_size * 0.55
    }
}

/// Check if a character is CJK (fullwidth).
fn is_cjk(ch: char) -> bool {
    let c = ch as u32;
    // CJK Unified Ideographs, Hiragana, Katakana, Hangul, Fullwidth forms, etc.
    matches!(c,
        0x2E80..=0x9FFF |
        0xF900..=0xFAFF |
        0xFE30..=0xFE4F |
        0xFF00..=0xFFEF |
        0x20000..=0x2FA1F |
        0x30000..=0x3134F |
        0xAC00..=0xD7AF
    )
}

/// Estimate the total display lines a text will need at a given font size,
/// considering window width and character widths.
fn estimate_display_lines(s: &str, font_size: f32, available_width: f32) -> f32 {
    if s.is_empty() || available_width <= 0.0 || font_size <= 0.0 {
        return 1.0;
    }

    let mut total_lines: f32 = 0.0;
    for line in s.lines() {
        if line.is_empty() {
            total_lines += 1.0;
            continue;
        }
        let mut line_width: f32 = 0.0;
        let mut lines_for_segment: f32 = 1.0;
        for ch in line.chars() {
            let w = char_width(ch, font_size);
            line_width += w;
            if line_width > available_width {
                lines_for_segment += 1.0;
                line_width = w; // wrap: this char starts next line
            }
        }
        total_lines += lines_for_segment;
    }
    total_lines
}

/// Check whether the text fits within the window at the given font size,
/// accounting for line wrapping (smaller font → narrower chars → fewer wraps).
fn text_fits(s: &str, font_size: f32, available_width: f32, available_height: f32) -> bool {
    let line_height_factor = 1.35;
    let lines = estimate_display_lines(s, font_size, available_width);
    let needed_height = lines * font_size * line_height_factor;
    needed_height <= available_height
}

/// Calculate the font size automatically from window size.
/// Uses binary search to find the largest font size where the text
/// (including line wrapping) fits within the available area.
fn auto_font_size(s: &str, window_size: &Size) -> f32 {
    let available_width = (window_size.width - SUBTITLE_PADDING * 2.0).max(50.0);
    let available_height = (window_size.height - SUBTITLE_OVERHEAD_HEIGHT).max(20.0);

    if s.is_empty() {
        // No text: use max font that fits a single line
        let line_height_factor = 1.35;
        return (available_height / line_height_factor).clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
    }

    // Binary search for the largest font size that fits
    let mut lo = MIN_FONT_SIZE;
    let mut hi = MAX_FONT_SIZE;

    // First check: does MIN_FONT_SIZE even fit?
    if !text_fits(s, lo, available_width, available_height) {
        return MIN_FONT_SIZE;
    }

    // Binary search (precision ~0.5px)
    while (hi - lo) > 0.5 {
        let mid = (lo + hi) / 2.0;
        if text_fits(s, mid, available_width, available_height) {
            lo = mid; // fits → try larger
        } else {
            hi = mid; // doesn't fit → try smaller
        }
    }

    lo.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE)
}
