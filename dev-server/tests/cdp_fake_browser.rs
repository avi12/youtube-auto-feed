//! The CDP client against an in-process fake browser: `/json/list` over HTTP and one WebSocket
//! per target, on a single loopback listener.

use std::sync::{Arc, Mutex};

use dev_hot::driver::cdp::{CdpClient, CHROME_EXTENSIONS_PAGE};
use dev_hot::driver::BrowserDriver;
use dev_hot::types::Port;
use dev_hot::Result;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

type CallLog = Arc<Mutex<Vec<String>>>;

/// Longer than any client waits for the socket to close.
const LINGER: std::time::Duration = std::time::Duration::from_secs(30);

struct Fake {
    client: CdpClient,
    calls: CallLog,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        let mut calls = self.calls.lock().unwrap().clone();
        calls.sort();
        calls
    }
}

fn client(port: u16) -> Result<CdpClient> {
    Ok(CdpClient::new(
        Port::new(port)?,
        "Extension".to_owned(),
        CHROME_EXTENSIONS_PAGE,
    ))
}

fn target(port: u16, id: &str, kind: &str, url: &str) -> Value {
    json!({
        "id": id,
        "type": kind,
        "url": url,
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/page/{id}"),
    })
}

async fn serve_http(mut stream: TcpStream, list: &str) {
    let mut peeked = [0_u8; 32];
    let read = stream.peek(&mut peeked).await.unwrap();
    let request = String::from_utf8_lossy(&peeked[..read]).to_string();
    assert!(request.starts_with("GET /json/list"));
    let body = list.to_owned();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut sink = vec![0_u8; 4096];
    tokio::io::AsyncReadExt::read(&mut stream, &mut sink)
        .await
        .unwrap();
    stream.write_all(response.as_bytes()).await.unwrap();
    // Like Chrome's DevTools server: `Connection: close` is ignored and the socket stays open.
    tokio::time::sleep(LINGER).await;
}

async fn serve_websocket(stream: TcpStream, calls: CallLog) {
    let mut peeked = [0_u8; 128];
    let read = stream.peek(&mut peeked).await.unwrap();
    let request = String::from_utf8_lossy(&peeked[..read]).to_string();
    let tab = request
        .split_whitespace()
        .nth(1)
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_owned();
    let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        let command: Value = serde_json::from_str(text.as_str()).unwrap();
        let method = command["method"].as_str().unwrap().to_owned();
        calls.lock().unwrap().push(format!("{tab} {method}"));
        let reply = json!({ "id": command["id"], "result": { "result": { "type": "undefined" } } });
        socket.send(Message::text(reply.to_string())).await.unwrap();
    }
}

async fn start_fake(targets: impl FnOnce(u16) -> Vec<Value>) -> Result<Fake> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let list = serde_json::to_string(&targets(port))?;
    let calls = CallLog::default();
    let served = Arc::clone(&calls);
    tokio::spawn(async move {
        loop {
            let (stream, _peer) = listener.accept().await.unwrap();
            let mut peeked = [0_u8; 16];
            stream.peek(&mut peeked).await.unwrap();
            let is_list = peeked.starts_with(b"GET /json");
            let (list, served) = (list.clone(), Arc::clone(&served));
            tokio::spawn(async move {
                if is_list {
                    serve_http(stream, &list).await;
                    return;
                }
                serve_websocket(stream, served).await;
            });
        }
    });
    Ok(Fake {
        client: client(port)?,
        calls,
    })
}

fn mixed_targets(port: u16) -> Vec<Value> {
    vec![
        target(port, "tab-a", "page", "https://www.youtube.com/watch?v=1"),
        target(port, "tab-b", "page", "https://www.youtube.com/"),
        target(port, "other", "page", "https://example.com/"),
        target(
            port,
            "worker",
            "service_worker",
            "https://www.youtube.com/sw.js",
        ),
        json!({ "id": "held", "type": "page", "url": "https://www.youtube.com/held" }),
    ]
}

#[tokio::test]
async fn only_youtube_tabs_are_reloaded() -> Result<()> {
    let fake = start_fake(mixed_targets).await?;
    assert_eq!(fake.client.reload_youtube_tabs().await?, 2);
    assert_eq!(
        fake.calls(),
        ["tab-a Runtime.evaluate", "tab-b Runtime.evaluate"]
    );
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn a_browser_that_never_answers_times_out() -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _peer)) = listener.accept().await {
            held.push(stream);
        }
    });
    let silent = client(port)?;
    assert!(matches!(
        silent.list_targets().await,
        Err(dev_hot::Error::Timeout(_))
    ));
    Ok(())
}
