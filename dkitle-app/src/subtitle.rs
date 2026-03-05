use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported subtitle providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    YouTube,
    // Future: Bilibili, Netflix, etc.
}

impl fmt::Display for Provider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Provider::YouTube => write!(f, "YouTube"),
        }
    }
}

/// A subtitle message received from a browser extension provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleMessage {
    /// The provider that generated this subtitle
    pub provider: Provider,
    /// The subtitle text content
    pub text: String,
    /// Unix timestamp in milliseconds when this subtitle was captured
    pub timestamp: u64,
    /// Unique identifier for the source (one per browser tab)
    pub source_id: String,
    /// Browser tab title for display purposes
    pub tab_title: String,
}
