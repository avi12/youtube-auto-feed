//! The warm Node process that runs `wxt`'s `build()`, so a rebuild skips the cold start.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use crate::browser::BuildTarget;
use crate::error::{Error, Result};

const WORKER_SOURCE: &str = include_str!("../../assets/wxt-build-worker.mjs");
const WORKER_FILE: &str = "wxt-build-worker.mjs";
/// Inside `node_modules`, so the script's `import "wxt"` resolves.
const WORKER_DIRECTORY: &str = "node_modules/.cache/dev-server";
const NODE_COMMAND: &str = "node";
const MANIFEST_VERSION: u8 = 3;
/// Read by `wxt.config.ts`: inline source maps and the `__ytafDebug` bridge.
const DEV_SERVER_VARIABLE: &str = "WXT_DEV_SERVER";

/// The config handed to `build()`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest<'request> {
    root: &'request Path,
    browser: &'static str,
    manifest_version: u8,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
enum WorkerReply {
    Done,
    Failed { message: String },
}

pub(super) struct WxtWorker {
    process: Child,
    stdin: ChildStdin,
    stdout_lines: Lines<BufReader<ChildStdout>>,
}

async fn ensure_script(project_root: &Path) -> Result<PathBuf> {
    let directory = project_root.join(WORKER_DIRECTORY);
    let script = directory.join(WORKER_FILE);
    fs::create_dir_all(&directory).await?;
    fs::write(&script, WORKER_SOURCE).await?;
    Ok(script)
}

impl WxtWorker {
    pub(super) async fn spawn(project_root: &Path) -> Result<Self> {
        let script = ensure_script(project_root).await?;
        let mut process = Command::new(NODE_COMMAND)
            .arg(&script)
            .current_dir(project_root)
            .env(DEV_SERVER_VARIABLE, "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        let (Some(stdin), Some(stdout)) = (process.stdin.take(), process.stdout.take()) else {
            return Err(Error::Build("the WXT worker has no stdio".to_owned()));
        };
        Ok(Self {
            process,
            stdin,
            stdout_lines: BufReader::new(stdout).lines(),
        })
    }

    pub(super) fn is_alive(&mut self) -> bool {
        matches!(self.process.try_wait(), Ok(None))
    }

    pub(super) async fn build(&mut self, project_root: &Path, target: BuildTarget) -> Result<()> {
        let line = serde_json::to_string(&WorkerRequest {
            root: project_root,
            browser: target.wxt_name(),
            manifest_version: MANIFEST_VERSION,
        })?;
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        let Some(reply) = self.stdout_lines.next_line().await? else {
            return Err(Error::Build("the WXT worker exited mid-build".to_owned()));
        };
        match serde_json::from_str::<WorkerReply>(&reply)? {
            WorkerReply::Done => Ok(()),
            WorkerReply::Failed { message } => Err(Error::Build(message)),
        }
    }
}
