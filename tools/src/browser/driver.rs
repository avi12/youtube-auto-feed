//! One reload driver over every launched browser: a browser that fails to reload is logged and
//! skipped, so the others still pick up the build.

use dev_hot::driver::bidi::BidiClient;
use dev_hot::driver::cdp::CdpClient;
use dev_hot::driver::BrowserDriver;

use crate::launcher::log_event;

/// The protocol one browser is driven over.
pub(crate) enum Protocol {
    Cdp(CdpClient),
    Bidi(BidiClient),
}

impl Protocol {
    async fn reload_extension(&self) -> dev_hot::Result<()> {
        match self {
            Self::Cdp(client) => client.reload_extension().await,
            Self::Bidi(client) => client.reload_extension().await,
        }
    }

    async fn reload_youtube_tabs(&self) -> dev_hot::Result<usize> {
        match self {
            Self::Cdp(client) => client.reload_youtube_tabs().await,
            Self::Bidi(client) => client.reload_youtube_tabs().await,
        }
    }
}

/// How the dev server reaches one browser.
pub(crate) struct Driver {
    pub(crate) label: String,
    pub(crate) protocol: Protocol,
    /// A browser without the extension only gets its `YouTube` tabs reloaded.
    pub(crate) is_extension_loaded: bool,
}

impl Driver {
    async fn reload_extension_logged(&self) {
        if !self.is_extension_loaded {
            return;
        }
        match self.protocol.reload_extension().await {
            Ok(()) => log_event(&format!("{}: extension reloaded", self.label)),
            Err(error) => log_event(&format!("{}: extension reload failed: {error}", self.label)),
        }
    }

    async fn reload_youtube_tabs_logged(&self) -> usize {
        match self.protocol.reload_youtube_tabs().await {
            Ok(count) => count,
            Err(error) => {
                log_event(&format!("{}: tab reload failed: {error}", self.label));
                0
            }
        }
    }
}

/// Every browser of the session.
pub(crate) struct Drivers(pub(crate) Vec<Driver>);

impl BrowserDriver for Drivers {
    async fn reload_extension(&self) -> dev_hot::Result<()> {
        for driver in &self.0 {
            driver.reload_extension_logged().await;
        }
        Ok(())
    }

    async fn reload_youtube_tabs(&self) -> dev_hot::Result<usize> {
        let mut total = 0;
        for driver in &self.0 {
            total += driver.reload_youtube_tabs_logged().await;
        }
        Ok(total)
    }
}
