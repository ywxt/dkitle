use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc, watch};
use tower_http::cors::CorsLayer;
use tracing::{error, info};

use crate::subtitle::{ServerCommand, SubtitleMessage};

/// Start the WebSocket server on the given port.
/// Subtitle messages are forwarded to the UI through the provided sender.
/// Commands from the UI are broadcast to all connected clients via `cmd_tx`.
/// The server shuts down gracefully when `shutdown_rx` receives `true`.
pub async fn run_server(
    port: u16,
    subtitle_tx: mpsc::UnboundedSender<SubtitleMessage>,
    cmd_tx: broadcast::Sender<ServerCommand>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let app = Router::new()
        .route("/health", get(health_handler))
        .route(
            "/ws",
            get(move |ws| ws_handler(ws, subtitle_tx, cmd_tx)),
        )
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
    cmd_tx: broadcast::Sender<ServerCommand>,
) -> impl IntoResponse {
    info!("New WebSocket connection");
    let cmd_rx = cmd_tx.subscribe();
    ws.on_upgrade(move |socket| handle_socket(socket, subtitle_tx, cmd_rx))
}

async fn handle_socket(
    socket: WebSocket,
    subtitle_tx: mpsc::UnboundedSender<SubtitleMessage>,
    mut cmd_rx: broadcast::Receiver<ServerCommand>,
) {
    info!("WebSocket client connected");

    let (mut ws_sink, mut ws_stream) = socket.split();

    loop {
        tokio::select! {
            // Incoming messages from the browser
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<SubtitleMessage>(&text) {
                            Ok(subtitle) => {
                                match &subtitle {
                                    SubtitleMessage::Register {
                                        provider,
                                        source_id,
                                        ..
                                    } => {
                                        info!(
                                            "[{}] Registered source {}",
                                            provider,
                                            source_id
                                        );
                                    }
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
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!("WebSocket client disconnected");
                        break;
                    }
                    Some(Err(e)) => {
                        error!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        // Stream ended
                        break;
                    }
                    _ => {}
                }
            }
            // Outgoing commands from the UI to the browser
            cmd = cmd_rx.recv() => {
                match cmd {
                    Ok(command) => {
                        match serde_json::to_string(&command) {
                            Ok(json) => {
                                if ws_sink.send(Message::Text(json.into())).await.is_err() {
                                    error!("Failed to send command to WebSocket client");
                                    break;
                                }
                            }
                            Err(e) => {
                                error!("Failed to serialize command: {}", e);
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Command broadcast lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        }
    }

    info!("WebSocket connection closed");
}

async fn health_handler() -> &'static str {
    "ok"
}
