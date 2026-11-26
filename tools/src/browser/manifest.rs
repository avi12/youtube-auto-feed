//! What the launchers read from the built `manifest.json`.

use std::path::Path;

use serde::Deserialize;

use crate::error::Result;

#[derive(Debug, Deserialize)]
pub(super) struct Manifest {
    pub(super) name: String,
}

impl Manifest {
    pub(super) fn read(extension_directory: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(extension_directory.join("manifest.json"))?;
        Ok(serde_json::from_str(&text)?)
    }
}

#[cfg(test)]
mod tests {
    use crate::browser::manifest::*;

    #[test]
    fn the_name_is_read_and_other_keys_are_ignored() -> Result<()> {
        let manifest: Manifest = serde_json::from_str(r#"{"name":"a","version":"1"}"#)?;
        assert_eq!(manifest.name, "a");
        Ok(())
    }
}
