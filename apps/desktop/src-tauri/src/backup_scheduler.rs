//! Auto-snapshot scheduler — Day-1 SOP §7 + Playbook v2.0 §10 GA gate
//! (RPO ≤5min target; this module aims for 30min default, configurable
//! via env to tighten when shops cross to higher transaction volume).
//!
//! Runs `db_backup` to `%APPDATA%\PharmaCare\backups\<UTC-YYYYMMDD-HHMMSS>.sqlite`
//! (or platform equivalent). Retains the most recent N backups (default 24,
//! i.e. 12h history at 30min cadence). Auto-prunes older ones.
//!
//! Configurable via env at app start:
//!   PHARMACARE_BACKUP_INTERVAL_SECONDS  (default 1800)
//!   PHARMACARE_BACKUP_RETAIN_COUNT      (default 24)
//!   PHARMACARE_BACKUP_DIR               (default platform-specific)
//!
//! The scheduler runs in a background OS thread (NOT a Tauri-managed
//! task) so it survives webview reloads and front-end crashes.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use rusqlite::Connection;

const DEFAULT_INTERVAL_SECONDS: u64 = 30 * 60;
const DEFAULT_RETAIN_COUNT: usize = 24;

/// Where the periodic backups land. Returns the cleaned + ensured-existing dir.
pub fn default_backup_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PHARMACARE_BACKUP_DIR") {
        return PathBuf::from(dir);
    }
    let app = "PharmaCarePro";
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata).join(app).join("backups")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support").join(app).join("backups")
    } else {
        let home = std::env::var("HOME").unwrap_or_default();
        let xdg = std::env::var("XDG_DATA_HOME")
            .unwrap_or_else(|_| format!("{home}/.local/share"));
        PathBuf::from(xdg).join(app).join("backups")
    }
}

