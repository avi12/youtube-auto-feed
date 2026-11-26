//! The installed Firefox, driven over its Remote Agent (`WebDriver` `BiDi`) when it carries the
//! extension.

use std::path::PathBuf;

use dev_hot::driver::bidi::BidiClient;
use dev_hot::driver::BrowserDriver;
use tokio::process::Child;

use crate::browser::driver::{Driver, Protocol};
use crate::browser::startup::{claim_port, wait_until_listening};
use crate::browser::{find_under_roots, Launch, START_URL};
use crate::error::{Error, Result};
use crate::process::Invocation;
use crate::profile;

/// Clear of the Chromium CDP ports.
const PREFERRED_REMOTE_PORT: u16 = 9272;
const LISTENING_MARKER: &str = "WebDriver BiDi listening on";
const MAC_BINARY: &str = "/Applications/Firefox.app/Contents/MacOS/firefox";
const LINUX_BINARY: &str = "firefox";
const WINDOWS_BINARY_PATH: &str = "Mozilla Firefox/firefox.exe";
const PROGRAM_FILES_VARIABLES: [&str; 2] = ["ProgramFiles", "ProgramFiles(x86)"];
/// The UI language, as the shell names it.
const LANGUAGE_VARIABLE: &str = "LANG";
const DEFAULT_LANGUAGE: &str = "en";

fn find_firefox(launch: &Launch<'_>) -> Result<PathBuf> {
    if cfg!(target_os = "macos") {
        return Ok(PathBuf::from(MAC_BINARY));
    }
    if !cfg!(windows) {
        return Ok(PathBuf::from(LINUX_BINARY));
    }
    find_under_roots(
        launch.environment,
        &PROGRAM_FILES_VARIABLES,
        WINDOWS_BINARY_PATH,
    )
    .ok_or_else(|| Error::Browser("could not find Firefox".to_owned()))
}

fn base_invocation(launch: &Launch<'_>) -> Result<Invocation> {
    let mut invocation = Invocation::new(find_firefox(launch)?)
        .arg("-profile")
        .arg(launch.profile_directory)
        .arg("-no-remote");
    if cfg!(windows) {
        // Keeps the launched process alive as long as the browser, so its exit means "closed"
        invocation = invocation.arg("-wait-for-browser");
    }
    Ok(invocation)
}

/// Firefox with no extension and no driver: nothing to reload.
pub(crate) fn launch_without_extension(launch: Launch<'_>) -> Result<Child> {
    profile::firefox::setup(launch.profile_directory, launch.environment)?;
    Ok(base_invocation(&launch)?
        .arg(START_URL)
        .spawn_quiet_kill_on_drop()?)
}

pub(crate) async fn launch(launch: Launch<'_>) -> Result<(Child, Driver)> {
    profile::firefox::setup(launch.profile_directory, launch.environment)?;
    let port = claim_port(PREFERRED_REMOTE_PORT, "Firefox Remote Agent")?;
    let language = launch
        .environment
        .get(LANGUAGE_VARIABLE)
        .unwrap_or(DEFAULT_LANGUAGE);
    let mut child = base_invocation(&launch)?
        .args(["--marionette", "--remote-debugging-port"])
        .arg(port.get().to_string())
        .arg(format!("--lang={language}"))
        .spawn_kill_on_drop()?;
    wait_until_listening(&mut child, LISTENING_MARKER).await?;
    let client = BidiClient::new(port, launch.extension_directory.to_path_buf());
    client.reload_extension().await?;
    client.open_in_first_tab(START_URL).await?;
    let driver = Driver {
        label: launch.spec.label(),
        protocol: Protocol::Bidi(client),
        is_extension_loaded: true,
    };
    Ok((child, driver))
}
