// printer.rs — Tauri commands for thermal/label printer I/O.
//
// Cross-platform: on Windows uses the OS spooler via lpr-style fallback; on
// Linux/macOS uses CUPS lp. The bytes are produced by @pharmacare/printer-escpos
// and fed through here verbatim.
//
// For the Jagannath pilot, two printers are configured by name:
//   - Thermal: TVS RP-3230 (default for receipts)
//   - Label:   Argox barcode printer (for SKU labels)
// The active printer name is stored in shop_settings.printer_thermal_name +
// .printer_label_name (added in migration 0044 — TBD).

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Debug, Serialize)]
pub struct DiscoveredPrinter {
    pub name: String,
    pub kind: String,        // "thermal" | "label" | "a4" | "unknown"
}

#[derive(Debug, Deserialize)]
pub struct PrinterWriteInput {
    pub printer_name: String,
    pub bytes_b64: String,   // base64 of the raw byte stream
}

/// List installed printers via OS-native command. Best-effort — returns a
/// possibly-empty list on failure.
#[tauri::command]
pub fn printer_list() -> Result<Vec<DiscoveredPrinter>, String> {
    if cfg!(target_os = "windows") {
        // PowerShell: Get-Printer | Select-Object -ExpandProperty Name
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-Printer | Select-Object -ExpandProperty Name",
            ])
            .output()
            .map_err(|e| format!("powershell failed: {e}"))?;
        let names = String::from_utf8_lossy(&out.stdout);
        Ok(names
            .lines()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| DiscoveredPrinter { name: s.to_string(), kind: classify(s) })
            .collect())
    } else {
        // CUPS: lpstat -p
        let out = Command::new("lpstat")
            .arg("-p")
            .output()
            .map_err(|e| format!("lpstat failed: {e}"))?;
        let lines = String::from_utf8_lossy(&out.stdout);
        let mut names = Vec::new();
        for line in lines.lines() {
            // "printer foo is idle.  enabled since ..."
            if let Some(rest) = line.strip_prefix("printer ") {
                if let Some(name) = rest.split_whitespace().next() {
                    names.push(DiscoveredPrinter {
                        name: name.to_string(),
                        kind: classify(name),
                    });
                }
            }
        }
        Ok(names)
    }
}

fn classify(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("rp-3230") || lower.contains("thermal") || lower.contains("tm-t") {
        "thermal".into()
    } else if lower.contains("zebra") || lower.contains("argox") || lower.contains("tsc") || lower.contains("label") {
        "label".into()
    } else {
        "unknown".into()
    }
}

/// Send raw bytes to a named printer. On Windows shells out to `print` /
/// `Out-Printer`; on POSIX uses `lp -d <name>`.
#[tauri::command]
pub fn printer_write_bytes(input: PrinterWriteInput) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.bytes_b64)
        .map_err(|e| format!("invalid base64: {e}"))?;

    if cfg!(target_os = "windows") {
        // Use `cmd /C copy /B - "<printer-name>"` via stdin
        let mut child = Command::new("cmd")
            .args([
                "/C",
                &format!("copy /B \\\\.\\pipe\\stdin \"\\\\.\\{}\"", input.printer_name),
            ])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn failed: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(&bytes).map_err(|e| format!("write failed: {e}"))?;
        }
        let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
        if !status.success() {
            return Err(format!("print failed with status {status}"));
        }
        Ok(())
    } else {
        let mut child = Command::new("lp")
            .args(["-d", &input.printer_name, "-o", "raw"])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn lp failed: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(&bytes).map_err(|e| format!("write failed: {e}"))?;
        }
        let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
        if !status.success() {
            return Err(format!("lp failed with status {status}"));
        }
        Ok(())
    }
}

/// Test-fire a single short ESC/POS init pulse to verify the printer is alive.
#[tauri::command]
pub fn printer_test(printer_name: String) -> Result<(), String> {
    use base64::Engine;
    let test_bytes = b"\x1b\x40\x1b\x61\x01PharmaCare Pro\nPrinter test OK\n\n\n\x1d\x56\x00";
    let b64 = base64::engine::general_purpose::STANDARD.encode(test_bytes);
    printer_write_bytes(PrinterWriteInput { printer_name, bytes_b64: b64 })
}
