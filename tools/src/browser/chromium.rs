//! Edge, Chrome and Chrome for Testing, on fixed debug ports and their own dev profiles.

use std::path::PathBuf;

use dev_hot::driver::cdp::{CdpClient, CHROME_EXTENSIONS_PAGE, EDGE_EXTENSIONS_PAGE};
use tokio::process::Child;

use crate::browser::cft::ensure_chrome;
use crate::browser::driver::{Driver, Protocol};
use crate::browser::manifest::Manifest;
use crate::browser::startup::{require_port, wait_until_listening};
use crate::browser::{find_under_roots, Chromium, Launch, START_URL};
use crate::error::{Error, Result};
use crate::process::Invocation;
use crate::profile;

const LISTENING_MARKER: &str = "DevTools listening on";
const WINDOWS_PROGRAM_ROOTS: [&str; 3] = ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"];
/// Branded builds dropped `--load-extension`; this re-enables it where the switch still exists.
/// Elsewhere the dev profile keeps an extension loaded once with "Load unpacked".
const LOAD_EXTENSION_SWITCH_FEATURE: &str =
    "--disable-features=DisableLoadExtensionCommandLineSwitch";

struct Install {
    name: &'static str,
    /// Where the devtools MCP servers attach.
    cdp_port: u16,
    extensions_page: &'static str,
    windows_binary: &'static str,
    mac_binary: &'static str,
    linux_binary: &'static str,
}

const fn install(browser: Chromium) -> Install {
    match browser {
        Chromium::Edge => Install {
            name: "Edge",
            cdp_port: 9232,
            extensions_page: EDGE_EXTENSIONS_PAGE,
            windows_binary: "Microsoft/Edge/Application/msedge.exe",
            mac_binary: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            linux_binary: "microsoft-edge",
        },
        Chromium::Chrome => Install {
            name: "Chrome",
            cdp_port: 9231,
            extensions_page: CHROME_EXTENSIONS_PAGE,
            windows_binary: "Google/Chrome/Application/chrome.exe",
            mac_binary: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            linux_binary: "google-chrome",
        },
    }
}

fn find_binary(install: &Install, launch: &Launch<'_>) -> Result<PathBuf> {
    if cfg!(target_os = "macos") {
        return Ok(PathBuf::from(install.mac_binary));
    }
    if !cfg!(windows) {
        return Ok(PathBuf::from(install.linux_binary));
    }
    find_under_roots(
        launch.environment,
        &WINDOWS_PROGRAM_ROOTS,
        install.windows_binary,
    )
    .ok_or_else(|| Error::Browser(format!("could not find {}", install.name)))
}

pub(crate) async fn launch(browser: Chromium, launch: Launch<'_>) -> Result<(Child, Driver)> {
    let install = install(browser);
    let is_extension_loaded = launch.spec.is_extension_loaded;
    profile::chromium::setup(
        browser,
        launch.profile_directory,
        launch.environment,
        is_extension_loaded,
    )?;
    let port = require_port(install.cdp_port, &format!("{} CDP", install.name))?;
    let binary = if launch.spec.is_chrome_for_testing() {
        ensure_chrome(launch.project_root).await?
    } else {
        find_binary(&install, &launch)?
    };
    let mut invocation = Invocation::new(binary).args([
        format!("--user-data-dir={}", launch.profile_directory.display()),
        "--remote-debugging-address=127.0.0.1".to_owned(),
        format!("--remote-debugging-port={}", port.get()),
        "--no-first-run".to_owned(),
        "--no-default-browser-check".to_owned(),
        "--disable-blink-features=AutomationControlled".to_owned(),
        "--mute-audio".to_owned(),
    ]);
    let mut extension_name = String::new();
    if is_extension_loaded {
        invocation = invocation
            .arg(format!(
                "--load-extension={}",
                launch.extension_directory.display()
            ))
            .arg(LOAD_EXTENSION_SWITCH_FEATURE);
        extension_name = Manifest::read(launch.extension_directory)?.name;
    }
    let mut child = invocation.arg(START_URL).spawn_kill_on_drop()?;
    wait_until_listening(&mut child, LISTENING_MARKER).await?;
    let driver = Driver {
        label: launch.spec.label(),
        protocol: Protocol::Cdp(CdpClient::new(
            port,
            extension_name,
            install.extensions_page,
        )),
        is_extension_loaded,
    };
    Ok((child, driver))
}
