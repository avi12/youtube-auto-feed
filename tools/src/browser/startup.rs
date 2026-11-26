//! Claiming a debug port and learning from the browser itself that it listens there.

use std::net::{Ipv4Addr, TcpListener};
use std::time::Duration;

use dev_hot::types::Port;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStderr};
use tokio::time::timeout;

use crate::error::{Error, Result};
use crate::launcher::log_event;

const MAX_PORT_PROBES: u16 = 50;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

fn is_port_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// The first free loopback port at or above `preferred`, so another browser's debugger never
/// captures ours.
pub(super) fn claim_port(preferred: u16, label: &str) -> Result<Port> {
    let port = (preferred..preferred.saturating_add(MAX_PORT_PROBES))
        .find(|candidate| is_port_free(*candidate))
        .ok_or_else(|| Error::Browser(format!("no free {label} port from {preferred}")))?;
    let is_preferred_busy = port != preferred;
    if is_preferred_busy {
        log_event(&format!("{label} port {preferred} busy - using {port}"));
    }
    Ok(Port::new(port)?)
}

/// Exactly `port`, which other tools (the devtools MCP servers) attach to by number; a busy port
/// means another session still owns it.
pub(super) fn require_port(port: u16, label: &str) -> Result<Port> {
    if !is_port_free(port) {
        return Err(Error::Browser(format!(
            "{label} port {port} is busy - is another dev server still running?"
        )));
    }
    Ok(Port::new(port)?)
}

async fn read_until_marker(reader: &mut BufReader<ChildStderr>, marker: &str) -> Result<()> {
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line).await?;
        let is_end_of_stream = read == 0;
        if is_end_of_stream {
            return Err(Error::Browser(
                "it exited before its debug port opened".to_owned(),
            ));
        }
        if String::from_utf8_lossy(&line).contains(marker) {
            return Ok(());
        }
    }
}

/// Waits for the line a browser prints once its debug port listens, then keeps draining its stderr
/// so the pipe never fills.
pub(super) async fn wait_until_listening(child: &mut Child, marker: &str) -> Result<()> {
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Browser("its stderr is not piped".to_owned()))?;
    let mut reader = BufReader::new(stderr);
    timeout(STARTUP_TIMEOUT, read_until_marker(&mut reader, marker))
        .await
        .map_err(|_elapsed| Error::Browser(format!("it never printed \"{marker}\"")))??;
    tokio::spawn(async move {
        tokio::io::copy(&mut reader, &mut tokio::io::sink())
            .await
            .ok();
    });
    Ok(())
}
