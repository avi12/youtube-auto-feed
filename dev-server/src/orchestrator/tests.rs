use std::future::{ready, Future};
use std::sync::{Arc, Mutex, PoisonError};

use crate::changes::watcher::{ChangeEvent, ChangeKind};
use crate::error::Error;
use crate::orchestrator::*;
use crate::types::RelPath;

#[derive(Debug, Clone, Default)]
struct Log(Arc<Mutex<Vec<String>>>);

impl Log {
    fn push(&self, line: String) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(line);
    }

    fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

struct FakeBuilder {
    log: Log,
    failures_left: usize,
}

impl Builder for FakeBuilder {
    fn build(&mut self, scope: BuildScope) -> impl Future<Output = Result<()>> + Send {
        self.log.push(format!("build {scope:?}"));
        let should_fail = self.failures_left > 0;
        if should_fail {
            self.failures_left -= 1;
            return ready(Err(Error::Host {
                message: "broken".to_owned(),
            }));
        }
        ready(Ok(()))
    }
}

struct FakeDriver(Log);

impl BrowserDriver for FakeDriver {
    fn reload_extension(&self) -> impl Future<Output = Result<()>> + Send {
        self.0.push("reload extension".to_owned());
        ready(Ok(()))
    }

    fn reload_youtube_tabs(&self) -> impl Future<Output = Result<usize>> + Send {
        self.0.push("reload tabs".to_owned());
        ready(Ok(1))
    }
}

fn batch(path: &str) -> ChangeBatch {
    ChangeBatch {
        events: vec![ChangeEvent {
            path: RelPath::new(path),
            kind: ChangeKind::Modified,
        }],
    }
}

async fn run_batches(paths: &[&str], failures_left: usize) -> Vec<String> {
    let log = Log::default();
    let (sender, receiver) = mpsc::channel(paths.len().max(1));
    for path in paths {
        sender.send(batch(path)).await.ok();
    }
    drop(sender);
    let builder = FakeBuilder {
        log: log.clone(),
        failures_left,
    };
    run(
        receiver,
        builder,
        FakeDriver(log.clone()),
        CancellationToken::new(),
    )
    .await;
    log.lines()
}

#[tokio::test]
async fn queued_batches_merge_into_one_build_of_the_widest_scope() {
    let lines = run_batches(&["src/a.ts", "wxt.config.ts"], 0).await;
    assert_eq!(lines, ["build Project", "reload extension", "reload tabs"]);
}

#[tokio::test]
async fn a_failed_build_reloads_nothing() {
    assert_eq!(run_batches(&["src/a.ts"], 1).await, ["build Source"]);
}
