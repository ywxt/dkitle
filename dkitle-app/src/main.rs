#![windows_subsystem = "windows"]

mod server;
mod subtitle;
mod ui;

use tracing::info;
use tracing_subscriber::EnvFilter;

const DEFAULT_PORT: u16 = 9877;

fn main() -> iced::Result {
    // Initialize logging (suppress noisy shader/wgpu logs)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("dkitle_app=info".parse().unwrap())
                .add_directive("wgpu=error".parse().unwrap())
                .add_directive("wgpu_core=error".parse().unwrap())
                .add_directive("wgpu_hal=error".parse().unwrap())
                .add_directive("naga=error".parse().unwrap())
                .add_directive("iced_wgpu=error".parse().unwrap()),
        )
        .init();
    info!("Starting dkitle-app");
    info!("Launching subtitle manager window");

    // Run the iced daemon (multi-window mode) on the main thread.
    // Channel creation and server startup are done inside the boot closure
    // so we don't need Mutex<Option<>> workarounds for the Fn trait bound.
    iced::daemon(
        || {
            let (subtitle_tx, subtitle_rx) = tokio::sync::mpsc::unbounded_channel();
            let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

            let port = DEFAULT_PORT;
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                rt.block_on(server::run_server(port, subtitle_tx, shutdown_rx));
            });

            ui::SubtitleApp::new(subtitle_rx, shutdown_tx)
        },
        ui::SubtitleApp::update,
        ui::SubtitleApp::view,
    )
    .title(ui::SubtitleApp::title)
    .subscription(ui::SubtitleApp::subscription)
    .theme(ui::SubtitleApp::theme)
    .run()
}
