// system_info.rs — hardware fingerprint Tauri command (S17.1).
//
// Reads CPU model + first non-loopback MAC + first disk serial via OS-native
// shell calls (no new crate dep), concatenates and SHA-256s. The full hex
// hash is stored alongside the license; the first 6 hex chars are embedded
// in the license key per @pharmacare/license encoding.
//
// Windows: PowerShell Get-CimInstance + Get-NetAdapter + Get-Disk
// POSIX:   /proc/cpuinfo + /sys/class/net/<iface>/address + lsblk

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFingerprint {
    pub full_hash: String,    // 64-char hex
    pub short_hash: String,   // 6-char hex (first 24 bits)
    pub cpu_token: String,
    pub mac_token: String,
    pub disk_token: String,
}

fn run_ps(script: &str) -> String {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

fn run_sh(cmd: &str) -> String {
    let out = Command::new("sh")
        .args(["-c", cmd])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

fn first_nonempty_line(s: &str) -> String {
    s.lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

fn cpu_token() -> String {
    if cfg!(target_os = "windows") {
        first_nonempty_line(&run_ps("(Get-CimInstance Win32_Processor).Name"))
    } else if cfg!(target_os = "macos") {
        first_nonempty_line(&run_sh("sysctl -n machdep.cpu.brand_string"))
    } else {
        // Linux
        first_nonempty_line(&run_sh(
            "grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //'",
        ))
    }
}

fn mac_token() -> String {
    if cfg!(target_os = "windows") {
        first_nonempty_line(&run_ps(
            "(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.MacAddress } | \
             Select-Object -First 1 -ExpandProperty MacAddress)",
        ))
    } else if cfg!(target_os = "macos") {
        first_nonempty_line(&run_sh(
            "ifconfig | awk '/ether/{print $2; exit}'",
        ))
    } else {
        first_nonempty_line(&run_sh(
            "cat /sys/class/net/*/address 2>/dev/null | grep -v '00:00:00:00:00:00' | head -1",
        ))
    }
}

fn disk_token() -> String {
    if cfg!(target_os = "windows") {
        first_nonempty_line(&run_ps(
            "(Get-Disk | Where-Object { $_.Number -eq 0 } | \
             Select-Object -First 1 -ExpandProperty SerialNumber)",
        ))
    } else if cfg!(target_os = "macos") {
        first_nonempty_line(&run_sh(
            "system_profiler SPSerialATADataType 2>/dev/null | awk '/Serial Number/{print $3; exit}'",
        ))
    } else {
        first_nonempty_line(&run_sh(
            "lsblk -d -o SERIAL 2>/dev/null | sed -n '2p'",
        ))
    }
}

#[tauri::command]
pub fn system_info_fingerprint() -> Result<SystemFingerprint, String> {
    let cpu = cpu_token();
    let mac = mac_token();
    let disk = disk_token();
    if cpu.is_empty() && mac.is_empty() && disk.is_empty() {
        return Err("no hardware identifiers detectable".into());
    }
    let concat = format!("{cpu}|{mac}|{disk}");
    let mut hasher = Sha256::new();
    hasher.update(concat.as_bytes());
    let full_hash = hex::encode(hasher.finalize());
    let short_hash = full_hash[..6].to_string();
    Ok(SystemFingerprint {
        full_hash,
        short_hash,
        cpu_token: cpu,
        mac_token: mac,
        disk_token: disk,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_nonempty_line_works() {
        assert_eq!(first_nonempty_line(""), "");
        assert_eq!(first_nonempty_line("\n\n  hello\n  world"), "hello");
        assert_eq!(first_nonempty_line("foo\nbar"), "foo");
    }

    #[test]
    fn fingerprint_format_when_at_least_one_token_present() {
        // We can't guarantee what the host reports, but if any field is
        // populated the call should succeed and the hash should be 64 hex.
        if let Ok(fp) = system_info_fingerprint() {
            assert_eq!(fp.full_hash.len(), 64);
            assert_eq!(fp.short_hash.len(), 6);
            assert!(fp.full_hash.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
