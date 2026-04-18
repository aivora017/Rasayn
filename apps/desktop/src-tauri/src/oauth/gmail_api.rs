// Minimal Gmail REST v1 client for X1 moat inbox.
//
// Only covers what we need for distributor-bill ingestion:
//   - list messages by label/query
//   - fetch a single message (full format) → headers + attachments meta
//   - fetch attachment bytes (base64url → raw)
//
// Auth: caller passes an already-refreshed access_token (Bearer).
// We do NOT store access tokens; the caller refreshes each invocation
// and discards. Refresh tokens stay in the OS keyring.

use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

// S03 — docs/reviews/security-2026-04-18.md: cap every Gmail response body
// at 30 MB and warn above 10 MB. Gmail's own server caps attachments at
// 25 MB, but the only bound on this client was a 30 s timeout — a hostile
// proxy or TLS-inspection appliance could stream arbitrary bytes into
// `resp.json()` / `resp.text()` and OOM the 4 GB Win7 target. Preflight
// via Content-Length is the cheapest defense; when the header is missing
// we log and proceed (reqwest's blocking client has no streaming cap).
const MAX_RESPONSE_BYTES: u64 = 30 * 1024 * 1024;
const WARN_RESPONSE_BYTES: u64 = 10 * 1024 * 1024;

