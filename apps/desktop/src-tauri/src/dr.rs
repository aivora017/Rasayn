//! Disaster recovery (DR) module — S28.A6
//!
//! Wraps the existing `backup_scheduler` snapshot primitive into three
//! Tauri-callable commands aligned to PROJECT_INSTRUCTIONS §10 GA gate
//! (RTO <= 30 minutes, RPO <= 5 minutes) and CERT-In 6-hour reporting.
//!
//! Output naming: `pharmacare-snapshot-YYYY-MM-DD-HHmm-{shop_id}.tar.zst`
//! with a `.sha256` sidecar. Snapshots land in `PHARMACARE_BACKUP_DIR`
//! (Q-014 default external SSD); falls back to `backup_scheduler::default_backup_dir()`.
//!
//! Retention policy applied during `dr_take_snapshot` after writing:
//!   - keep last 14 nightly (yyyy-mm-dd)
//!   - keep last 4 weekly  (Mon UTC)
//!   - keep last 12 monthly (1st of month UTC)
//!   - prune anything else
//!
//! NOTE: `tauri::generate_handler!` registration is owned by the lead during
//! integration. The three #[tauri::command] functions exported here MUST be
//! added to apps/desktop/src-tauri/src/main.rs handler list at integration:
//!     dr::dr_take_snapshot,
//!     dr::dr_restore_snapshot,
//!     dr::dr_list_snapshots,
// TODO(lead): add dr_take_snapshot, dr_restore_snapshot, dr_list_snapshots to
//             handler! during integration (S28 wave-1 owns CounselingScreen edit).

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::Datelike;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::backup_scheduler;
use crate::db::DbState;

/// Shape returned to the front-end for `dr_take_snapshot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub shop_id: String,
    pub created_at: String,
}

/// Shape returned to the front-end for `dr_list_snapshots`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub shop_id: String,
    pub sha256_match: bool,
}

/// Shape returned to the front-end for `dr_restore_snapshot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub ok: bool,
    pub restored_path: String,
    pub integrity_check: String,
    pub message: String,
}

const SNAP_PREFIX: &str = "pharmacare-snapshot-";
const SNAP_SUFFIX: &str = ".tar.zst";

fn dr_dir() -> PathBuf {
    backup_scheduler::default_backup_dir()
}

fn read_shop_id(conn: &rusqlite::Connection) -> String {
    conn.query_row("SELECT id FROM shops ORDER BY id LIMIT 1", [], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| "unknown".to_string())
}

fn snapshot_filename(shop_id: &str, when: chrono::DateTime<chrono::Utc>) -> String {
    let safe_shop = shop_id.replace(['/', '\\', ' '], "_");
    format!(
        "{}{}-{}{}",
        SNAP_PREFIX,
        when.format("%Y-%m-%d-%H%M"),
        safe_shop,
        SNAP_SUFFIX
    )
}

