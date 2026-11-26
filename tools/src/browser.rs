//! The dev browsers: which ones a session runs, what differs between them, and how each is
//! launched.

pub(crate) mod chromium;
pub(crate) mod driver;
pub(crate) mod firefox;
mod manifest;
mod startup;

use std::path::{Path, PathBuf};

use crate::profile::Environment;

/// The page every dev browser opens on.
pub(crate) const START_URL: &str = "https://www.youtube.com/feed/subscriptions";
const OUTPUT_DIRECTORY: &str = ".output";

/// The installed Chromium browsers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Chromium {
    Edge,
    Chrome,
}

/// A dev browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Vendor {
    Chromium(Chromium),
    Firefox,
}

impl Vendor {
    /// Every vendor, in launch order.
    pub(crate) const ALL: [Self; 3] = [
        Self::Chromium(Chromium::Edge),
        Self::Chromium(Chromium::Chrome),
        Self::Firefox,
    ];

    /// The lowercase name, as the command-line flags spell it.
    pub(crate) const fn flag(self) -> &'static str {
        match self {
            Self::Chromium(Chromium::Edge) => "edge",
            Self::Chromium(Chromium::Chrome) => "chrome",
            Self::Firefox => "firefox",
        }
    }

    pub(crate) const fn build_target(self) -> BuildTarget {
        match self {
            Self::Chromium(_) => BuildTarget::Chromium,
            Self::Firefox => BuildTarget::Firefox,
        }
    }
}

/// One browser of a session, with or without the extension sideloaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Spec {
    pub(crate) vendor: Vendor,
    pub(crate) is_extension_loaded: bool,
}

impl Spec {
    /// `edge`, or `chrome.no-extension` for a browser without the extension.
    pub(crate) fn label(self) -> String {
        if self.is_extension_loaded {
            return self.vendor.flag().to_owned();
        }
        format!("{}.no-extension", self.vendor.flag())
    }
}

/// The WXT build a vendor loads: every Chromium browser shares one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BuildTarget {
    Chromium,
    Firefox,
}

impl BuildTarget {
    pub(crate) const fn wxt_name(self) -> &'static str {
        match self {
            Self::Chromium => "chrome",
            Self::Firefox => "firefox",
        }
    }

    /// WXT's default output folder for a Manifest V3 build of the target.
    pub(crate) fn output_directory(self, project_root: &Path) -> PathBuf {
        let folder = match self {
            Self::Chromium => "chrome-mv3",
            Self::Firefox => "firefox-mv3",
        };
        project_root.join(OUTPUT_DIRECTORY).join(folder)
    }
}

/// What a launch needs.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Launch<'a> {
    pub(crate) spec: Spec,
    pub(crate) profile_directory: &'a Path,
    /// The build sideloaded when the spec loads the extension.
    pub(crate) extension_directory: &'a Path,
    pub(crate) environment: &'a Environment,
}

/// The first `relative` path under one of the Windows install roots that exists.
fn find_under_roots(environment: &Environment, roots: &[&str], relative: &str) -> Option<PathBuf> {
    roots
        .iter()
        .filter_map(|root| environment.get(root))
        .map(|root| Path::new(root).join(relative))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use crate::browser::*;

    #[test]
    fn labels_name_browsers_without_the_extension() {
        let edge = Spec {
            vendor: Vendor::Chromium(Chromium::Edge),
            is_extension_loaded: true,
        };
        let chrome = Spec {
            vendor: Vendor::Chromium(Chromium::Chrome),
            is_extension_loaded: false,
        };
        assert_eq!(
            (edge.label(), chrome.label()),
            ("edge".to_owned(), "chrome.no-extension".to_owned())
        );
    }

    #[test]
    fn chromium_browsers_share_one_build() {
        let root = Path::new("root");
        assert_eq!(
            Vendor::Chromium(Chromium::Edge)
                .build_target()
                .output_directory(root),
            root.join(".output/chrome-mv3")
        );
        assert_eq!(
            Vendor::Firefox.build_target().output_directory(root),
            root.join(".output/firefox-mv3")
        );
    }
}
