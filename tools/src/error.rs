//! The one error type of the tooling binary.

use thiserror::Error;

use crate::process::ProcessError;

/// Everything that can go wrong in a tool command.
#[derive(Debug, Error)]
#[non_exhaustive]
pub(crate) enum Error {
    /// The shared protocol or file-watching library failed.
    #[error(transparent)]
    Library(#[from] dev_hot::Error),
    /// A program failed.
    #[error(transparent)]
    Process(#[from] ProcessError),
    /// A file, socket or pipe failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// JSON did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The WXT build failed.
    #[error("{0}")]
    Build(String),
    /// The browser could not be found, started or reached.
    #[error("browser: {0}")]
    Browser(String),
    /// The tracing subscriber could not be installed.
    #[error("logging: {0}")]
    Logging(String),
}

pub(crate) type Result<T> = std::result::Result<T, Error>;