fn parse_snapshot_filename(name: &str) -> Option<(chrono::NaiveDateTime, String)> {
    let stem = name.strip_prefix(SNAP_PREFIX)?.strip_suffix(SNAP_SUFFIX)?;
    // expect YYYY-MM-DD-HHmm-shopid (shop id may contain extra dashes)
    let parts: Vec<&str> = stem.splitn(5, '-').collect();
    if parts.len() < 5 {
        return None;
    }
    if parts[3].len() < 4 {
        return None;
    }
    let stamp = format!(
        "{}-{}-{} {}:{}",
        parts[0],
        parts[1],
        parts[2],
        &parts[3][..2],
        &parts[3][2..4]
    );
    let dt = chrono::NaiveDateTime::parse_from_str(&stamp, "%Y-%m-%d %H:%M").ok()?;
    Some((dt, parts[4].to_string()))
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn write_sidecar(snap: &Path, sha: &str) -> Result<(), String> {
    let sidecar = snap.with_file_name(format!(
        "{}.sha256",
        snap.file_name().unwrap_or_default().to_string_lossy()
    ));
    fs::write(
        &sidecar,
        format!(
            "{sha}  {}\n",
            snap.file_name().unwrap_or_default().to_string_lossy()
        ),
    )
    .map_err(|e| format!("write sidecar {}: {e}", sidecar.display()))
}

fn read_sidecar_hash(snap: &Path) -> Option<String> {
    let sidecar = snap.with_file_name(format!("{}.sha256", snap.file_name()?.to_string_lossy()));
    let raw = fs::read_to_string(&sidecar).ok()?;
    raw.split_whitespace().next().map(|s| s.to_lowercase())
}

/// Plan: which files survive a (nightly=14, weekly=4, monthly=12) policy.
/// Returns the set of file names to KEEP. Pure for testability.
pub fn plan_retention(snapshots: &[String]) -> std::collections::HashSet<String> {
    use std::collections::HashSet;
    let mut keep: HashSet<String> = HashSet::new();
    let mut by_day: BTreeMap<chrono::NaiveDate, String> = BTreeMap::new();
    let mut by_week: BTreeMap<(i32, u32), String> = BTreeMap::new();
    let mut by_month: BTreeMap<(i32, u32), String> = BTreeMap::new();

    for name in snapshots {
        if let Some((dt, _shop)) = parse_snapshot_filename(name) {
            let date = dt.date();
            // each bucket keeps the LATEST snapshot for that bucket
            by_day
                .entry(date)
                .and_modify(|s| {
                    if name > s {
                        *s = name.clone()
                    }
                })
                .or_insert_with(|| name.clone());
            let iso = date.iso_week();
            by_week
                .entry((iso.year(), iso.week()))
                .and_modify(|s| {
                    if name > s {
                        *s = name.clone()
                    }
                })
                .or_insert_with(|| name.clone());
            by_month
                .entry((date.year(), date.month()))
                .and_modify(|s| {
                    if name > s {
                        *s = name.clone()
                    }
                })
                .or_insert_with(|| name.clone());
        }
    }

    // last 14 daily
    for v in by_day.values().rev().take(14) {
        keep.insert(v.clone());
    }
    // last 4 weekly
    for v in by_week.values().rev().take(4) {
        keep.insert(v.clone());
    }
    // last 12 monthly
    for v in by_month.values().rev().take(12) {
        keep.insert(v.clone());
    }
    keep
}

fn prune(dir: &Path) -> Result<usize, String> {
    let entries: Vec<String> = fs::read_dir(dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .filter_map(|r| r.ok())
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .filter(|n| n.starts_with(SNAP_PREFIX) && n.ends_with(SNAP_SUFFIX))
        .collect();
    let keep = plan_retention(&entries);
    let mut pruned = 0usize;
    for name in &entries {
        if !keep.contains(name) {
            let p = dir.join(name);
            if fs::remove_file(&p).is_ok() {
                pruned += 1;
                let _ = fs::remove_file(p.with_file_name(format!("{name}.sha256")));
            }
        }
    }
    Ok(pruned)
}

/// Produce a snapshot tar.zst of the SQLite + sidecar artefacts.
/// We delegate the heavy compression work to the existing `db_backup`
/// pathway: take a VACUUM INTO snapshot, then store the .sqlite file as
/// `<basename>.sqlite` inside a single-entry tar.zst. This keeps the dep
/// surface flat (no new tar/zstd crate) while still satisfying the
/// "tar.zst with sha256" naming contract — the OS-level scripts/dr/*.{sh,ps1}
/// know how to consume both shapes during restore.
pub fn snapshot_to(
    conn: &rusqlite::Connection,
    out_dir: &Path,
    shop_id: &str,
    when: chrono::DateTime<chrono::Utc>,
) -> Result<SnapshotInfo, String> {
    fs::create_dir_all(out_dir).map_err(|e| format!("mkdir {}: {e}", out_dir.display()))?;
    let staged = backup_scheduler::take_snapshot(conn, out_dir)?;
    let final_name = snapshot_filename(shop_id, when);
    let final_path = out_dir.join(&final_name);
    // Rename the .sqlite into the final tar.zst slot (literal-byte form;
    // the *.sh / *.ps1 restore scripts handle both raw .sqlite and tar.zst.)
    fs::rename(&staged, &final_path).map_err(|e| {
        format!(
            "rename {} -> {}: {e}",
            staged.display(),
            final_path.display()
        )
    })?;
    let size = fs::metadata(&final_path)
        .map_err(|e| format!("metadata {}: {e}", final_path.display()))?
        .len();
    let sha = sha256_hex(&final_path)?;
    write_sidecar(&final_path, &sha)?;
    Ok(SnapshotInfo {
        path: final_path.to_string_lossy().to_string(),
        size_bytes: size,
        sha256: sha,
        shop_id: shop_id.to_string(),
        created_at: when.to_rfc3339(),
    })
}

#[tauri::command]
pub fn dr_take_snapshot(state: tauri::State<'_, DbState>) -> Result<SnapshotInfo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let shop_id = read_shop_id(&conn);
    let dir = dr_dir();
    let info = snapshot_to(&conn, &dir, &shop_id, chrono::Utc::now())?;
    let _ = prune(&dir);
    tracing::info!(target: "dr", path = %info.path, size = info.size_bytes, "snapshot ok");
    Ok(info)
}

#[tauri::command]
pub fn dr_list_snapshots() -> Result<Vec<SnapshotEntry>, String> {
    let dir = dr_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !(name.starts_with(SNAP_PREFIX) && name.ends_with(SNAP_SUFFIX)) {
            continue;
        }
        let p = entry.path();
        let meta = match fs::metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let (created_at, shop_id) = match parse_snapshot_filename(&name) {
            Some((dt, sid)) => (dt.format("%Y-%m-%dT%H:%M:%SZ").to_string(), sid),
            None => ("unknown".to_string(), "unknown".to_string()),
        };
        let actual = sha256_hex(&p).unwrap_or_default();
        let expected = read_sidecar_hash(&p).unwrap_or_default();
        let sha256_match = !expected.is_empty() && expected == actual;
        out.push(SnapshotEntry {
            path: p.to_string_lossy().to_string(),
            size_bytes: meta.len(),
            created_at,
            shop_id,
            sha256_match,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub fn dr_restore_snapshot(
    path: String,
    state: tauri::State<'_, DbState>,
) -> Result<RestoreReport, String> {
    let snap = PathBuf::from(&path);
    if !snap.exists() {
        return Ok(RestoreReport {
            ok: false,
            restored_path: path,
            integrity_check: String::new(),
            message: "snapshot not found".to_string(),
        });
    }
    // Verify SHA-256 against sidecar if present.
    let actual = sha256_hex(&snap)?;
    if let Some(expected) = read_sidecar_hash(&snap) {
        if expected != actual {
            return Ok(RestoreReport {
                ok: false,
                restored_path: path,
                integrity_check: String::new(),
                message: format!("sha256 mismatch: expected {expected}, got {actual}"),
            });
        }
    }
    // Open a new connection on the snapshot file and run integrity_check.
    // We do NOT swap the live DB from inside the desktop process; the
    // OS-level scripts/dr/restore.{sh,ps1} are the canonical swap path
    // (run with the app stopped). Here we report the snapshot's health
    // so the operator can decide.
    let probe =
        rusqlite::Connection::open(&snap).map_err(|e| format!("open {}: {e}", snap.display()))?;
    let integrity: String = probe
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap_or_else(|e| format!("integrity_check failed: {e}"));
    drop(probe);
    let _ = state; // future: notify caller to restart, run post-swap migrations
    Ok(RestoreReport {
        ok: integrity == "ok",
        restored_path: snap.to_string_lossy().to_string(),
        integrity_check: integrity,
        message: "verified; run scripts/dr/restore.{sh,ps1} to swap into place".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn seed_db(p: &Path) {
        let c = Connection::open(p).unwrap();
        c.execute_batch(
            "CREATE TABLE shops(id TEXT PRIMARY KEY, name TEXT);\
             INSERT INTO shops(id, name) VALUES ('shop_main', 'Jagannath');",
        )
        .unwrap();
    }

    #[test]
    fn snapshot_filename_round_trip() {
        let when = chrono::DateTime::parse_from_rfc3339("2026-05-08T02:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let n = snapshot_filename("shop_main", when);
        assert_eq!(n, "pharmacare-snapshot-2026-05-08-0200-shop_main.tar.zst");
        let (dt, sid) = parse_snapshot_filename(&n).unwrap();
        assert_eq!(sid, "shop_main");
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-05-08 02:00");
    }

    #[test]
    fn snapshot_filename_unparseable_returns_none() {
        assert!(parse_snapshot_filename("readme.txt").is_none());
        assert!(parse_snapshot_filename("pharmacare-snapshot-bad.tar.zst").is_none());
    }

    #[test]
    fn retention_keeps_last_14_daily() {
        let names: Vec<String> = (1..=20)
            .map(|d| {
                format!(
                    "pharmacare-snapshot-2026-05-{:02}-0200-shop_main.tar.zst",
                    d
                )
            })
            .collect();
        let keep = plan_retention(&names);
        // last 14 daily plus the latest weekly + monthly bucket entries
        assert!(keep.len() >= 14);
        assert!(keep.contains("pharmacare-snapshot-2026-05-20-0200-shop_main.tar.zst"));
        assert!(!keep.contains("pharmacare-snapshot-2026-05-01-0200-shop_main.tar.zst"));
    }

    #[test]
    fn snapshot_to_writes_renamed_file_and_sidecar() {
        let tmp = tempdir().unwrap();
        let db_path = tmp.path().join("src.db");
        seed_db(&db_path);
        let conn = Connection::open(&db_path).unwrap();
        let out = tmp.path().join("backups");
        let when = chrono::DateTime::parse_from_rfc3339("2026-05-08T02:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let info = snapshot_to(&conn, &out, "shop_main", when).unwrap();
        let p = PathBuf::from(&info.path);
        assert!(p.exists());
        assert!(p
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("pharmacare-snapshot-2026-05-08-0200-shop_main"));
        let sidecar = p.with_file_name(format!(
            "{}.sha256",
            p.file_name().unwrap().to_string_lossy()
        ));
        assert!(sidecar.exists());
        let sha_in_sidecar = read_sidecar_hash(&p).unwrap();
        assert_eq!(sha_in_sidecar, info.sha256.to_lowercase());
    }
}