/// Pure helper — kept pure so it's unit-testable without mocking reqwest.
/// Returns Err when `content_length` exceeds the cap; returns Ok but logs
/// a warn when above the 10 MB threshold; Ok silent when absent or small.
fn check_body_size(content_length: Option<u64>, cmd: &str) -> Result<(), String> {
    let Some(n) = content_length else {
        // Gmail usually sets Content-Length; if we ever see a chunked response
        // with no preflight, we cannot bound the body here. Log once — the
        // operator runbook says to investigate any chunked response.
        tracing::debug!("gmail {cmd}: no Content-Length header on response");
        return Ok(());
    };
    if n > MAX_RESPONSE_BYTES {
        return Err(format!(
            "{cmd}: response body {n} bytes exceeds cap of {MAX_RESPONSE_BYTES} bytes"
        ));
    }
    if n > WARN_RESPONSE_BYTES {
        tracing::warn!(
            "gmail {cmd}: large response body {} MB (cap {} MB)",
            n / (1024 * 1024),
            MAX_RESPONSE_BYTES / (1024 * 1024),
        );
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GmailAttachmentMeta {
    pub attachment_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageSummary {
    pub id: String,
    pub thread_id: String,
    pub from: String,
    pub subject: String,
    pub date: String,
    pub snippet: String,
    pub attachments: Vec<GmailAttachmentMeta>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GmailAttachmentPayload {
    pub path: String,
    pub size: i64,
    pub mime_type: String,
    pub filename: String,
    /// Attempted UTF-8 decode of the file bytes (present only for text-like types).
    pub text: Option<String>,
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("reqwest client")
}

/// List message IDs + basic metadata matching `q` (Gmail search syntax).
/// `max` caps results at the server (clamped to 1..=50).
pub fn list_messages(
    access_token: &str,
    q: &str,
    max: u32,
) -> Result<Vec<GmailMessageSummary>, String> {
    let max = max.clamp(1, 50);
    let c = client();
    let url = format!(
        "{}/messages?q={}&maxResults={}",
        API_BASE,
        urlencode(q),
        max
    );
    let resp = c
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("list: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!("list {s}: {}", resp.text().unwrap_or_default()));
    }
    check_body_size(resp.content_length(), "list")?;
    #[derive(Deserialize)]
    struct ListResp {
        #[serde(default)]
        messages: Vec<IdRef>,
    }
    #[derive(Deserialize)]
    struct IdRef {
        id: String,
        #[serde(rename = "threadId", default)]
        thread_id: String,
    }
    let list: ListResp = resp.json().map_err(|e| format!("list parse: {e}"))?;

    let mut out = Vec::with_capacity(list.messages.len());
    for m in list.messages {
        match get_message(access_token, &m.id) {
            Ok(mut s) => {
                s.thread_id = m.thread_id;
                out.push(s);
            }
            Err(e) => tracing::warn!("gmail get_message {} failed: {}", m.id, e),
        }
    }
    Ok(out)
}

/// Fetch one message in full format and flatten to summary + attachments.
pub fn get_message(access_token: &str, message_id: &str) -> Result<GmailMessageSummary, String> {
    let c = client();
    let url = format!(
        "{}/messages/{}?format=full",
        API_BASE,
        urlencode(message_id)
    );
    let resp = c
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("get: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!("get {s}: {}", resp.text().unwrap_or_default()));
    }
    check_body_size(resp.content_length(), "get")?;
    let v: serde_json::Value = resp.json().map_err(|e| format!("get parse: {e}"))?;
    Ok(summarize(&v, message_id))
}

fn summarize(v: &serde_json::Value, id: &str) -> GmailMessageSummary {
    let snippet = v
        .get("snippet")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let payload = v.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    let (mut from, mut subject, mut date) = (String::new(), String::new(), String::new());
    if let Some(hdrs) = payload.get("headers").and_then(|h| h.as_array()) {
        for h in hdrs {
            let name = h
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let val = h
                .get("value")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            match name.as_str() {
                "from" => from = val,
                "subject" => subject = val,
                "date" => date = val,
                _ => {}
            }
        }
    }
    let mut atts: Vec<GmailAttachmentMeta> = Vec::new();
    collect_attachments(&payload, &mut atts);
    GmailMessageSummary {
        id: id.to_string(),
        thread_id: String::new(),
        from,
        subject,
        date,
        snippet,
        attachments: atts,
    }
}

fn collect_attachments(part: &serde_json::Value, out: &mut Vec<GmailAttachmentMeta>) {
    if part.is_null() {
        return;
    }
    let filename = part.get("filename").and_then(|f| f.as_str()).unwrap_or("");
    let body = part.get("body").cloned().unwrap_or(serde_json::Value::Null);
    if !filename.is_empty() {
        if let Some(aid) = body.get("attachmentId").and_then(|a| a.as_str()) {
            out.push(GmailAttachmentMeta {
                attachment_id: aid.to_string(),
                filename: filename.to_string(),
                mime_type: part
                    .get("mimeType")
                    .and_then(|m| m.as_str())
                    .unwrap_or("application/octet-stream")
                    .to_string(),
                size: body.get("size").and_then(|s| s.as_i64()).unwrap_or(0),
            });
        }
    }
    if let Some(parts) = part.get("parts").and_then(|p| p.as_array()) {
        for sub in parts {
            collect_attachments(sub, out);
        }
    }
}

/// Download an attachment → temp file, try UTF-8 decode for text-like types.
pub fn fetch_attachment(
    access_token: &str,
    message_id: &str,
    attachment_id: &str,
    filename: &str,
    mime_type: &str,
) -> Result<GmailAttachmentPayload, String> {
    let c = client();
    let url = format!(
        "{}/messages/{}/attachments/{}",
        API_BASE,
        urlencode(message_id),
        urlencode(attachment_id),
    );
    let resp = c
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("attach: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        return Err(format!("attach {s}: {}", resp.text().unwrap_or_default()));
    }
    check_body_size(resp.content_length(), "attach")?;
    #[derive(Deserialize)]
    struct AttResp {
        data: String,
        #[serde(default)]
        size: i64,
    }
    let a: AttResp = resp.json().map_err(|e| format!("attach parse: {e}"))?;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    // Gmail sometimes pads, sometimes not — try forgiving decode.
    let bytes = URL_SAFE_NO_PAD
        .decode(a.data.trim_end_matches('='))
        .map_err(|e| format!("b64: {e}"))?;
    let safe_name = sanitize_filename(filename);
    let dir = std::env::temp_dir().join("pharmacare-gmail");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let path = dir.join(format!("{}-{}", message_id, safe_name));
    std::fs::write(&path, &bytes).map_err(|e| format!("write: {e}"))?;

    let text = decode_text_if_possible(&bytes, mime_type, filename);
    Ok(GmailAttachmentPayload {
        path: path.to_string_lossy().into_owned(),
        size: if a.size > 0 {
            a.size
        } else {
            bytes.len() as i64
        },
        mime_type: mime_type.to_string(),
        filename: filename.to_string(),
        text,
    })
}

fn sanitize_filename(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        s = "attachment.bin".into();
    }
    s
}

fn decode_text_if_possible(bytes: &[u8], mime: &str, filename: &str) -> Option<String> {
    let mime = mime.to_ascii_lowercase();
    let fname = filename.to_ascii_lowercase();
    let textlike = mime.starts_with("text/")
        || mime == "application/csv"
        || mime == "application/vnd.ms-excel" // some CSVs labeled this
        || fname.ends_with(".csv") || fname.ends_with(".tsv") || fname.ends_with(".txt");
    if !textlike {
        return None;
    }
    // Trim BOM.
    let start = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        3
    } else {
        0
    };
    std::str::from_utf8(&bytes[start..])
        .ok()
        .map(|s| s.to_string())
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_works() {
        assert_eq!(sanitize_filename("bill (1).pdf"), "bill__1_.pdf");
        assert_eq!(sanitize_filename("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(sanitize_filename(""), "attachment.bin");
    }

    #[test]
    fn decode_text_handles_bom_and_mime() {
        let with_bom = [&[0xEF, 0xBB, 0xBF][..], b"hello"].concat();
        assert_eq!(
            decode_text_if_possible(&with_bom, "text/csv", "a.csv").as_deref(),
            Some("hello")
        );
        assert_eq!(
            decode_text_if_possible(b"x", "application/pdf", "a.pdf"),
            None
        );
        assert_eq!(
            decode_text_if_possible(b"x", "application/octet-stream", "a.tsv").as_deref(),
            Some("x")
        );
    }

    #[test]
    fn summarize_extracts_headers_and_attachments() {
        let v: serde_json::Value = serde_json::json!({
            "snippet": "Invoice attached",
            "payload": {
                "headers": [
                    {"name": "From", "value": "Cipla <bills@cipla.com>"},
                    {"name": "Subject", "value": "Invoice INV-123"},
                    {"name": "Date", "value": "Wed, 15 Apr 2026 10:00:00 +0530"}
                ],
                "parts": [
                    {"mimeType": "text/plain", "filename": "", "body": {"size": 12}},
                    {"mimeType": "text/csv", "filename": "bill.csv",
                     "body": {"attachmentId": "ATT1", "size": 400}}
                ]
            }
        });
        let s = summarize(&v, "MID");
        assert_eq!(s.id, "MID");
        assert_eq!(s.from, "Cipla <bills@cipla.com>");
        assert_eq!(s.subject, "Invoice INV-123");
        assert_eq!(s.attachments.len(), 1);
        assert_eq!(s.attachments[0].attachment_id, "ATT1");
        assert_eq!(s.attachments[0].filename, "bill.csv");
    }

    #[test]
    fn urlencode_matches_rfc3986() {
        assert_eq!(
            urlencode("label:distributor bills"),
            "label%3Adistributor%20bills"
        );
    }

    // --- S03 body-size cap ------------------------------------------------

    #[test]
    fn check_body_size_absent_header_is_ok() {
        // Chunked / unknown-length response — Gmail normally sets
        // Content-Length but we can't bound what we can't see; we log and
        // proceed.
        assert!(check_body_size(None, "list").is_ok());
    }

    #[test]
    fn check_body_size_small_payload_is_ok() {
        assert!(check_body_size(Some(1024), "get").is_ok());
    }

    #[test]
    fn check_body_size_warn_threshold_still_ok() {
        // 10.5 MB — above warn threshold but below the hard cap; must Ok.
        assert!(check_body_size(Some(11 * 1024 * 1024), "attach").is_ok());
    }

    #[test]
    fn check_body_size_at_exactly_cap_is_ok() {
        assert!(check_body_size(Some(MAX_RESPONSE_BYTES), "attach").is_ok());
    }

    #[test]
    fn check_body_size_above_cap_errors_with_cmd_name() {
        let err = check_body_size(Some(MAX_RESPONSE_BYTES + 1), "attach").expect_err("must cap");
        // Error must carry the command (for operator diagnosis) and both
        // the observed and max byte counts.
        assert!(err.starts_with("attach:"), "err missing cmd: {err}");
        assert!(err.contains("exceeds cap"), "err missing cap text: {err}");
    }
}
