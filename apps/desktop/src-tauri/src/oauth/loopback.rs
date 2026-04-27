// Loopback redirect handler for the OAuth installed-app flow.
//
// Binds 127.0.0.1:0, returns the actual port to the caller. On the first HTTP
// request, parses `?code=...&state=...` from the query string, verifies the
// `state` parameter matches the value we generated (RFC 6749 §10.12 CSRF),
// responds 200 with a small HTML confirmation page, and sends the code back.
//
// Hardened by S01 (2026-04-18): path must be `/callback`; missing or mismatched
// `state` returns HTTP 400 and refuses to hand the code to the token-exchange
// step. Closes the CSRF vector on multi-user Windows hosts where a local
// attacker could otherwise inject an attacker-controlled `code` during the
// ~5-minute consent window.
//
// This is a minimal handler using only std::net — no async runtime needed for
// a single-shot single-request server.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener};

pub struct LoopbackHandle {
    pub port: u16,
    pub listener: TcpListener,
}

pub fn bind_ephemeral() -> std::io::Result<LoopbackHandle> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr: SocketAddr = listener.local_addr()?;
    Ok(LoopbackHandle {
        port: addr.port(),
        listener,
    })
}

/// Block until the first request arrives, verify `state` matches
/// `expected_state`, and return `code` from the query string.
///
/// On any of the following, respond 400 and return Err:
/// - Request line malformed
/// - Path is not `/callback`
/// - `code` param missing
/// - `state` param missing OR mismatches `expected_state`
///
/// Times out after `timeout_secs` seconds.
pub fn await_code(
    handle: LoopbackHandle,
    timeout_secs: u64,
    expected_state: &str,
) -> Result<String, String> {
    handle
        .listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    // simple blocking accept with a deadline enforced via socket read timeout
    let deadline = std::time::Duration::from_secs(timeout_secs);
    let (mut stream, _) = handle
        .listener
        .accept()
        .map_err(|e| format!("accept: {e}"))?;
    stream.set_read_timeout(Some(deadline)).ok();

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;

    match parse_callback_request(&request_line, expected_state) {
        Ok(code) => {
            let body = "<!doctype html><html><body style='font-family:sans-serif;padding:40px'><h2>PharmaCare Pro</h2><p>Gmail connected. You can close this tab.</p></body></html>";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body,
            );
            let _ = stream.write_all(resp.as_bytes());
            Ok(code)
        }
        Err(reason) => {
            let body = "<!doctype html><html><body style='font-family:sans-serif;padding:40px'><h2>PharmaCare Pro</h2><p>OAuth callback rejected. You can close this tab and retry from the app.</p></body></html>";
            let resp = format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body,
            );
            let _ = stream.write_all(resp.as_bytes());
            Err(reason)
        }
    }
}

/// Parse `GET /callback?code=...&state=... HTTP/1.1` and verify state.
/// Returns the decoded `code` on success.
pub(crate) fn parse_callback_request(
    request_line: &str,
    expected_state: &str,
) -> Result<String, String> {
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err("malformed request line".into());
    }
    // Require GET method.
    if !parts[0].eq_ignore_ascii_case("GET") {
        return Err(format!("unexpected HTTP method: {}", parts[0]));
    }
    let path_and_query = parts[1];
    let (path, query) = match path_and_query.split_once('?') {
        Some((p, q)) => (p, q),
        None => (path_and_query, ""),
    };
    // Tighten the accepted path. Google redirects to exactly /callback.
    if path != "/callback" {
        return Err(format!("unexpected callback path: {path}"));
    }

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut error: Option<String> = None;
    for kv in query.split('&') {
        if kv.is_empty() {
            continue;
        }
        if let Some((k, v)) = kv.split_once('=') {
            // S12: malformed %-encoding -> HTTP 400 rather than silently
            // dropping the percent sign.
            let decoded = url_decode(v)
                .ok_or_else(|| format!("malformed percent-encoding in query parameter `{k}`"))?;
            match k {
                "code" => code = Some(decoded),
                "state" => state = Some(decoded),
                "error" => error = Some(decoded),
                _ => {}
            }
        }
    }

    if let Some(e) = error {
        return Err(format!("oauth provider returned error: {e}"));
    }

    let code = code.ok_or_else(|| "no code parameter in callback URL".to_string())?;
    let state = state.ok_or_else(|| "no state parameter in callback URL".to_string())?;
    if !constant_time_eq(state.as_bytes(), expected_state.as_bytes()) {
        return Err("state parameter mismatch — rejected (CSRF guard)".into());
    }
    Ok(code)
}

