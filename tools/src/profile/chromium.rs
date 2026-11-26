//! The Edge and Chrome dev profiles: their own user-data directories, seeded once from the real
//! profile's bookmarks and never writing to the real one.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::browser::Chromium;
use crate::error::Result;
use crate::launcher::log_event;
use crate::profile::{clone_files, seed_once, Environment};

const DEFAULT_PROFILE_NAME: &str = "Default";
const SEEDED_SENTINEL: &str = "Default/.seeded";
const SEEDED_FILES: [&str; 2] = ["Default/Bookmarks", "Profile 1/Bookmarks"];

fn user_data_directory(browser: Chromium, environment: &Environment) -> PathBuf {
    let (windows, mac, linux) = match browser {
        Chromium::Edge => (
            "Microsoft/Edge/User Data",
            "Library/Application Support/Microsoft Edge",
            ".config/microsoft-edge",
        ),
        Chromium::Chrome => (
            "Google/Chrome/User Data",
            "Library/Application Support/Google/Chrome",
            ".config/google-chrome",
        ),
    };
    if cfg!(windows) {
        return environment.directory("LOCALAPPDATA").join(windows);
    }
    if cfg!(target_os = "macos") {
        return environment.home().join(mac);
    }
    environment.home().join(linux)
}

/// The object under `key`, replacing whatever else sits there.
fn object<'map>(
    map: &'map mut Map<String, Value>,
    key: &str,
) -> Option<&'map mut Map<String, Value>> {
    let entry = map.entry(key).or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    entry.as_object_mut()
}

/// Reloading an unpacked extension needs developer mode, which a seeded profile may have off.
fn with_developer_mode(stored: &str) -> Value {
    let mut preferences: Map<String, Value> = serde_json::from_str(stored).unwrap_or_default();
    if let Some(interface) =
        object(&mut preferences, "extensions").and_then(|map| object(map, "ui"))
    {
        interface.insert("developer_mode".to_owned(), Value::Bool(true));
    }
    Value::Object(preferences)
}

pub(crate) fn setup(
    browser: Chromium,
    profile: &Path,
    environment: &Environment,
    is_extension_loaded: bool,
) -> Result<()> {
    seed_once(&profile.join(SEEDED_SENTINEL), || {
        let source = user_data_directory(browser, environment);
        if !source.is_dir() {
            return Ok(());
        }
        log_event(&format!(
            "Seeding the dev profile from {}",
            source.display()
        ));
        clone_files(&source, profile, &SEEDED_FILES)
    })?;
    if !is_extension_loaded {
        return Ok(());
    }
    let preferences = profile.join(DEFAULT_PROFILE_NAME).join("Preferences");
    let stored = std::fs::read_to_string(&preferences).unwrap_or_default();
    std::fs::write(preferences, with_developer_mode(&stored).to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::profile::chromium::*;

    #[test]
    fn developer_mode_is_added_without_losing_preferences() {
        let next = with_developer_mode(r#"{"a":1,"extensions":{"b":2}}"#);
        assert_eq!(
            next,
            json!({"a":1,"extensions":{"b":2,"ui":{"developer_mode":true}}})
        );
        assert_eq!(
            with_developer_mode("not json"),
            json!({"extensions":{"ui":{"developer_mode":true}}})
        );
    }

    #[test]
    fn a_profile_is_seeded_once() -> Result<()> {
        let root = std::env::temp_dir().join(format!("dev-seed-{}", std::process::id()));
        let sentinel = root.join(SEEDED_SENTINEL);
        let mut seeds = 0;
        for _ in 0..2 {
            seed_once(&sentinel, || {
                seeds += 1;
                Ok(())
            })?;
        }
        std::fs::remove_dir_all(&root)?;
        assert_eq!(seeds, 1);
        Ok(())
    }
}
