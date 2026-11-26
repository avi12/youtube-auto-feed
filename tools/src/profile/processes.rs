//! Stopping the browser instances that run on one profile directory, found by command line and
//! stopped by process id, never by program name.

use std::path::Path;

use crate::error::Result;
use crate::process::Invocation;

const LIST_WINDOWS_PROCESSES: &str = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";

/// One running process: its id and full command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RunningProcess {
    pub(super) pid: u32,
    pub(super) command_line: String,
}

fn continues_a_path_segment(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '.')
}

fn mentions_profile(command_line: &str, profile: &str, is_case_insensitive: bool) -> bool {
    let (haystack, needle) = if is_case_insensitive {
        (command_line.to_lowercase(), profile.to_lowercase())
    } else {
        (command_line.to_owned(), profile.to_owned())
    };
    haystack.match_indices(&needle).any(|(start, found)| {
        haystack
            .get(start + found.len()..)
            .and_then(|rest| rest.chars().next())
            .is_none_or(|next| !continues_a_path_segment(next))
    })
}

/// The ids of the processes whose command line names `profile`, and of no other; none when the
/// profile path is empty or nothing matches.
pub(super) fn pids_on_profile(
    processes: &[RunningProcess],
    profile: &str,
    is_case_insensitive: bool,
    own_pid: u32,
) -> Vec<u32> {
    let profile = profile.trim_end_matches(['/', '\\']);
    if profile.is_empty() {
        return Vec::new();
    }
    processes
        .iter()
        .filter(|process| process.pid != own_pid)
        .filter(|process| mentions_profile(&process.command_line, profile, is_case_insensitive))
        .map(|process| process.pid)
        .collect()
}

fn parse_windows_listing(listing: &str) -> Vec<RunningProcess> {
    listing
        .lines()
        .filter_map(|line| {
            let (pid, command_line) = line.split_once('\t')?;
            Some(RunningProcess {
                pid: pid.trim().parse().ok()?,
                command_line: command_line.trim().to_owned(),
            })
        })
        .collect()
}

fn list_linux_processes() -> Vec<RunningProcess> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse().ok()?;
            let raw = std::fs::read(entry.path().join("cmdline")).ok()?;
            let command_line = String::from_utf8_lossy(&raw).replace('\0', " ");
            Some(RunningProcess { pid, command_line })
        })
        .collect()
}

/// macOS has no `/proc`, so a leftover instance there has to be closed by hand.
async fn list_processes() -> Result<Vec<RunningProcess>> {
    if !cfg!(windows) {
        return Ok(list_linux_processes());
    }
    let listing = Invocation::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            LIST_WINDOWS_PROCESSES,
        ])
        .capture_checked()
        .await?;
    Ok(parse_windows_listing(&listing))
}

/// A process that already ended is no failure.
async fn terminate(pid: u32) {
    let pid = pid.to_string();
    let invocation = if cfg!(windows) {
        Invocation::new("taskkill").args(["/PID", &pid, "/F"])
    } else {
        Invocation::new("kill").args(["-TERM", &pid])
    };
    if let Err(error) = invocation.capture_checked().await {
        tracing::debug!("could not stop process {pid}: {error}");
    }
}

/// Stops the browsers left over on `profile` from an earlier session.
pub(crate) async fn stop_on_profile(profile: &Path) -> Result<()> {
    let pids = pids_on_profile(
        &list_processes().await?,
        &profile.display().to_string(),
        cfg!(windows),
        std::process::id(),
    );
    for pid in pids {
        terminate(pid).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::profile::processes::*;

    const LOOKALIKE_PID: u32 = 3;
    const SELF_PID: u32 = 4;
    const WINDOWS_PID: u32 = 7;

    fn process(pid: u32, command_line: &str) -> RunningProcess {
        RunningProcess {
            pid,
            command_line: command_line.to_owned(),
        }
    }

    #[test]
    fn only_processes_naming_this_profile_match() {
        let processes = [
            process(1, "chrome --user-data-dir=/tmp/dev-profile --flag"),
            process(2, "chrome --user-data-dir=/home/me/.config/google-chrome"),
            process(LOOKALIKE_PID, "chrome --user-data-dir=/tmp/dev-profile2"),
            process(SELF_PID, "chrome --user-data-dir=/tmp/dev-profile"),
        ];
        let pids = pids_on_profile(&processes, "/tmp/dev-profile", false, SELF_PID);
        assert_eq!(pids, vec![1]);
    }

    #[test]
    fn nothing_matches_an_unused_or_empty_profile() {
        let processes = [process(1, "chrome --user-data-dir=/other")];
        assert_eq!(
            pids_on_profile(&processes, "/tmp/none", false, 0),
            Vec::<u32>::new()
        );
        assert_eq!(pids_on_profile(&processes, "", false, 0), Vec::<u32>::new());
    }

    #[test]
    fn windows_paths_match_regardless_of_case() {
        let processes = [process(
            WINDOWS_PID,
            r#"chrome.exe --user-data-dir="C:\Dev\Profile""#,
        )];
        assert_eq!(
            pids_on_profile(&processes, r"c:\dev\profile", true, 0),
            vec![WINDOWS_PID]
        );
        assert_eq!(
            pids_on_profile(&processes, r"c:\dev\profile", false, 0),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn the_windows_listing_parses_pid_and_command_line() {
        let parsed = parse_windows_listing("12\tfirefox -profile X\nbad line\n13\tchrome\n");
        assert_eq!(
            parsed,
            vec![process(12, "firefox -profile X"), process(13, "chrome")]
        );
    }
}
