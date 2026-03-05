use iced::widget::{column, container, row, slider, text};
use iced::window;
use iced::{Element, Length, Subscription, Task, Theme};
use std::sync::mpsc;
use std::time::Duration;

use crate::subtitle::SubtitleMessage;

/// Messages for the iced application
#[derive(Debug, Clone)]
pub enum Message {
    /// Tick to poll subtitle channel
    Tick,
    /// Font size changed
    FontSizeChanged(f32),
}

/// The main subtitle overlay application
pub struct SubtitleApp {
    subtitle_rx: mpsc::Receiver<SubtitleMessage>,
    current_text: String,
    current_provider: String,
    font_size: f32,
}

impl SubtitleApp {
    pub fn new(subtitle_rx: mpsc::Receiver<SubtitleMessage>) -> (Self, Task<Message>) {
        let app = Self {
            subtitle_rx,
            current_text: String::from("Waiting for subtitles..."),
            current_provider: String::new(),
            font_size: 28.0,
        };
        (app, Task::none())
    }

    pub fn title(&self) -> String {
        String::from("dkitle")
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Tick => {
                // Drain all pending messages, keep only latest
                let mut latest: Option<SubtitleMessage> = None;
                while let Ok(msg) = self.subtitle_rx.try_recv() {
                    latest = Some(msg);
                }
                if let Some(msg) = latest {
                    self.current_text = msg.text;
                    self.current_provider = msg.provider;
                }
            }
            Message::FontSizeChanged(size) => {
                self.font_size = size;
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let provider_label = if !self.current_provider.is_empty() {
            text(format!("📺 {}", self.current_provider))
                .size(12)
                .color(iced::Color::from_rgb(0.6, 0.6, 0.6))
        } else {
            text("").size(12)
        };

        let subtitle_text = text(&self.current_text)
            .size(self.font_size)
            .color(iced::Color::WHITE);

        let font_control = row![
            text("Font:").size(11).color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            slider(14.0..=72.0, self.font_size, Message::FontSizeChanged).width(150),
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

    pub fn subscription(&self) -> Subscription<Message> {
        iced::time::every(Duration::from_millis(100)).map(|_| Message::Tick)
    }

    pub fn theme(&self) -> Theme {
        Theme::Dark
    }
}

/// Create the iced window settings
pub fn window_settings() -> window::Settings {
    window::Settings {
        size: iced::Size::new(600.0, 140.0),
        level: window::Level::AlwaysOnTop,
        decorations: true,
        ..Default::default()
    }
}
