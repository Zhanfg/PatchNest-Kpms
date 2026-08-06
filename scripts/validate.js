#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isLowerHex = (value, length) => new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const isVersion = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
const isSafeRelativePath = (value) => {
  if (!isNonEmptyString(value) || value.includes('\\') || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value)) return false;
  return path.posix.normalize(value) === value && !value.startsWith('../') && !value.includes('/../');
};

const catalog = readJson('kpm_repo.json');
const drafts = readJson('drafts.json');

if (!isPlainObject(catalog)) fail('kpm_repo.json must contain an object');
if (!isNonEmptyString(catalog.name)) fail('kpm_repo.json name must be non-empty');
if (!isNonEmptyString(catalog.description)) fail('kpm_repo.json description must be non-empty');
if (catalog.version !== 2) fail('kpm_repo.json version must be 2');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(catalog.repository || '')) {
  fail('kpm_repo.json repository must be an owner/repository identifier');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.updatedAt || '')) {
  fail('kpm_repo.json updatedAt must use YYYY-MM-DD');
} else {
  const parsedDate = new Date(`${catalog.updatedAt}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== catalog.updatedAt) {
    fail('kpm_repo.json updatedAt is not a real calendar date');
  }
}

const expectedCatalogUrl = `https://raw.githubusercontent.com/${catalog.repository}/main/kpm_repo.json`;
if (catalog.catalogUrl !== expectedCatalogUrl) {
  fail(`kpm_repo.json catalogUrl must be ${expectedCatalogUrl}`);
}
if (!Array.isArray(catalog.modules)) fail('kpm_repo.json modules must be an array');

if (!isPlainObject(drafts)) fail('drafts.json must contain an object');
if (!Number.isInteger(drafts.version) || drafts.version < 1) {
  fail('drafts.json version must be a positive integer');
}
if (!isPlainObject(drafts.upstreamSdk)) {
  fail('drafts.json upstreamSdk must be an object');
} else {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(drafts.upstreamSdk.repository || '')) {
    fail('drafts.json upstreamSdk.repository must be owner/repository');
  }
  if (!isLowerHex(drafts.upstreamSdk.commit || '', 40)) {
    fail('drafts.json upstreamSdk.commit must be a lowercase 40-character commit SHA');
  }
}
if (!Array.isArray(drafts.drafts)) fail('drafts.json drafts must be an array');

const requiredModuleFields = [
  'id',
  'name',
  'version',
  'author',
  'description',
  'source',
  'sourceCommit',
  'releaseTag',
  'assetName',
  'downloadUrl',
  'sha256',
  'minKpVersion',
  'minPatchNestVersion',
  'testedKernelRanges',
  'signatureRequired',
  'channel',
];

const installableIds = new Set();
const installableSources = new Set();
const installableUrls = new Set();

for (const [index, mod] of catalog.modules.entries()) {
  if (!isPlainObject(mod)) {
    fail(`modules[${index}] must be an object`);
    continue;
  }
  for (const field of requiredModuleFields) {
    if (mod[field] === undefined || mod[field] === null || mod[field] === '') {
      fail(`modules[${index}] is missing ${field}`);
    }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mod.id || '')) {
    fail(`modules[${index}].id must be a lowercase kebab-case identifier`);
  }
  if (installableIds.has(mod.id)) fail(`duplicate installable module id: ${mod.id}`);
  installableIds.add(mod.id);

  for (const field of ['name', 'author', 'description']) {
    if (!isNonEmptyString(mod[field])) fail(`${mod.id}: ${field} must be non-empty`);
  }
  for (const field of ['version', 'minKpVersion', 'minPatchNestVersion']) {
    if (!isVersion(mod[field])) fail(`${mod.id}: ${field} must be a semantic version`);
  }
  if (!isLowerHex(mod.sourceCommit || '', 40)) fail(`${mod.id}: invalid sourceCommit`);
  if (!isLowerHex(mod.sha256 || '', 64)) fail(`${mod.id}: invalid sha256`);

  if (!isSafeRelativePath(mod.source) || !mod.source.startsWith(`modules/${mod.id}/`)) {
    fail(`${mod.id}: source must be a normalized path under modules/${mod.id}/`);
  } else {
    const sourcePath = path.join(root, mod.source);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      fail(`${mod.id}: source file is absent: ${mod.source}`);
    }
  }
  if (installableSources.has(mod.source)) fail(`duplicate installable source: ${mod.source}`);
  installableSources.add(mod.source);

  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(mod.releaseTag || '')) {
    fail(`${mod.id}: releaseTag must be a version tag`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(mod.assetName || '')) {
    fail(`${mod.id}: assetName must be a simple .zip filename`);
  }

  let url;
  try {
    url = new URL(mod.downloadUrl);
  } catch {
    fail(`${mod.id}: invalid downloadUrl`);
    continue;
  }
  const expectedPath = `/${catalog.repository}/releases/download/${encodeURIComponent(mod.releaseTag)}/${encodeURIComponent(mod.assetName)}`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    fail(`${mod.id}: downloadUrl must use HTTPS on github.com`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail(`${mod.id}: downloadUrl must not contain credentials, query, or fragment`);
  }
  if (url.pathname !== expectedPath) {
    fail(`${mod.id}: downloadUrl must match repository, releaseTag, and assetName`);
  }
  if (installableUrls.has(mod.downloadUrl)) fail(`duplicate installable URL: ${mod.downloadUrl}`);
  installableUrls.add(mod.downloadUrl);

  if (!Array.isArray(mod.testedKernelRanges) || mod.testedKernelRanges.length === 0) {
    fail(`${mod.id}: testedKernelRanges must be a non-empty array`);
  } else {
    const uniqueRanges = new Set();
    for (const range of mod.testedKernelRanges) {
      if (!isNonEmptyString(range)) fail(`${mod.id}: testedKernelRanges entries must be strings`);
      if (uniqueRanges.has(range)) fail(`${mod.id}: duplicate tested kernel range: ${range}`);
      uniqueRanges.add(range);
    }
  }

  if (typeof mod.signatureRequired !== 'boolean') {
    fail(`${mod.id}: signatureRequired must be boolean`);
  }
  if (!['experimental', 'stable'].includes(mod.channel)) {
    fail(`${mod.id}: channel must be experimental or stable`);
  }
  if (mod.channel === 'stable' && mod.signatureRequired !== true) {
    fail(`${mod.id}: stable modules must require signatures`);
  }
  if (mod.size !== undefined && (!Number.isSafeInteger(mod.size) || mod.size <= 0)) {
    fail(`${mod.id}: size must be a positive integer when present`);
  }
}

