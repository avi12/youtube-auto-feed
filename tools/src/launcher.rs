//! `devtool dev`: build, set up the dev profiles, launch the browsers and rebuild on every save
//! until every browser closes or Ctrl+C.

mod build;
mod log;
mod wxt_worker;

use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::Args;
use dev_hot::changes::scope::SOURCE_DIRECTORY;
use dev_hot::changes::watcher::{self, WatchConfig};
use dev_hot::orchestrator;
use dev_hot::types::RelPath;
use tokio::process::Child;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use self::build::WxtBuilder;
use self::log::install_log_layer;
pub(crate) use self::log::log_event;
use crate::browser::driver::{Driver, Drivers};
use crate::browser::{chromium, firefox, BuildTarget, Chromium, Launch, Spec, Vendor};
use crate::error::Result;
use crate::profile::{self, Environment};

/// Build inputs besides the source and the env files.
const WATCHED_CONFIG_FILES: [&str; 3] = ["wxt.config.ts", "package.json", "bun.lock"];
const WATCH_POLL_INTERVAL: Duration = Duration::from_millis(500);
const REBUILD_DEBOUNCE: Duration = Duration::from_millis(800);

/// Which browsers to launch; Edge with the extension when none is named.
#[derive(Debug, Args)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "each is one command-line flag"
)]
pub(crate) struct DevArgs {
    /// Edge with the extension.
    #[arg(long = "edge")]
    is_edge: bool,
    /// Edge without the extension.
    #[arg(long = "edge.no-extension")]
    is_bare_edge: bool,
    /// Chrome with the extension.
    #[arg(long = "chrome")]
    is_chrome: bool,
    /// Chrome without the extension.
    #[arg(long = "chrome.no-extension")]
    is_bare_chrome: bool,
    /// Firefox with the extension.
    #[arg(long = "firefox")]
    is_firefox: bool,
    /// Firefox without the extension.
    #[arg(long = "firefox.no-extension")]
    is_bare_firefox: bool,
    /// The extension project.
    #[arg(long, default_value = ".")]
    project_root: PathBuf,
}

impl DevArgs {
    /// One spec per named vendor, in launch order; `.no-extension` wins over the plain flag.
    fn specs(&self) -> Vec<Spec> {
        let specs: Vec<Spec> = Vendor::ALL
            .into_iter()
            .filter_map(|vendor| {
                let (is_loaded, is_bare) = match vendor {
                    Vendor::Chromium(Chromium::Edge) => (self.is_edge, self.is_bare_edge),
                    Vendor::Chromium(Chromium::Chrome) => (self.is_chrome, self.is_bare_chrome),
                    Vendor::Firefox => (self.is_firefox, self.is_bare_firefox),
                };
                (is_loaded || is_bare).then_some(Spec {
                    vendor,
                    is_extension_loaded: !is_bare,
                })
            })
            .collect();
        if specs.is_empty() {
            return vec![Spec {
                vendor: Vendor::Chromium(Chromium::Edge),
                is_extension_loaded: true,
            }];
        }
        specs
    }
}

fn watch_config(root: &Path) -> WatchConfig {
    let paths = std::iter::once(SOURCE_DIRECTORY)
        .chain(WATCHED_CONFIG_FILES)
        .chain(profile::ENV_FILES_MOST_SPECIFIC_FIRST)
        .map(RelPath::new)
        .collect();
    WatchConfig {
        root: root.to_path_buf(),
        paths,
        poll_interval: WATCH_POLL_INTERVAL,
        debounce: REBUILD_DEBOUNCE,
    }
}

/// The launched browsers: their processes, and the drivers of those that can be reached.
#[derive(Default)]
struct Browsers {
    processes: JoinSet<()>,
    drivers: Vec<Driver>,
}

impl Browsers {
    /// Holds the handle in a task, so dropping the set ends a browser still running.
    fn watch(&mut self, label: String, mut process: Child) {
        self.processes.spawn(async move {
            process.wait().await.ok();
            log_event(&format!("{label}: the browser closed"));
        });
    }

    async fn launch(&mut self, launch: Launch<'_>) -> Result<()> {
        let spec = launch.spec;
        let (process, driver) = match spec.vendor {
            Vendor::Chromium(browser) => {
                let (process, driver) = chromium::launch(browser, launch).await?;
                (process, Some(driver))
            }
            Vendor::Firefox if spec.is_extension_loaded => {
                let (process, driver) = firefox::launch(launch).await?;
                (process, Some(driver))
            }
            Vendor::Firefox => (firefox::launch_without_extension(launch)?, None),
        };
        self.drivers.extend(driver);
        self.watch(spec.label(), process);
        log_event(&format!("{}: launched", spec.label()));
        Ok(())
    }
}

/// The builds the browsers carrying the extension load, each once.
fn build_targets(specs: &[Spec]) -> Vec<BuildTarget> {
    let mut targets: Vec<BuildTarget> = specs
        .iter()
        .filter(|spec| spec.is_extension_loaded)
        .map(|spec| spec.vendor.build_target())
        .collect();
    targets.sort_unstable();
    targets.dedup();
    targets
}

pub(crate) async fn run(args: DevArgs) -> Result<()> {
    let specs = args.specs();
    let project_root = std::path::absolute(&args.project_root)?;
    install_log_layer()?;

    let environment = Environment::read(&project_root);
    for spec in &specs {
        let directory = profile::directory(&project_root, spec.vendor);
        profile::stop_leftover_instances(&directory).await?;
    }

    // Watching starts before the build, so a save made while the browsers start is not lost
    let shutdown = CancellationToken::new();
    let batches = watcher::spawn(watch_config(&project_root), shutdown.clone())?;
    log_event("Building (inline source maps)");
    let mut builder = WxtBuilder::new(project_root.clone(), build_targets(&specs));
    builder.build_with_lock_retry().await?;

    let mut browsers = Browsers::default();
    for spec in specs {
        let profile_directory = profile::directory(&project_root, spec.vendor);
        let extension_directory = spec.vendor.build_target().output_directory(&project_root);
        browsers
            .launch(Launch {
                spec,
                profile_directory: &profile_directory,
                extension_directory: &extension_directory,
                environment: &environment,
            })
            .await?;
    }

    log_event("Watching for changes");
    let Browsers {
        mut processes,
        drivers,
    } = browsers;
    let rebuilds = orchestrator::run(batches, builder, Drivers(drivers), shutdown.clone());
    tokio::select! {
        () = rebuilds => {}
        () = async { while processes.join_next().await.is_some() {} } => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    shutdown.cancel();
    log_event("Dev server stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use crate::launcher::*;

    #[derive(Parser)]
    struct Cli {
        #[command(flatten)]
        args: DevArgs,
    }

    fn labels(flags: &[&str]) -> Vec<String> {
        let command = std::iter::once("devtool").chain(flags.iter().copied());
        Cli::parse_from(command)
            .args
            .specs()
            .into_iter()
            .map(Spec::label)
            .collect()
    }

    #[test]
    fn edge_is_the_default_browser() {
        assert_eq!(labels(&[]), ["edge"]);
    }

    #[test]
    fn browsers_combine_with_and_without_the_extension() {
        assert_eq!(
            labels(&["--firefox", "--chrome.no-extension", "--edge"]),
            ["edge", "chrome.no-extension", "firefox"]
        );
    }
}
