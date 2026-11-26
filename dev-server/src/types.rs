//! Newtypes for values that must not be mixed up: ports and project-relative paths.

use std::num::NonZeroU16;

use crate::error::Error;

/// A TCP port, never zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Port(NonZeroU16);

impl Port {
    /// A port, or [`Error::InvalidPort`] for zero.
    pub fn new(value: u16) -> Result<Self, Error> {
        NonZeroU16::new(value).map(Self).ok_or(Error::InvalidPort)
    }

    /// The port number.
    pub const fn get(self) -> u16 {
        self.0.get()
    }
}

/// A path relative to the extension project, always with forward slashes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RelPath(String);

impl RelPath {
    /// Normalizes backslashes to forward slashes.
    pub fn new(raw: impl AsRef<str>) -> Self {
        Self(raw.as_ref().replace('\\', "/"))
    }

    /// The normalized text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The rest of the path after `prefix`, when it starts with it.
    pub fn strip_prefix(&self, prefix: &str) -> Option<&str> {
        self.0.strip_prefix(prefix)
    }
}

#[cfg(test)]
mod tests {
    use crate::types::*;

    #[test]
    fn port_rejects_zero() {
        assert!(matches!(Port::new(0), Err(Error::InvalidPort)));
        assert_eq!(Port::new(9270).map(Port::get).ok(), Some(9270));
    }

    #[test]
    fn rel_path_normalizes_backslashes() {
        assert_eq!(
            RelPath::new(r"src\public\a.png").as_str(),
            "src/public/a.png"
        );
    }
}
