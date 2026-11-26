//! The development build: a warm WXT worker, replaced when the project around the source changes.

use std::path::PathBuf;
use std::time::Duration;

use dev_hot::changes::scope::BuildScope;
use dev_hot::orchestrator::Builder;
use tokio::time::sleep;

use crate::browser::BuildTarget;
use crate::error::{Error, Result};
use crate::launcher::wxt_worker::WxtWorker;

/// Windows briefly locks files another process (a scanner, the browser) has just touched.
const TRANSIENT_LOCK_MARKERS: [&str; 2] = ["EPERM", "EBUSY"];
const MAX_BUILD_ATTEMPTS: u32 = 3;
const BUILD_RETRY_DELAY: Duration = Duration::from_millis(300);

pub(super) struct WxtBuilder {
    project_root: PathBuf,
    targets: Vec<BuildTarget>,
    worker: Option<WxtWorker>,
}

fn is_retryable(error: &Error, attempt: u32) -> bool {
    let text = error.to_string();
    attempt < MAX_BUILD_ATTEMPTS
        && TRANSIENT_LOCK_MARKERS
            .iter()
            .any(|marker| text.contains(marker))
}

impl WxtBuilder {
    pub(super) const fn new(project_root: PathBuf, targets: Vec<BuildTarget>) -> Self {
        Self {
            project_root,
            targets,
            worker: None,
        }
    }

    async fn build_once(&mut self) -> Result<()> {
        let warm = self
            .worker
            .take()
            .and_then(|mut worker| worker.is_alive().then_some(worker));
        let mut worker = match warm {
            Some(worker) => worker,
            None => WxtWorker::spawn(&self.project_root).await?,
        };
        let outcome = self.build_targets(&mut worker).await;
        self.worker = Some(worker);
        outcome
    }

    async fn build_targets(&self, worker: &mut WxtWorker) -> Result<()> {
        for target in &self.targets {
            worker.build(&self.project_root, *target).await?;
        }
        Ok(())
    }

    pub(super) async fn build_with_lock_retry(&mut self) -> Result<()> {
        let mut attempt = 1;
        loop {
            match self.build_once().await {
                Err(error) if is_retryable(&error, attempt) => sleep(BUILD_RETRY_DELAY).await,
                outcome => return outcome,
            }
            attempt += 1;
        }
    }
}

impl Builder for WxtBuilder {
    async fn build(&mut self, scope: BuildScope) -> dev_hot::Result<()> {
        let is_project_build = scope == BuildScope::Project;
        if is_project_build {
            self.worker = None;
        }
        self.build_with_lock_retry()
            .await
            .map_err(|error| dev_hot::Error::Host {
                message: error.to_string(),
            })
    }
}
