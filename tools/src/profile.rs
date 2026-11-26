//! The dev browser profiles under `user-profiles/`, seeded once from the real ones.

pub(crate) mod chromium;
pub(crate) mod firefox;
mod processes;

use std::collections::BTreeMap;
use std::env;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub(crate) use self::processes::stop_on_profile as stop_leftover_instances;
use crate::browser::Vendor;
use crate::error::Result;
use crate::launcher::log_event;

const USER_PROFILES_DIRECTORY: &str = "user-profiles";
/// Dotenv files in WXT's development cascade; the first one naming a variable wins.
pub(crate) const ENV_FILES_MOST_SPECIFIC_FIRST: [&str; 4] = [
    ".env.development.local",
    ".env.development",
    ".env.local",
    ".env",
];
/// Windows error codes of a file another process holds open.
const WINDOWS_SHARING_ERRORS: [i32; 2] = [32, 33];

/// The variables the profiles read: the process environment first, then the dotenv cascade. The
/// process environment is never written, so the build keeps reading edited files.
#[derive(Debug, Default)]
pub(crate) struct Environment(BTreeMap<String, String>);

impl Environment {
    pub(crate) fn read(project_root: &Path) -> Self {
        let mut variables: BTreeMap<String, String> = env::vars().collect();
        let files = ENV_FILES_MOST_SPECIFIC_FIRST
            .iter()
            .filter_map(|file| dotenvy::from_path_iter(project_root.join(file)).ok());
        for (name, value) in files.flatten().flatten() {
            variables.entry(name).or_insert(value);
        }
        Self(variables)
    }

    pub(crate) fn get(&self, name: &str) -> Option<&str> {
        self.0
            .get(name)
            .map(String::as_str)
            .filter(|value| !value.is_empty())
    }

    fn directory(&self, name: &str) -> PathBuf {
        self.get(name).map_or_else(PathBuf::new, PathBuf::from)
    }

    fn home(&self) -> PathBuf {
        self.directory(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
    }
}

/// The profile directory of one browser, kept across sessions so its sign-ins survive.
pub(crate) fn directory(project_root: &Path, vendor: Vendor) -> PathBuf {
    project_root
        .join(USER_PROFILES_DIRECTORY)
        .join(vendor.flag())
}

/// Runs `seed` unless `sentinel` exists, then creates it, so a profile is seeded only once and
/// later sessions keep whatever the dev browser stored since.
fn seed_once(sentinel: &Path, seed: impl FnOnce() -> Result<()>) -> Result<()> {
    if sentinel.exists() {
        return Ok(());
    }
    seed()?;
    if let Some(parent) = sentinel.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(sentinel, "")?;
    Ok(())
}

/// Copies the files that exist. A running source browser holds some open, so a locked file is
/// skipped: the dev profile still comes up, just without that file's continuity.
fn clone_files(source: &Path, destination: &Path, files: &[&str]) -> Result<()> {
    for file in files {
        let from = source.join(file);
        if !from.is_file() {
            continue;
        }
        let to = destination.join(file);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        match std::fs::copy(&from, &to) {
            Ok(_) => {}
            Err(error) if is_locked(&error) => {
                log_event(&format!(
                    "Skipped locked profile file (source browser running?): {file}"
                ));
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn is_locked(error: &std::io::Error) -> bool {
    let is_sharing_violation = cfg!(windows)
        && error
            .raw_os_error()
            .is_some_and(|code| WINDOWS_SHARING_ERRORS.contains(&code));
    is_sharing_violation || error.kind() == ErrorKind::PermissionDenied
}

#[cfg(test)]
mod tests {
    use crate::profile::*;

    #[test]
    fn only_existing_files_are_cloned() -> Result<()> {
        let root = env::temp_dir().join(format!("dev-clone-{}", std::process::id()));
        std::fs::create_dir_all(root.join("from"))?;
        std::fs::write(root.join("from").join("a"), "1")?;
        clone_files(&root.join("from"), &root.join("to"), &["a", "b"])?;
        let cloned = (root.join("to/a").is_file(), root.join("to/b").exists());
        std::fs::remove_dir_all(&root)?;
        assert_eq!(cloned, (true, false));
        Ok(())
    }
}
