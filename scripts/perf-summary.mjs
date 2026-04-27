import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "docs", "evidence");
const out = [];

for (const area of readdirSync(root)) {
  const p = join(root, area, "perf.json");
  try {
    const st = statSync(p);
    if (!st.isFile()) continue;
    const r = JSON.parse(readFileSync(p, "utf-8"));
    out.push({ area, report: r });
  } catch {
    /* skip */
  }
}

out.sort((a, b) => a.area.localeCompare(b.area));

let md = "# PharmaCare Pro — perf-gate summary\n\n";
md += `Generated ${new Date().toISOString()}.\n\n`;
md += "Aggregates docs/evidence/<area>/perf.json files from the most recent vitest run.\n\n";
md += "| Area | ADR | Gate | p50 (ms) | p95 (ms) | Budget (ms) | Status |\n";
md += "|---|---|---|---:|---:|---:|---|\n";

for (const e of out) {
  const r = e.report;
  const stats = r.statsMs ?? r.stats ?? null;
  const p50 = stats?.p50 ?? null;
  const p95 = stats?.p95 ?? null;
  const budget = r.gateMs ?? r.thresholdMs ?? null;
  const adr = r.adr ?? r.branch ?? r.package ?? "—";
  const gateStr = r.gate ?? r.probe ?? "(no gate label)";
  const status = p95 != null && budget != null ? (p95 < budget ? "OK" : "FAIL") : "info";
  const p50s = p50 != null ? p50.toFixed(2) : "—";
  const p95s = p95 != null ? p95.toFixed(2) : "—";
  const budgetStr = budget != null ? String(budget) : "—";
  md += `| ${e.area} | ${adr} | ${gateStr} | ${p50s} | ${p95s} | ${budgetStr} | ${status} |\n`;
}

md += "\n## Runner\n\n";
const runner = out[0]?.report?.runner;
if (runner) {
  md += `- node ${runner.node} on ${runner.platform}/${runner.arch}\n`;
  md += `- cpu: ${runner.cpus ?? "unknown"} (${runner.cpuCount ?? "?"} cores)\n`;
}
md += "\n*Reference-hardware floor (i3-8100/4GB/HDD) is the playbook §10 target. CI runs typically clear gates by ~10×; this report is for regression detection.*\n";

const outPath = join(root, "perf-summary.md");
writeFileSync(outPath, md, "utf-8");
console.log(`wrote ${outPath} (${out.length} reports)`);
