use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use tokio::sync::{mpsc, watch};
use tower_http::cors::CorsLayer;
use tracing::{error, info};

use crate::subtitle::SubtitleMessage;

/// Start the WebSocket server on the given port.
/// Subtitle messages are forwarded to the UI through the provided sender.
/// The server shuts down gracefully when `shutdown_rx` receives `true`.
pub async fn run_server(
    port: u16,
    subtitle_tx: mpsc::UnboundedSender<SubtitleMessage>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/ws", get(move |ws| ws_handler(ws, subtitle_tx)))
        .layer(CorsLayer::permissive());

    let addr = format!("127.0.0.1:{}", port);
    info!("dkitle server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind server address");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Wait until shutdown signal is sent
            let _ = shutdown_rx.wait_for(|&v| v).await;
            info!("Server received shutdown signal");
        })
        .await
        .expect("Server error");

    info!("Server stopped");
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    subtitle_tx: mpsc::UnboundedSender<SubtitleMessage>,
) -> impl IntoResponse {
    info!("New WebSocket connection");
    ws.on_upgrade(move |socket| handle_socket(socket, subtitle_tx))
}

async fn handle_socket(mut socket: WebSocket, subtitle_tx: mpsc::UnboundedSender<SubtitleMessage>) {
    info!("WebSocket client connected");

    while let Some(msg) = socket.recv().await {
        match msg {
            Ok(Message::Text(text)) => match serde_json::from_str::<SubtitleMessage>(&text) {
                Ok(subtitle) => {
                    match &subtitle {
                        SubtitleMessage::Cues {
                            provider,
                            source_id,
                            cues,
                            ..
                        } => {
                            info!(
                                "[{}] Received {} cues for source {}",
                                provider,
                                cues.len(),
                                source_id
                            );
                        }
                        SubtitleMessage::Sync {
                            source_id,
                            video_time_ms,
                            playing,
                            playback_rate,
                            ..
                        } => {
                            tracing::trace!(
                                "Sync source={} time={}ms playing={} rate={}x",
                                source_id,
                                video_time_ms,
                                playing,
                                playback_rate
                            );
                        }
                        SubtitleMessage::Deactivate { source_id } => {
                            info!("Deactivating source {}", source_id);
                        }
                    }
                    if subtitle_tx.send(subtitle).is_err() {
                        error!("UI channel closed, stopping connection");
                        break;
                    }
                }
                Err(e) => {
                    error!("Failed to parse subtitle message: {}", e);
                }
            },
            Ok(Message::Close(_)) => {
                info!("WebSocket client disconnected");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    info!("WebSocket connection closed");
}

async fn health_handler() -> &'static str {
    "ok"
}
