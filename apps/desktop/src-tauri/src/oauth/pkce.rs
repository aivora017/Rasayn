// PKCE (RFC 7636) helpers: code_verifier + S256 challenge, base64url no-pad.

use sha2::{Digest, Sha256};

/// Generate a 32-byte random verifier and its S256 challenge.
/// Returns (verifier, challenge) both as ASCII strings.
pub fn generate() -> (String, String) {
    let verifier = random_verifier(32);
    let challenge = s256_challenge(&verifier);
    (verifier, challenge)
}

fn random_verifier(n_bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; n_bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    b64_url_nopad(&buf)
}

fn s256_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    b64_url_nopad(&hasher.finalize())
}

fn b64_url_nopad(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc7636_vector() {
        // Appendix B of RFC 7636
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(s256_challenge(verifier), expected);
    }

    #[test]
    fn generate_is_deterministic_in_length() {
        let (v, c) = generate();
        assert!(v.len() >= 43); // 32 bytes b64url-nopad = 43 chars
        assert_eq!(c.len(), 43); // sha256 -> 32 bytes -> 43 chars
    }
}
