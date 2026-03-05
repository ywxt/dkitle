use serde::{Deserialize, Serialize};

/// A subtitle message received from a browser extension provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleMessage {
    /// The provider that generated this subtitle (e.g. "youtube", "bilibili")
    pub provider: String,
    /// The subtitle text content
    pub text: String,
    /// Unix timestamp in milliseconds when this subtitle was captured
    pub timestamp: u64,
}
