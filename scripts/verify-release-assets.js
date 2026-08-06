#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'kpm_repo.json'), 'utf8'));
const maxAssetBytes = 64 * 1024 * 1024;

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

async function verifyAsset(mod) {
  git(['cat-file', '-e', `${mod.sourceCommit}^{commit}`]);
  git(['merge-base', '--is-ancestor', mod.sourceCommit, 'HEAD']);
  git(['cat-file', '-e', `${mod.sourceCommit}:${mod.source}`]);

  const tagCommit = git(['rev-list', '-n', '1', mod.releaseTag]);
  if (tagCommit !== mod.sourceCommit) {
    throw new Error(`${mod.id}: release tag ${mod.releaseTag} points to ${tagCommit}, expected ${mod.sourceCommit}`);
  }

  const source = git(['show', `${mod.sourceCommit}:${mod.source}`]);
  if (/\bmodule_init\s*\(|\bmodule_exit\s*\(|\bMODULE_LICENSE\s*\(/.test(source)) {
    throw new Error(`${mod.id}: released source still uses Linux loadable-module interfaces`);
  }
  for (const macro of ['KPM_NAME', 'KPM_VERSION', 'KPM_LICENSE', 'KPM_INIT', 'KPM_EXIT']) {
    if (!new RegExp(`\\b${macro}\\s*\\(`).test(source)) {
      throw new Error(`${mod.id}: released source is missing ${macro}`);
    }
  }

  const response = await fetch(mod.downloadUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PatchNest-Kpms-catalog-verifier',
      Accept: 'application/octet-stream',
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`${mod.id}: asset download failed with HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxAssetBytes) {
    throw new Error(`${mod.id}: asset exceeds ${maxAssetBytes} bytes`);
  }

  const hash = crypto.createHash('sha256');
  let total = 0;
  let prefix = Buffer.alloc(0);
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxAssetBytes) throw new Error(`${mod.id}: asset exceeds ${maxAssetBytes} bytes`);
    if (prefix.length < 4) prefix = Buffer.concat([prefix, buffer]).subarray(0, 4);
    hash.update(buffer);
  }

  if (prefix.length < 4 || prefix[0] !== 0x50 || prefix[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(prefix[2])) {
    throw new Error(`${mod.id}: release asset is not a ZIP archive`);
  }
  if (mod.size !== undefined && total !== mod.size) {
    throw new Error(`${mod.id}: downloaded size ${total} does not match catalog size ${mod.size}`);
  }

  const actual = hash.digest('hex');
  if (actual !== mod.sha256) {
    throw new Error(`${mod.id}: SHA-256 mismatch: expected ${mod.sha256}, got ${actual}`);
  }

  console.log(`${mod.id}: verified ${total} bytes, sha256=${actual}`);
}

async function main() {
  git(['fetch', '--tags', '--force'], { capture: false });
  for (const mod of catalog.modules) await verifyAsset(mod);
  console.log(`Release verification complete: ${catalog.modules.length} installable module(s).`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
