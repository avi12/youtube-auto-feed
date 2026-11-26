//! The hot loop of the extension dev server: watch the project, rebuild on save and reload the
//! extension and its `YouTube` tabs over the browser's own debugging protocol.

pub mod changes;
pub mod driver;
pub mod error;
pub mod orchestrator;
pub mod types;

pub use error::{Error, Result};
