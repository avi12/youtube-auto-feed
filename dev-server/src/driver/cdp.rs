//! Chrome `DevTools` Protocol client: `/json` over plain HTTP on the debug port, and one WebSocket
//! per target. The extension is reloaded from the browser's extensions page (`chrome://extensions`,
//! `edge://extensions`), whose private API reloads an unpacked extension even while its service
//! worker sleeps.

mod http;
pub mod protocol;
mod session;
mod target;

use std::time::Duration;

use futures_util::future::join_all;
use tokio::time::sleep;

use self::http::Verb;
use self::session::{is_closed, Session};
pub use self::target::{is_blank_tab, is_youtube_tab, CdpTarget, TargetId, TargetKind};
use crate::driver::BrowserDriver;
use crate::error::{Error, Result};
use crate::types::Port;

const RELOAD_EXPRESSION: &str = "location.reload()";
const RELOAD_EXTENSION_SOURCE: &str = include_str!("../../assets/reload-extension.js");
/// Chrome's extensions page.
pub const CHROME_EXTENSIONS_PAGE: &str = "chrome://extensions";
/// Edge's extensions page.
pub const EDGE_EXTENSIONS_PAGE: &str = "edge://extensions";
/// A freshly opened page offers no signal this client can subscribe to before it may already have
/// loaded, so its private API is retried until it answers.
const READY_ATTEMPTS: u32 = 25;
const READY_RETRY_DELAY: Duration = Duration::from_millis(200);

/// A CDP client for one browser's debug port, reloading the extension of one name.
#[derive(Debug, Clone)]
pub struct CdpClient {
    port: Port,
    extension_name: String,
    extensions_page: &'static str,
}

impl CdpClient {
    /// A client for the browser listening on `port`, whose extensions page is `extensions_page`.
    pub const fn new(port: Port, extension_name: String, extensions_page: &'static str) -> Self {
        Self {
            port,
            extension_name,
            extensions_page,
        }
    }

    /// All targets of the browser (`/json/list`).
    pub async fn list_targets(&self) -> Result<Vec<CdpTarget>> {
        let list = http::request(self.port, Verb::Get, "/json/list").await?;
        Ok(serde_json::from_str(&list)?)
    }

    /// Opens `url` in a new tab and closes the blank tabs the browser started with.
    pub async fn open_in_place_of_blank_tabs(&self, url: &str) -> Result<()> {
        let blank_tabs = self.list_targets().await?.into_iter().filter(is_blank_tab);
        let path = format!("/json/new?{url}");
        http::request(self.port, Verb::Put, &path).await?;
        for tab in blank_tabs {
            let close = format!("/json/close/{}", tab.id);
            http::request(self.port, Verb::Get, &close).await?;
        }
        Ok(())
    }
}

async fn evaluate_when_ready(url: &str, expression: &str) -> Result<()> {
    let mut last = Error::Timeout("the extensions page");
    for _ in 0..READY_ATTEMPTS {
        match Session::evaluate(url, expression).await {
            Ok(()) => return Ok(()),
            Err(error) => last = error,
        }
        sleep(READY_RETRY_DELAY).await;
    }
    Err(last)
}

/// Reloads one tab in place. A target that closes mid-reload still counts: `location.reload()`
/// tears the session down. A closed or vanished tab never fails the batch.
async fn reload_target(target: CdpTarget) -> bool {
    let Some(url) = target.debugger_url() else {
        return false;
    };
    match Session::evaluate(url, RELOAD_EXPRESSION).await {
        Ok(()) => true,
        Err(error) if is_closed(&error) => true,
        Err(error) => {
            tracing::warn!("CDP reload of {} skipped: {error}", target.id);
            false
        }
    }
}

impl BrowserDriver for CdpClient {
    async fn reload_extension(&self) -> Result<()> {
        let path = format!("/json/new?{}", self.extensions_page);
        let opened = http::request(self.port, Verb::Put, &path).await?;
        let page: CdpTarget = serde_json::from_str(&opened)?;
        let name = serde_json::to_string(&self.extension_name)?;
        let expression = format!(
            "{RELOAD_EXTENSION_SOURCE}
globalThis.reloadExtension({name})"
        );
        let outcome = match page.debugger_url() {
            Some(url) => evaluate_when_ready(url, &expression).await,
            None => Err(Error::Protocol(
                "the extensions page has no debugger URL".to_owned(),
            )),
        };
        let close = format!("/json/close/{}", page.id);
        if let Err(error) = http::request(self.port, Verb::Get, &close).await {
            tracing::warn!("could not close the extensions page: {error}");
        }
        outcome
    }

    async fn reload_youtube_tabs(&self) -> Result<usize> {
        let tabs = self
            .list_targets()
            .await?
            .into_iter()
            .filter(is_youtube_tab);
        let outcomes = join_all(tabs.map(reload_target)).await;
        Ok(outcomes.into_iter().filter(|reloaded| *reloaded).count())
    }
}
