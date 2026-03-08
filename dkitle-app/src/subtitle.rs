use serde::{Deserialize, Serialize};
use std::fmt;

/// Commands sent from the app to browser clients via WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerCommand {
    /// Toggle play/pause on the video matching the given source_id.
    PlayPause { source_id: String },
}

/// Supported subtitle providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    YouTube,
    Bilibili,
}

impl fmt::Display for Provider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Provider::YouTube => write!(f, "YouTube"),
            Provider::Bilibili => write!(f, "Bilibili"),
        }
    }
}

/// A single subtitle cue with start/end timing and text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SubtitleCue {
    pub start_ms: f64,
    pub end_ms: f64,
    pub text: String,
}

/// Messages received from the browser extension via WebSocket.
///
/// Two message types:
/// - `Cues`: All subtitle cues for a video, sent once when intercepted.
/// - `Sync`: Video playback time sync, sent on timeupdate/pause/play/seeked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SubtitleMessage {
    /// Registers a new source (video detected, subtitles may or may not exist).
    Register {
        provider: Provider,
        source_id: String,
        tab_title: String,
    },
    Cues {
        provider: Provider,
        source_id: String,
        tab_title: String,
        cues: Vec<SubtitleCue>,
    },
    Sync {
        source_id: String,
        video_time_ms: f64,
        playing: bool,
        /// Video playback rate (e.g. 0.5, 1.0, 1.5, 2.0)
        playback_rate: f64,
        /// Sender's Date.now() timestamp in milliseconds
        timestamp: u64,
    },
    /// Sent when a source is no longer active (tab closed/refreshed).
    Deactivate {
        source_id: String,
    },
}
