#!/usr/bin/env node
/**
 * Scans public/test-cases/<caseId>/manifest.json and writes an index
 * to public/test-cases/index.json for the dashboard to fetch at runtime.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../public/test-cases", import.meta.url));

if (!existsSync(root)) {
  mkdirSync(root, { recursive: true });
}

const cases = readdirSync(root)
  .filter((name) => {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) return false;
    } catch {
      return false;
    }
    return existsSync(join(dir, "manifest.json"));
  })
  .map((name) => {
    const manifestPath = join(root, name, "manifest.json");
    const raw = readFileSync(manifestPath, "utf8");
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${manifestPath}: ${err.message}`);
    }
    return {
      id: name,
      name: manifest.name ?? name,
      audio: manifest.audio ?? "audio.mp3",
      mimeType: manifest.mimeType ?? "audio/mpeg",
      durationSec: manifest.durationSec ?? null,
      tags: manifest.tags ?? [],
      notes: manifest.notes ?? null,
      fieldCount: Array.isArray(manifest.form_data)
        ? manifest.form_data.reduce(
            (acc, group) => acc + (Array.isArray(group.fields) ? group.fields.length : 0),
            0,
          )
        : 0,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const outPath = join(root, "index.json");
writeFileSync(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2),
);
console.log(`[test-cases] Wrote ${cases.length} entries to ${outPath}`);
