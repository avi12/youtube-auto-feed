//! How much a batch of saved files invalidates.

use crate::changes::watcher::ChangeBatch;

/// The directory holding the extension's own source.
pub const SOURCE_DIRECTORY: &str = "src";

/// What the next build has to redo. Ordered, so the widest scope of several batches wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BuildScope {
    /// Only extension source changed: a warm build is enough.
    Source,
    /// A build input outside the source changed (config, dependencies, env): start the build
    /// process afresh, so nothing it loaded earlier survives.
    Project,
}

impl BuildScope {
    /// The scope of one batch.
    pub fn for_batch(batch: &ChangeBatch) -> Self {
        let is_source_only = batch.events.iter().all(|event| {
            event
                .path
                .strip_prefix(SOURCE_DIRECTORY)
                .is_some_and(|rest| rest.starts_with('/'))
        });
        if is_source_only {
            return Self::Source;
        }
        Self::Project
    }
}

#[cfg(test)]
mod tests {
    use crate::changes::scope::*;
    use crate::changes::watcher::{ChangeEvent, ChangeKind};
    use crate::types::RelPath;

    fn batch(paths: &[&str]) -> ChangeBatch {
        ChangeBatch {
            events: paths
                .iter()
                .map(|path| ChangeEvent {
                    path: RelPath::new(path),
                    kind: ChangeKind::Modified,
                })
                .collect(),
        }
    }

    #[test]
    fn only_source_files_keep_the_build_warm() {
        assert_eq!(
            BuildScope::for_batch(&batch(&["src/a.ts"])),
            BuildScope::Source
        );
        for path in ["wxt.config.ts", "bun.lock", ".env.local", "srcx/a"] {
            assert_eq!(
                BuildScope::for_batch(&batch(&["src/a.ts", path])),
                BuildScope::Project
            );
        }
    }
}