const allowedDraftStatuses = new Set([
  'blocked-sdk-port',
  'awaiting-build-verification',
  'awaiting-device-validation',
  'rejected',
]);
const draftIds = new Set();
const draftSources = new Set();

for (const [index, draft] of drafts.drafts.entries()) {
  if (!isPlainObject(draft)) {
    fail(`drafts[${index}] must be an object`);
    continue;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id || '')) {
    fail(`drafts[${index}].id must be lowercase kebab-case`);
  }
  if (!isSafeRelativePath(draft.source) || !draft.source.startsWith('module/kpms/') || !draft.source.endsWith('.c')) {
    fail(`${draft.id || `drafts[${index}]`}: source must be a normalized C path under module/kpms/`);
  }
  if (!allowedDraftStatuses.has(draft.status)) {
    fail(`${draft.id || `drafts[${index}]`}: unsupported draft status`);
  }
  if (!isNonEmptyString(draft.reason)) {
    fail(`${draft.id || `drafts[${index}]`}: reason must be non-empty`);
  }
  if (draftIds.has(draft.id)) fail(`duplicate draft id: ${draft.id}`);
  if (draftSources.has(draft.source)) fail(`duplicate draft source: ${draft.source}`);
  if (installableIds.has(draft.id)) fail(`${draft.id}: cannot be both draft and installable`);
  draftIds.add(draft.id);
  draftSources.add(draft.source);

  const sourcePath = path.join(root, draft.source || '');
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    fail(`${draft.id}: missing source ${draft.source}`);
    continue;
  }

  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const hasLinuxModuleInterface = /\bmodule_init\s*\(|\bmodule_exit\s*\(|\bMODULE_LICENSE\s*\(/.test(sourceText);
  const hasKpmInterface = /\bKPM_NAME\s*\(/.test(sourceText) && /\bKPM_INIT\s*\(/.test(sourceText);
  if (draft.status === 'blocked-sdk-port') {
    if (!hasLinuxModuleInterface) {
      fail(`${draft.id}: blocked-sdk-port source no longer exposes the recorded Linux module interface`);
    }
    if (hasKpmInterface) {
      fail(`${draft.id}: source has KPM metadata but remains marked blocked-sdk-port`);
    }
  }
}

const sourceDir = path.join(root, 'module', 'kpms');
const checkedInSources = fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith('.c'))
  .map((name) => `module/kpms/${name}`)
  .sort();

for (const source of checkedInSources) {
  if (!draftSources.has(source)) fail(`untracked prototype source: ${source}`);
}
for (const source of [...draftSources].sort()) {
  if (!checkedInSources.includes(source)) fail(`draft inventory points to absent source: ${source}`);
}

if (!process.exitCode) {
  console.log(`Catalog valid: ${catalog.modules.length} installable, ${drafts.drafts.length} drafts.`);
}
