// OAuth client-id resolution. See ADR 0002 §Operational notes.
//
// Precedence (first match wins):
//   1. Runtime env  PHARMACARE_GOOGLE_CLIENT_ID   (dev / staging override)
//   2. Build-time   option_env!("PHARMACARE_GOOGLE_CLIENT_ID_COMPILE")
//   3. Fallback     COMPILE_FALLBACK constant     (development default)
//
// Release builds bake the real client id at compile time by setting
// PHARMACARE_GOOGLE_CLIENT_ID_COMPILE in CI, e.g.:
//
//   export PHARMACARE_GOOGLE_CLIENT_ID_COMPILE="1234-abcd.apps.googleusercontent.com"
//   cargo build --release
//
// The client id is public per RFC 7636 — PKCE is what protects the flow —
// so there is no secret to leak by baking it in. We still allow a runtime
// env override so a developer can hit a staging OAuth project without
// rebuilding, and so integration tests can swap in a mock.
//
// This module is the ONLY place the CLIENT_ID constant is read. Callers
// must go through `client_id()` so future changes (e.g. reading from a
// keyring'd config, or a per-tenant id for white-label) land in one spot.

/// Compile-time fallback. Must start with "REPLACE_ME" so `is_configured`
/// can detect unconfigured builds and the UI can refuse to start a flow.
pub const COMPILE_FALLBACK: &str = "REPLACE_ME.apps.googleusercontent.com";

/// Runtime-resolved Google OAuth client id for the Installed-App flow.
pub fn client_id() -> String {
    if let Ok(v) = std::env::var("PHARMACARE_GOOGLE_CLIENT_ID") {
        if !v.trim().is_empty() {
            return v;
        }
    }
    match option_env!("PHARMACARE_GOOGLE_CLIENT_ID_COMPILE") {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => COMPILE_FALLBACK.to_string(),
    }
}

/// True iff the resolved client id is a real Google value (not a placeholder).
pub fn is_configured() -> bool {
    !client_id().starts_with("REPLACE_ME")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Env vars are process-global; cargo runs tests in parallel threads
    // inside one process, so any test that mutates PHARMACARE_GOOGLE_CLIENT_ID
    // must hold this mutex for its full duration.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn fallback_is_detected_as_unconfigured() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("PHARMACARE_GOOGLE_CLIENT_ID");
        // When compile-time env is unset, we get the REPLACE_ME fallback.
        if option_env!("PHARMACARE_GOOGLE_CLIENT_ID_COMPILE").is_none() {
            assert!(!is_configured());
            assert!(client_id().starts_with("REPLACE_ME"));
        }
    }

    #[test]
    fn runtime_env_wins() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var(
            "PHARMACARE_GOOGLE_CLIENT_ID",
            "abc.apps.googleusercontent.com",
        );
        assert_eq!(client_id(), "abc.apps.googleusercontent.com");
        assert!(is_configured());
        std::env::remove_var("PHARMACARE_GOOGLE_CLIENT_ID");
    }
}