/// Constant-time byte comparison. Used for state-token verification so a
/// timing oracle cannot be used to guess the token byte-by-byte.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Decode `application/x-www-form-urlencoded` into a UTF-8 `String`.
///
/// Hardened for S09 + S12 (docs/reviews/security-2026-04-18.md):
///
/// - **S09**: decode into a `Vec<u8>` buffer and finalise with
///   `String::from_utf8_lossy`, so multi-byte UTF-8 percent-triples are
///   reassembled correctly instead of being cast byte-by-byte into
///   Latin-1 `char` slots. Non-UTF-8 input becomes U+FFFD rather than
///   corrupting the output silently.
/// - **S12**: return `Option<String>` and surface `None` on any malformed
///   percent-encoding — trailing `%`, trailing `%X` with a single hex
///   digit, or `%GG` with non-hex characters. The loopback layer turns
///   `None` into an HTTP 400, which is what RFC 3986 §2.1 expects.
fn url_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            // S12: need two more bytes, and they must be hex.
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let b = u8::from_str_radix(hex, 16).ok()?;
            out.push(b);
            i += 3;
            continue;
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    // S09: assemble bytes back into a UTF-8 string. Non-UTF-8 input is
    // replaced lossily with U+FFFD; we do not panic.
    Some(String::from_utf8_lossy(&out).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_code_from_callback_with_matching_state() {
        let line = "GET /callback?code=4%2F0AX4XfWg&state=st8&scope=openid HTTP/1.1";
        assert_eq!(
            parse_callback_request(line, "st8").unwrap(),
            "4/0AX4XfWg".to_string()
        );
    }

    #[test]
    fn state_order_agnostic() {
        // state before code should also parse.
        let line = "GET /callback?state=abc&code=TOKEN HTTP/1.1";
        assert_eq!(
            parse_callback_request(line, "abc").unwrap(),
            "TOKEN".to_string()
        );
    }

    #[test]
    fn rejects_missing_state() {
        let line = "GET /callback?code=abc HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(err.contains("state"), "err was: {err}");
    }

    #[test]
    fn rejects_state_mismatch() {
        let line = "GET /callback?code=abc&state=attacker HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(
            err.contains("state") || err.contains("CSRF"),
            "err was: {err}"
        );
    }

    #[test]
    fn rejects_wrong_path() {
        let line = "GET /evil?code=abc&state=expected HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(err.contains("path"), "err was: {err}");
    }

    #[test]
    fn rejects_missing_code() {
        let line = "GET /callback?state=expected HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(err.contains("code"), "err was: {err}");
    }

    #[test]
    fn surfaces_provider_error() {
        let line = "GET /callback?error=access_denied&state=expected HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(err.contains("access_denied"), "err was: {err}");
    }

    #[test]
    fn rejects_non_get_method() {
        let line = "POST /callback?code=abc&state=expected HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(err.contains("method"), "err was: {err}");
    }

    #[test]
    fn constant_time_eq_lengths_differ() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn constant_time_eq_byte_mismatch() {
        assert!(!constant_time_eq(b"abc", b"abd"));
    }

    #[test]
    fn constant_time_eq_match() {
        assert!(constant_time_eq(b"abc", b"abc"));
    }

    #[test]
    fn bind_ephemeral_returns_port() {
        let h = bind_ephemeral().expect("bind");
        assert!(h.port > 0);
    }

    // --- S09 url_decode UTF-8 safety --------------------------------------

    #[test]
    fn s09_url_decode_preserves_multibyte_utf8() {
        // `%E2%82%AC` is the UTF-8 encoding of the Euro sign U+20AC.
        // Old byte-to-char code would have mangled this into three
        // Latin-1 chars (â, ‚, ¬). New code reassembles via
        // String::from_utf8_lossy and yields the real `€`.
        assert_eq!(url_decode("%E2%82%AC").as_deref(), Some("\u{20AC}"));
        // Hindi "नमस्ते" round-trips.
        let hindi = "%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87";
        assert_eq!(url_decode(hindi).as_deref(), Some("नमस्ते"));
    }

    #[test]
    fn s09_url_decode_non_utf8_bytes_become_replacement_char_not_panic() {
        // Lone 0xFF byte is NOT valid UTF-8. Old `b as char` would happily
        // produce the Latin-1 ÿ; new path replaces with U+FFFD. Must not
        // panic, and must stay total.
        let decoded = url_decode("%FF").expect("decode must succeed");
        assert!(
            decoded.contains('\u{FFFD}'),
            "expected replacement char, got {decoded:?}"
        );
    }

    // --- S12 url_decode malformed percent-encoding ------------------------

    #[test]
    fn s12_url_decode_trailing_percent_is_none() {
        // `%` with no following hex digits at all — previously fell through
        // and wrote a literal `%` into output. Now surfaces as None so the
        // loopback layer can reply 400.
        assert_eq!(url_decode("abc%"), None);
    }

    #[test]
    fn s12_url_decode_one_hex_digit_at_end_is_none() {
        // `%A` — one hex digit, missing the second. Same story.
        assert_eq!(url_decode("abc%A"), None);
    }

    #[test]
    fn s12_url_decode_non_hex_triplet_is_none() {
        // `%GG` — two chars but not hex. Must not silently pass through.
        assert_eq!(url_decode("%GG"), None);
    }

    #[test]
    fn s12_parse_callback_rejects_malformed_percent_in_code() {
        // Malformed %-encoding in the `code` query param → 400 reason
        // string mentions the parameter name so the operator can triage.
        let line = "GET /callback?code=abc%&state=expected HTTP/1.1";
        let err = parse_callback_request(line, "expected").unwrap_err();
        assert!(
            err.contains("malformed") && err.contains("code"),
            "err was: {err}"
        );
    }
}
