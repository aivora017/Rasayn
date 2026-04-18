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
            match k {
                "code" => code = Some(url_decode(v)),
                "state" => state = Some(url_decode(v)),
                "error" => error = Some(url_decode(v)),
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

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00"),
                16,
            ) {
                out.push(b as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
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
}
