#!/usr/bin/env node
// Keeps package.json's "version" as the single source of truth and mirrors it
// into src-tauri/tauri.conf.json and src-tauri/Cargo.toml, which Tauri/Cargo
// read independently and don't auto-sync with npm.
//
// Usage:
//   node scripts/sync-version.mjs          # sync all three to package.json's version
//   npm run sync-version
//   npm version minor                       # bumps package.json, then runs this
//                                            # automatically via the "version" hook below
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, 'package.json');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');

const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
if (!version) {
  console.error('sync-version: no "version" field in package.json');
  process.exit(1);
}

// tauri.conf.json: replace the top-level "version" field only. Checked with
// .test() (not before/after string equality) so this stays correct even when
// the file is already at the target version (a no-op replace still "found" it).
const tauriVersionRe = /^(\s*"version":\s*)"[^"]*"/m;
const tauriConf = readFileSync(tauriConfPath, 'utf8');
if (!tauriVersionRe.test(tauriConf)) {
  console.error('sync-version: could not find "version" field in tauri.conf.json');
  process.exit(1);
}
writeFileSync(tauriConfPath, tauriConf.replace(tauriVersionRe, `$1"${version}"`));

// Cargo.toml: replace only the first `version = "..."` line, which belongs to
// the [package] table (dependency versions use inline tables like
// `dep = { version = "..." }` or `dep = "^1.0"`, not a bare `version = ` key,
// so this stays scoped to the package's own version).
const cargoVersionRe = /^(version\s*=\s*)"[^"]*"/m;
const cargoToml = readFileSync(cargoTomlPath, 'utf8');
if (!cargoVersionRe.test(cargoToml)) {
  console.error('sync-version: could not find "version = ..." in Cargo.toml [package]');
  process.exit(1);
}
writeFileSync(cargoTomlPath, cargoToml.replace(cargoVersionRe, `$1"${version}"`));

console.log(`sync-version: tauri.conf.json and Cargo.toml now at ${version}`);
