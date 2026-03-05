mod server;
mod subtitle;
mod ui;

use std::sync::mpsc;
use tracing::info;

const DEFAULT_PORT: u16 = 9877;

fn main() -> iced::Result {
    // Initialize logging
    tracing_subscriber::fmt::init();
    info!("Starting dkitle-app");

    // Create channel for subtitle messages: server -> UI
    let (subtitle_tx, subtitle_rx) = mpsc::channel();

    // Start the WebSocket server in a background thread with its own tokio runtime
    let port = DEFAULT_PORT;
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
        rt.block_on(server::run_server(port, subtitle_tx));
    });

    info!("Launching subtitle overlay window");

    // Run the iced application on the main thread
    iced::application(ui::SubtitleApp::title, ui::SubtitleApp::update, ui::SubtitleApp::view)
        .subscription(ui::SubtitleApp::subscription)
        .theme(ui::SubtitleApp::theme)
        .window(ui::window_settings())
        .run_with(move || ui::SubtitleApp::new(subtitle_rx))
}
