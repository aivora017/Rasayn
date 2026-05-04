//! Cold-start budget: §10 GA gate requires < 3000ms on i3-8100/4GB.
//! This bench measures the migration-apply phase only; UI bring-up is
//! measured separately (TODO S25).
//! Budget for migrations alone: 1500ms (leaving 1500ms for UI).
//!
//! See ADR 0067 (perf harness).

use criterion::{criterion_group, criterion_main, Criterion};
use rusqlite::Connection;

fn apply_migrations_from_dir(c: &Connection) {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/shared-db/migrations"
    );
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let sql = std::fs::read_to_string(entry.path()).unwrap();
        c.execute_batch(&sql).unwrap_or_else(|e| {
            panic!(
                "migration {}: {e}",
                entry.file_name().to_string_lossy()
            )
        });
    }
}

fn bench_cold_start(c: &mut Criterion) {
    c.bench_function("cold_start_apply_44_migrations", |b| {
        b.iter(|| {
            let conn = Connection::open_in_memory().unwrap();
            apply_migrations_from_dir(&conn);
        });
    });
}

criterion_group!(benches, bench_cold_start);
criterion_main!(benches);
