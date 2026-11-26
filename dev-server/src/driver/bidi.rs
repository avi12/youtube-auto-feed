//! `WebDriver` `BiDi` over Firefox's Remote Agent. One short-lived session per operation, since the
//! Remote Agent allows a single session at a time.

use std::path::PathBuf;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::driver::net::{within, LOOPBACK};
use crate::driver::{BrowserDriver, YOUTUBE_ORIGIN};
use crate::error::{Error, Result};
use crate::types::Port;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Serialize)]
enum Method {
    #[serde(rename = "session.new")]
    SessionNew,
    #[serde(rename = "session.end")]
    SessionEnd,
    #[serde(rename = "webExtension.install")]
    Install,
    #[serde(rename = "browsingContext.getTree")]
    GetTree,
    #[serde(rename = "browsingContext.reload")]
    Reload,
    #[serde(rename = "browsingContext.navigate")]
    Navigate,
}

#[derive(Debug, Serialize)]
struct Command {
    id: u64,
    method: Method,
    #[serde(rename = "params")]
    parameters: Value,
}

/// A reply (`id`) or an event (no `id`).
#[derive(Debug, Deserialize)]
struct Incoming {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Tree {
    contexts: Vec<Context>,
}

#[derive(Debug, Deserialize)]
struct Context {
    context: String,
    url: String,
}

struct Session {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Session {
    async fn start(port: Port) -> Result<Self> {
        let url = format!("ws://{LOOPBACK}:{}/session", port.get());
        let (socket, _response) = within(
            CONNECT_TIMEOUT,
            "the BiDi WebSocket handshake",
            connect_async(url),
        )
        .await?;
        let mut session = Self { socket, next_id: 1 };
        session
            .call(Method::SessionNew, json!({ "capabilities": {} }))
            .await?;
        Ok(session)
    }

    async fn end(mut self) {
        if let Err(error) = self.call(Method::SessionEnd, json!({})).await {
            tracing::warn!("BiDi session did not end cleanly: {error}");
        }
        self.socket.close(None).await.ok();
    }

    async fn call(&mut self, method: Method, parameters: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = serde_json::to_string(&Command {
            id,
            method,
            parameters,
        })?;
        within(
            REPLY_TIMEOUT,
            "sending a BiDi command",
            self.socket.send(Message::text(payload)),
        )
        .await?;
        within(REPLY_TIMEOUT, "a BiDi reply", self.reply_to(id)).await
    }

    async fn reply_to(&mut self, id: u64) -> Result<Value> {
        while let Some(frame) = self.socket.next().await {
            let Message::Text(text) = frame? else {
                continue;
            };
            let reply: Incoming = serde_json::from_str(text.as_str())?;
            let is_other_reply = reply.id != Some(id);
            if is_other_reply {
                continue;
            }
            if let Some(error) = reply.error {
                let message = reply.message.unwrap_or_default();
                return Err(Error::Protocol(format!("BiDi {error}: {message}")));
            }
            return Ok(reply.result.unwrap_or(Value::Null));
        }
        Err(WebSocketError::ConnectionClosed.into())
    }

    async fn tabs(&mut self) -> Result<Vec<Context>> {
        let tree = self.call(Method::GetTree, json!({ "maxDepth": 0 })).await?;
        Ok(serde_json::from_value::<Tree>(tree)?.contexts)
    }

    async fn reload_youtube(&mut self) -> Result<usize> {
        let mut reloaded = 0;
        for tab in self.tabs().await? {
            if !tab.url.starts_with(YOUTUBE_ORIGIN) {
                continue;
            }
            let parameters = json!({ "context": tab.context });
            match self.call(Method::Reload, parameters).await {
                Ok(_) => reloaded += 1,
                Err(error) => tracing::warn!("BiDi reload skipped: {error}"),
            }
        }
        Ok(reloaded)
    }

    async fn navigate_first_tab(&mut self, url: &str) -> Result<()> {
        let Some(tab) = self.tabs().await?.into_iter().next() else {
            return Err(Error::Protocol("Firefox has no open tab".to_owned()));
        };
        let parameters = json!({ "context": tab.context, "url": url });
        self.call(Method::Navigate, parameters).await.map(drop)
    }
}

/// A `BiDi` client for the Firefox listening on one port, loading one extension directory.
#[derive(Debug, Clone)]
pub struct BidiClient {
    port: Port,
    extension_directory: PathBuf,
}

impl BidiClient {
    /// A client for the Firefox on `port` that installs the extension built in `extension_directory`.
    pub const fn new(port: Port, extension_directory: PathBuf) -> Self {
        Self {
            port,
            extension_directory,
        }
    }

    /// Points the first tab at `url`.
    pub async fn open_in_first_tab(&self, url: &str) -> Result<()> {
        let mut session = Session::start(self.port).await?;
        let outcome = session.navigate_first_tab(url).await;
        session.end().await;
        outcome
    }
}

impl BrowserDriver for BidiClient {
    /// Installs the directory as a temporary add-on; installing it again reloads it.
    async fn reload_extension(&self) -> Result<()> {
        let mut session = Session::start(self.port).await?;
        let parameters = json!({
            "extensionData": { "type": "path", "path": self.extension_directory },
        });
        let outcome = session.call(Method::Install, parameters).await;
        session.end().await;
        outcome.map(drop)
    }

    async fn reload_youtube_tabs(&self) -> Result<usize> {
        let mut session = Session::start(self.port).await?;
        let outcome = session.reload_youtube().await;
        session.end().await;
        outcome
    }
}
