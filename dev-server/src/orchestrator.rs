//! The one loop: a batch of saves, then a build, then a reload. Strictly one build at a time:
//! saves landing during a build queue up and are merged into a single follow-up run.

use std::future::Future;

use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::changes::scope::BuildScope;
use crate::changes::watcher::ChangeBatch;
use crate::driver::BrowserDriver;
use crate::error::Result;

/// Builds the extension into the directory the browser loaded it from.
pub trait Builder: Send {
    /// Runs one development build.
    fn build(&mut self, scope: BuildScope) -> impl Future<Output = Result<()>> + Send;
}

async fn apply<B: Builder, D: BrowserDriver>(
    builder: &mut B,
    driver: &D,
    scope: BuildScope,
) -> Result<usize> {
    builder.build(scope).await?;
    driver.reload_extension().await?;
    driver.reload_youtube_tabs().await
}

/// Rebuilds and reloads for every batch of changes until `shutdown` is cancelled or the watcher
/// stops. A failed build or reload is logged and the next save tries again.
pub async fn run<B: Builder, D: BrowserDriver>(
    mut batches: mpsc::Receiver<ChangeBatch>,
    mut builder: B,
    driver: D,
    shutdown: CancellationToken,
) {
    loop {
        let batch = tokio::select! {
            biased;
            () = shutdown.cancelled() => return,
            batch = batches.recv() => batch,
        };
        let Some(batch) = batch else {
            return;
        };
        let mut scope = BuildScope::for_batch(&batch);
        let mut count = batch.events.len();
        while let Ok(queued) = batches.try_recv() {
            scope = scope.max(BuildScope::for_batch(&queued));
            count += queued.events.len();
        }
        tracing::info!("{count} change(s) - rebuilding");
        let started = Instant::now();
        let outcome = tokio::select! {
            () = shutdown.cancelled() => return,
            outcome = apply(&mut builder, &driver, scope) => outcome,
        };
        match outcome {
            Ok(tabs) => tracing::info!(
                "Extension and {tabs} YouTube tab(s) reloaded in {:.1}s",
                started.elapsed().as_secs_f32()
            ),
            Err(error) => tracing::error!("{error}"),
        }
    }
}

#[cfg(test)]
mod tests;
