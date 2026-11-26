//! The Firefox dev profile: seeded once from the real session, plus the prefs the dev server
//! needs.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::error::Result;
use crate::launcher::log_event;
use crate::profile::{clone_files, seed_once, Environment};

const PROFILES_INI: &str = "profiles.ini";
const PROFILE_LOCK_FILES: [&str; 3] = ["parent.lock", ".parentlock", "lock"];
const SEEDED_SENTINEL: &str = ".seeded";
const SESSION_FILES: [&str; 7] = [
    "cookies.sqlite",
    "key4.db",
    "logins.json",
    "cert9.db",
    "permissions.sqlite",
    "places.sqlite",
    "favicons.sqlite",
];

fn data_directory(environment: &Environment) -> PathBuf {
    if cfg!(windows) {
        return environment.directory("APPDATA").join("Mozilla/Firefox");
    }
    if cfg!(target_os = "macos") {
        return environment
            .home()
            .join("Library/Application Support/Firefox");
    }
    environment.home().join(".mozilla/firefox")
}

#[derive(Default)]
struct IniProfile {
    path: Option<String>,
    is_default: bool,
    is_relative: bool,
}

fn is_profile_header(line: &str) -> bool {
    let digit = line
        .strip_prefix("[Profile")
        .and_then(|rest| rest.chars().next());
    digit.is_some_and(|character| character.is_ascii_digit())
}

/// The `[Install...] Default=` profile Firefox actually launches, else the `Default=1` profile.
fn default_profile_path(ini: &str, data_directory: &Path) -> Option<PathBuf> {
    let mut is_install_section = false;
    let mut profiles: Vec<IniProfile> = Vec::new();
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            is_install_section = line.starts_with("[Install");
            if is_profile_header(line) {
                profiles.push(IniProfile::default());
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("Default=").filter(|_| is_install_section) {
            return Some(data_directory.join(value.trim()));
        }
        let Some(profile) = profiles.last_mut().filter(|_| !is_install_section) else {
            continue;
        };
        match line.split_once('=') {
            Some(("Path", value)) => profile.path = Some(value.trim().to_owned()),
            Some(("Default", "1")) => profile.is_default = true,
            Some(("IsRelative", "1")) => profile.is_relative = true,
            _ => {}
        }
    }
    let default = profiles.into_iter().find(|profile| profile.is_default)?;
    let path = PathBuf::from(default.path?);
    Some(if default.is_relative {
        data_directory.join(path)
    } else {
        path
    })
}

/// `user.js` is merged into the prefs at every startup.
fn user_prefs() -> String {
    let prefs: [(&str, Value); 7] = [
        // MV3 treats host permissions as optional; granting them lets the content script run
        ("extensions.originControls.grantByDefault", json!(true)),
        ("app.update.auto", json!(false)),
        ("app.update.enabled", json!(false)),
        ("browser.shell.checkDefaultBrowser", json!(false)),
        ("browser.startup.homepage_override.mstone", json!("ignore")),
        ("browser.tabs.warnOnClose", json!(false)),
        ("media.volume_scale", json!("0.0")),
    ];
    prefs.iter().fold(String::new(), |lines, (name, value)| {
        format!("{lines}user_pref(\"{name}\", {value});\n")
    })
}

/// Seeds the dev profile once from the real session, so the dev sign-in survives later launches.
pub(crate) fn setup(profile: &Path, environment: &Environment) -> Result<()> {
    std::fs::create_dir_all(profile)?;
    for lock in PROFILE_LOCK_FILES {
        std::fs::remove_file(profile.join(lock)).ok();
    }
    seed_once(&profile.join(SEEDED_SENTINEL), || {
        let data = data_directory(environment);
        let ini = std::fs::read_to_string(data.join(PROFILES_INI)).unwrap_or_default();
        let Some(source) = default_profile_path(&ini, &data).filter(|path| path.is_dir()) else {
            return Ok(());
        };
        log_event(&format!(
            "Seeding the Firefox dev profile from {}",
            source.display()
        ));
        clone_files(&source, profile, &SESSION_FILES)
    })?;
    std::fs::write(profile.join("user.js"), user_prefs())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::profile::firefox::*;

    #[test]
    fn the_install_section_names_the_profile_in_use() {
        let ini = "[Profile0]\nPath=a\nDefault=1\n[Install1A]\nDefault=Profiles/b\n";
        assert_eq!(
            default_profile_path(ini, Path::new("data")),
            Some(Path::new("data").join("Profiles/b"))
        );
    }
}
