#!/usr/bin/env node
/**
 * SPEC.md is canonical HERE, in the neutral flagship (protocol/SPEC.md →
 * silverprotocol/silverprotocol). Each language SDK vendors a byte-identical
 * follower copy so its own self-contained drift gate (e.g. the TypeScript
 * SDK's check-spec-drift.mjs, which compares SPEC.md ↔ agjson.ts and runs in
 * the public typescript-sdk repo where protocol/ does not exist) can resolve
 * a SPEC.md next to its schema.
 *
 * This script propagates the canonical spec to those followers.
 *
 *   node protocol/scripts/sync-spec.mjs           # copy canonical -> every follower
 *   node protocol/scripts/sync-spec.mjs --check    # fail if any follower has drifted
 *
 * Run --check in CI / before any subtree push so a stale SDK copy never ships.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const canonical = resolve(root, "protocol", "SPEC.md");

// every SDK path that vendors a follower copy of the spec
const followers = [resolve(root, "sdks", "typescript", "SPEC.md")];

const check = process.argv.includes("--check");
const src = await readFile(canonical, "utf8");

let drift = false;
for (const follower of followers) {
  const rel = follower.slice(root.length + 1);
  if (check) {
    const cur = await readFile(follower, "utf8").catch(() => null);
    if (cur !== src) {
      console.error(`✗ ${rel} has drifted from the canonical protocol/SPEC.md`);
      drift = true;
    } else {
      console.log(`✓ ${rel} is in sync`);
    }
  } else {
    await writeFile(follower, src);
    console.log(`✓ Synced ${rel} (${src.length} bytes) from protocol/SPEC.md`);
  }
}

if (check && drift) {
  console.error("\n  Fix with: node protocol/scripts/sync-spec.mjs");
  process.exit(1);
}
