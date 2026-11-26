//! The one error type of the library. The binary only prints it.

use thiserror::Error;

/// Everything that can go wrong in the hot loop.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// A port number of zero.
    #[error("port 0 is not a usable port")]
    InvalidPort,
    /// Reading or writing a file, a socket or a pipe failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON message did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The file watcher failed.
    #[error("watcher: {0}")]
    Watch(#[from] notify::Error),
    /// A WebSocket handshake or frame failed.
    #[error("websocket: {0}")]
    WebSocket(#[from] Box<tokio_tungstenite::tungstenite::Error>),
    /// Building the extension failed.
    #[error("build failed: {message}")]
    Host {
        /// The builder's own message.
        message: String,
    },
    /// A browser debugging protocol peer sent something unexpected.
    #[error("protocol: {0}")]
    Protocol(String),
    /// A wait ran out.
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
}

/// The library's result type.
pub type Result<T> = std::result::Result<T, Error>;

impl From<tokio_tungstenite::tungstenite::Error> for Error {
    fn from(error: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::WebSocket(Box::new(error))
    }
}
