//! How the dev server talks to the running browser: the Chrome `DevTools` Protocol for Chrome and
//! Edge, `WebDriver` `BiDi` for Firefox. The extension needs no dev-only permission or code.

pub mod bidi;
pub mod cdp;
mod net;

use std::future::Future;

use crate::error::Result;

/// The prefix of every page the extension runs on.
pub const YOUTUBE_ORIGIN: &str = "https://www.youtube.com/";

/// Reload operations on a running browser.
pub trait BrowserDriver: Send + Sync {
    /// Loads the freshly built extension into the browser.
    fn reload_extension(&self) -> impl Future<Output = Result<()>> + Send;

    /// Reloads every open `YouTube` tab, so each load runs the new scripts; returns how many were
    /// reloaded. The page scripts register listeners they never remove, so they cannot be swapped
    /// in place.
    fn reload_youtube_tabs(&self) -> impl Future<Output = Result<usize>> + Send;
}
