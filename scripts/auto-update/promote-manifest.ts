// scripts/auto-update/promote-manifest.ts
// Founder-side promote script: write a signed update manifest to R2.
//
// Usage:
//   npx tsx scripts/auto-update/promote-manifest.ts \
//     --version 0.1.1 \
//     --url https://github.com/aivora017/Rasayn/releases/download/v0.1.1/PharmaCare-Pro-Setup-0.1.1.exe \
//     --sha256 <hex64> \
//     --channel stable \
//     --notes "Bug fixes" \
//     --signature <ed25519-base64> \
//     --key-file ./updater_priv.pem
//
// Env required:
//   CF_ACCOUNT_ID, CF_API_TOKEN, CF_R2_BUCKET   (token must have R2 r/w on bucket)
//
// Uses Cloudflare's S3-compatible R2 HTTP API + node:crypto for ed25519. No deps.

import { createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";

interface Args {
  version: string; url: string; sha256: string; channel: string;
  notes: string; signature: string; keyFile: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k && k.startsWith("--")) { out[k.slice(2)] = argv[i + 1] ?? ""; i++; }
  }
  const need = ["version", "url", "sha256", "channel", "notes", "signature", "key-file"];
  for (const n of need) if (!out[n]) throw new Error(`missing --${n}`);
  return {
    version: out["version"]!, url: out["url"]!, sha256: out["sha256"]!,
    channel: out["channel"]!, notes: out["notes"]!, signature: out["signature"]!,
    keyFile: out["key-file"]!,
  };
}

function envOrDie(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`env ${k} not set`);
  return v;
}

async function r2Get(accountId: string, token: string, bucket: string, key: string): Promise<unknown | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key} -> ${res.status} ${await res.text()}`);
  return JSON.parse(await res.text());
}

async function r2Put(accountId: string, token: string, bucket: string, key: string, body: string): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} -> ${res.status} ${await res.text()}`);
}

function signManifest(manifestJson: string, keyPem: string): string {
  const key = createPrivateKey({ key: keyPem, format: "pem" });
  const sig = edSign(null, Buffer.from(manifestJson, "utf-8"), key);
  return sig.toString("base64");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const accountId = envOrDie("CF_ACCOUNT_ID");
  const token = envOrDie("CF_API_TOKEN");
  const bucket = envOrDie("CF_R2_BUCKET");
  const key = `manifest-${args.channel}.json`;

  const existing = (await r2Get(accountId, token, bucket, key)) as
    { product?: string; latest?: Record<string, string>; releases?: unknown[] } | null;

  const releases = Array.isArray(existing?.releases) ? [...existing!.releases!] : [];
  const newEntry = {
    version: args.version, channel: args.channel, publishedAt: new Date().toISOString(),
    notes: args.notes, mandatory: false,
    assets: [{
      platform: "windows-x86_64", url: args.url,
      sha256: args.sha256, sizeBytes: 0, signature: args.signature,
    }],
  };
  // Replace any existing entry with the same version, otherwise prepend.
  const filtered = (releases as Array<{ version?: string }>).filter((r) => r.version !== args.version);
  filtered.unshift(newEntry);

  const latest = { ...(existing?.latest ?? {}), [args.channel]: args.version };
  const manifest = {
    product: "PharmaCare", latest, releases: filtered, generatedAt: new Date().toISOString(),
  };
  const manifestJson = JSON.stringify(manifest, null, 2);

  // Sign the canonical manifest body and store the signature alongside.
  const keyPem = readFileSync(args.keyFile, "utf-8");
  const manifestSignature = signManifest(manifestJson, keyPem);

  await r2Put(accountId, token, bucket, key, manifestJson);
  await r2Put(accountId, token, bucket, `${key}.sig`, JSON.stringify({ signature: manifestSignature }));

  console.log(`promoted ${args.version} -> channel=${args.channel} (${releases.length + 1} releases total)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