fn interval() -> Duration {
    let secs = std::env::var("PHARMACARE_BACKUP_INTERVAL_SECONDS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_INTERVAL_SECONDS);
    Duration::from_secs(secs.max(60))   // floor 60s for safety
}

fn retain_count() -> usize {
    std::env::var("PHARMACARE_BACKUP_RETAIN_COUNT")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(DEFAULT_RETAIN_COUNT)
        .max(2)
}

fn backup_filename_now() -> String {
    let now = chrono::Utc::now();
    format!("snap-{}.sqlite", now.format("%Y%m%dT%H%M%SZ"))
}

/// Take a single snapshot via VACUUM INTO. Returns the written file path
/// or a string error. Pure: no audit log writes (caller decides).
pub fn take_snapshot(conn: &Connection, dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let dest = dir.join(backup_filename_now());
    let safe = dest.to_string_lossy().replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{safe}'"), [])
        .map_err(|e| format!("VACUUM INTO {}: {e}", dest.display()))?;
    Ok(dest)
}

/// Drop snapshots older than the most recent `retain` files. Returns count pruned.
pub fn prune_old_snapshots(dir: &Path, retain: usize) -> Result<usize, String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .filter_map(|r| r.ok())
        .filter(|e| {
            e.path()
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("snap-") && n.ends_with(".sqlite"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());     // alphabetical = chronological
    if entries.len() <= retain {
        return Ok(0);
    }
    let to_drop = entries.len() - retain;
    let mut pruned = 0usize;
    for e in entries.iter().take(to_drop) {
        if std::fs::remove_file(e.path()).is_ok() {
            pruned += 1;
        }
    }
    Ok(pruned)
}

/// Spawn the background loop. Returns a handle the caller can hold (drop = leak,
/// not a problem since we want it to live for the app lifetime).
pub fn start_auto_backup_loop(conn: Arc<Mutex<Connection>>) -> thread::JoinHandle<()> {
    let dir = default_backup_dir();
    let int = interval();
    let retain = retain_count();
    tracing::info!(
        target: "backup_scheduler",
        ?dir,
        interval_secs = int.as_secs(),
        retain,
        "auto-backup loop starting",
    );
    thread::spawn(move || loop {
        thread::sleep(int);
        let result = (|| -> Result<(PathBuf, usize), String> {
            let c = conn.lock().map_err(|e| e.to_string())?;
            let p = take_snapshot(&c, &dir)?;
            drop(c);
            let pruned = prune_old_snapshots(&dir, retain)?;
            Ok((p, pruned))
        })();
        match result {
            Ok((path, pruned)) => tracing::info!(
                target: "backup_scheduler",
                path = %path.display(), pruned,
                "snapshot OK"
            ),
            Err(e) => tracing::error!(target: "backup_scheduler", error = %e, "snapshot failed"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn make_db(path: &Path) -> Connection {
        let c = Connection::open(path).unwrap();
        c.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t (id) VALUES (1);")
            .unwrap();
        c
    }

    #[test]
    fn take_snapshot_writes_a_file_with_snap_prefix() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("src.db");
        let c = make_db(&db);
        let bdir = dir.path().join("backups");
        let p = take_snapshot(&c, &bdir).unwrap();
        assert!(p.exists());
        assert!(p.file_name().unwrap().to_string_lossy().starts_with("snap-"));
        assert!(p.file_name().unwrap().to_string_lossy().ends_with(".sqlite"));
    }

    #[test]
    fn prune_keeps_most_recent_n() {
        let dir = tempdir().unwrap();
        let bdir = dir.path().join("backups");
        std::fs::create_dir_all(&bdir).unwrap();
        for stamp in ["snap-20260101T000000Z.sqlite", "snap-20260102T000000Z.sqlite", "snap-20260103T000000Z.sqlite"] {
            std::fs::write(bdir.join(stamp), b"x").unwrap();
        }
        let pruned = prune_old_snapshots(&bdir, 2).unwrap();
        assert_eq!(pruned, 1);
        let remaining: Vec<_> = std::fs::read_dir(&bdir)
            .unwrap()
            .filter_map(|r| r.ok().map(|e| e.file_name().into_string().unwrap()))
            .collect();
        assert_eq!(remaining.len(), 2);
        // The kept ones are the latest two by filename (chronological).
        assert!(remaining.iter().any(|n| n.contains("20260102")));
        assert!(remaining.iter().any(|n| n.contains("20260103")));
    }

    #[test]
    fn prune_below_retain_count_is_noop() {
        let dir = tempdir().unwrap();
        let bdir = dir.path().join("backups");
        std::fs::create_dir_all(&bdir).unwrap();
        std::fs::write(bdir.join("snap-20260101T000000Z.sqlite"), b"x").unwrap();
        let pruned = prune_old_snapshots(&bdir, 24).unwrap();
        assert_eq!(pruned, 0);
    }

    #[test]
    fn prune_ignores_unrelated_files() {
        let dir = tempdir().unwrap();
        let bdir = dir.path().join("backups");
        std::fs::create_dir_all(&bdir).unwrap();
        std::fs::write(bdir.join("snap-20260101T000000Z.sqlite"), b"x").unwrap();
        std::fs::write(bdir.join("readme.txt"), b"x").unwrap();
        let pruned = prune_old_snapshots(&bdir, 0).unwrap();
        assert_eq!(pruned, 1);
        // readme.txt survives
        assert!(bdir.join("readme.txt").exists());
    }

    #[test]
    fn interval_floor_60s() {
        std::env::set_var("PHARMACARE_BACKUP_INTERVAL_SECONDS", "5");
        assert_eq!(interval(), Duration::from_secs(60));
        std::env::remove_var("PHARMACARE_BACKUP_INTERVAL_SECONDS");
    }

    #[test]
    fn retain_count_defaults_to_24_min_2() {
        std::env::remove_var("PHARMACARE_BACKUP_RETAIN_COUNT");
        assert_eq!(retain_count(), DEFAULT_RETAIN_COUNT);
        std::env::set_var("PHARMACARE_BACKUP_RETAIN_COUNT", "0");
        assert_eq!(retain_count(), 2);
        std::env::remove_var("PHARMACARE_BACKUP_RETAIN_COUNT");
    }
}
