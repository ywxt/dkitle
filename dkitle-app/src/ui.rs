use iced::widget::{button, column, container, horizontal_rule, row, scrollable, slider, text};
use iced::window;
use iced::{Element, Length, Subscription, Task, Theme};
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::subtitle::{Provider, SubtitleMessage};

/// Messages for the iced application
#[derive(Debug, Clone)]
pub enum Message {
    /// Tick to poll subtitle channel and clean up stale sources
    Tick,
    /// Open a subtitle overlay window for a source
    OpenSubtitleWindow(String),
    /// A window was closed — clean up state
    WindowClosed(window::Id),
    /// Font size changed for a subtitle window
    FontSizeChanged(window::Id, f32),
}

/// Represents a subtitle source (one per browser tab)
struct SubtitleSource {
    provider: Provider,
    text: String,
    tab_title: String,
    last_update: Instant,
}

/// The main subtitle application with multi-window support.
///
/// Uses `iced::daemon` (multi-window mode):
/// - Manager window: lists all subtitle sources, each with an "Open" button
/// - Subtitle windows: always-on-top overlay windows, one per source
pub struct SubtitleApp {
    subtitle_rx: mpsc::Receiver<SubtitleMessage>,
    /// ID of the manager (main) window
    main_window_id: window::Id,
    /// All known subtitle sources: source_id → SubtitleSource
    sources: HashMap<String, SubtitleSource>,
    /// Opened subtitle overlay windows: window_id → source_id
    subtitle_windows: HashMap<window::Id, String>,
    /// Per-window font size
    font_sizes: HashMap<window::Id, f32>,
}

const SOURCE_INACTIVE_SECS: u64 = 30;
const DEFAULT_FONT_SIZE: f32 = 28.0;

impl SubtitleApp {
    pub fn new(subtitle_rx: mpsc::Receiver<SubtitleMessage>) -> (Self, Task<Message>) {
        let (main_id, open_task) = window::open(manager_window_settings());
        let app = Self {
            subtitle_rx,
            main_window_id: main_id,
            sources: HashMap::new(),
            subtitle_windows: HashMap::new(),
            font_sizes: HashMap::new(),
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
                    return format!("dkitle - {}", source.provider);
                } else {
                    return format!("dkitle - {}", source.tab_title);
                }
            }
        }
        String::from("dkitle")
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
                // Drain all pending subtitle messages
                while let Ok(msg) = self.subtitle_rx.try_recv() {
                    let source_id = msg.source_id.clone();

                    let source = self
                        .sources
                        .entry(source_id)
                        .or_insert_with(|| SubtitleSource {
                            provider: msg.provider.clone(),
                            text: String::new(),
                            tab_title: String::new(),
                            last_update: Instant::now(),
                        });
                    source.text = msg.text;
                    source.provider = msg.provider;
                    if !msg.tab_title.is_empty() {
                        source.tab_title = msg.tab_title;
                    }
                    source.last_update = Instant::now();
                }
            }

            Message::OpenSubtitleWindow(source_id) => {
                // Don't open twice for the same source
                if self.subtitle_windows.values().any(|sid| sid == &source_id) {
                    return Task::none();
                }
                let (id, open_task) = window::open(subtitle_window_settings());
                self.subtitle_windows.insert(id, source_id);
                self.font_sizes.insert(id, DEFAULT_FONT_SIZE);
                return open_task.discard();
            }

            Message::WindowClosed(id) => {
                if id == self.main_window_id {
                    // Close the main window first, then exit the daemon
                    return window::close(id).chain(iced::exit());
                } else {
                    // Subtitle window closed → remove from tracking and actually close it
                    self.subtitle_windows.remove(&id);
                    self.font_sizes.remove(&id);
                    return window::close(id);
                }
            }

            Message::FontSizeChanged(window_id, size) => {
                self.font_sizes.insert(window_id, size);
            }
        }
        Task::none()
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

        // Sort sources: most recently updated first
        let mut sorted: Vec<(&String, &SubtitleSource)> = self.sources.iter().collect();
        sorted.sort_by(|a, b| b.1.last_update.cmp(&a.1.last_update));

        let now = Instant::now();
        let mut list = column![].spacing(4);

        for (source_id, source) in &sorted {
            let elapsed = now.duration_since(source.last_update).as_secs();
            let is_active = elapsed < SOURCE_INACTIVE_SECS;
            let is_open = self.subtitle_windows.values().any(|sid| sid == *source_id);

            // Provider + tab title label
            let label = if source.tab_title.is_empty() {
                format!("📺 {}", source.provider)
            } else {
                format!("📺 {} — {}", source.provider, source.tab_title)
            };
            let label_color = if is_active {
                iced::Color::from_rgb(0.15, 0.15, 0.15)
            } else {
                iced::Color::from_rgb(0.65, 0.65, 0.65)
            };

            // Subtitle text preview (truncated)
            let preview = truncate_str(&source.text, 50);

            let info_col = column![
                text(label).size(13).color(label_color),
                text(preview)
                    .size(11)
                    .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            ]
            .spacing(2)
            .width(Length::Fill);

            // Open / Opened button
            let btn = if is_open {
                button(text("Opened").size(11))
            } else {
                button(text("Open").size(11))
                    .on_press(Message::OpenSubtitleWindow((*source_id).clone()))
            };

            let entry = row![info_col, btn]
                .align_y(iced::Alignment::Center)
                .spacing(8);

            list = list.push(entry);
            list = list.push(horizontal_rule(1));
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

    /// Subtitle overlay window: shows subtitles for one specific source
    fn view_subtitle(&self, window_id: window::Id) -> Element<'_, Message> {
        let font_size = self
            .font_sizes
            .get(&window_id)
            .copied()
            .unwrap_or(DEFAULT_FONT_SIZE);

        let (provider_str, subtitle_str) =
            if let Some(source_id) = self.subtitle_windows.get(&window_id) {
                if let Some(source) = self.sources.get(source_id) {
                    let label = if source.tab_title.is_empty() {
                        format!("📺 {}", source.provider)
                    } else {
                        format!("📺 {} — {}", source.provider, source.tab_title)
                    };
                    (label, source.text.as_str())
                } else {
                    (String::from("📺"), "Waiting...")
                }
            } else {
                (String::from("📺"), "Waiting...")
            };

        let provider_label = text(provider_str)
            .size(12)
            .color(iced::Color::from_rgb(0.6, 0.6, 0.6));

        let subtitle_text = text(subtitle_str).size(font_size).color(iced::Color::WHITE);

        let font_control = row![
            text("Font:")
                .size(11)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            slider(14.0..=72.0, font_size, move |s| Message::FontSizeChanged(
                window_id, s
            ))
            .width(150),
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center);

        let content = column![provider_label, subtitle_text, font_control]
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
        let tick = iced::time::every(Duration::from_millis(100)).map(|_| Message::Tick);

        Subscription::batch([tick, window::close_events().map(Message::WindowClosed)])
    }
}

/// Manager window settings (normal window)
fn manager_window_settings() -> window::Settings {
    window::Settings {
        size: iced::Size::new(420.0, 340.0),
        ..Default::default()
    }
}

/// Subtitle overlay window settings (always-on-top)
fn subtitle_window_settings() -> window::Settings {
    window::Settings {
        size: iced::Size::new(600.0, 140.0),
        level: window::Level::AlwaysOnTop,
        decorations: true,
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
