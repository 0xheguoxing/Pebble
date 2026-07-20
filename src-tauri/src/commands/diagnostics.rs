use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub const LOG_FILE_NAME: &str = "pebble.log";
const DEFAULT_LOG_MAX_BYTES: u64 = 64 * 1024;
const MAX_LOG_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppLogSnapshot {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

pub fn app_log_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

fn app_log_path(app_data_dir: &Path) -> PathBuf {
    app_log_dir(app_data_dir).join(LOG_FILE_NAME)
}

fn read_log_tail(path: &Path, max_bytes: u64) -> Result<AppLogSnapshot, String> {
    let path_display = path.display().to_string();
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(AppLogSnapshot {
            path: path_display,
            content: String::new(),
            truncated: false,
        });
    };

    let file_len = metadata.len();
    let truncated = file_len > max_bytes;
    let start = if truncated { file_len - max_bytes } else { 0 };
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open app log: {e}"))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("Failed to seek app log: {e}"))?;

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read app log: {e}"))?;

    Ok(AppLogSnapshot {
        path: path_display,
        content: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

#[tauri::command]
pub fn read_app_log(app: AppHandle, max_bytes: Option<u64>) -> Result<AppLogSnapshot, String> {
    let app_data_dir = crate::profile::require_managed_app_data_dir(&app)?;
    let max_bytes = max_bytes
        .unwrap_or(DEFAULT_LOG_MAX_BYTES)
        .clamp(1, MAX_LOG_MAX_BYTES);
    read_log_tail(&app_log_path(&app_data_dir), max_bytes)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_log_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pebble-diagnostics-test-{}-{nonce}.log",
            std::process::id()
        ))
    }

    #[test]
    fn read_log_tail_returns_only_recent_bytes_when_file_is_large() {
        let path = temp_log_path();
        fs::write(&path, "alpha\nbeta\ngamma\n").expect("test log should be writable");

        let snapshot = super::read_log_tail(&path, 11).expect("tail should be readable");

        assert_eq!(snapshot.content, "beta\ngamma\n");
        assert_eq!(snapshot.path, path.display().to_string());
        assert!(snapshot.truncated);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn read_log_tail_returns_empty_snapshot_when_file_is_missing() {
        let path = temp_log_path();

        let snapshot = super::read_log_tail(&path, 128).expect("missing log should not error");

        assert_eq!(snapshot.content, "");
        assert_eq!(snapshot.path, path.display().to_string());
        assert!(!snapshot.truncated);
    }
}
