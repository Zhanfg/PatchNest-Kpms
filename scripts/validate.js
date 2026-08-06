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

const catalog = readJson('kpm_repo.json');
const drafts = readJson('drafts.json');

if (!Number.isInteger(catalog.version) || catalog.version < 1) {
  fail('kpm_repo.json version must be a positive integer');
}
if (!Array.isArray(catalog.modules)) {
  fail('kpm_repo.json modules must be an array');
}
if (!Array.isArray(drafts.drafts)) {
  fail('drafts.json drafts must be an array');
}

const required = [
  'id',
  'name',
  'version',
  'author',
  'description',
  'downloadUrl',
  'sha256',
  'minKpVersion',
  'minPatchNestVersion',
  'sourceCommit',
  'testedKernelRanges',
  'signatureRequired',
  'channel',
];
const installableIds = new Set();

for (const [index, mod] of catalog.modules.entries()) {
  for (const field of required) {
    if (mod[field] === undefined || mod[field] === null || mod[field] === '') {
      fail(`modules[${index}] is missing ${field}`);
    }
  }
  if (installableIds.has(mod.id)) fail(`duplicate installable module id: ${mod.id}`);
  installableIds.add(mod.id);

  let url;
  try {
    url = new URL(mod.downloadUrl);
  } catch {
    fail(`${mod.id}: invalid downloadUrl`);
    continue;
  }
  if (url.protocol !== 'https:') fail(`${mod.id}: downloadUrl must use HTTPS`);
  if (url.hostname !== 'github.com') fail(`${mod.id}: downloadUrl must be a GitHub Release asset`);
  if (!url.pathname.includes('/releases/download/')) {
    fail(`${mod.id}: downloadUrl is not a GitHub Release asset`);
  }
  if (/example\.com|KPatch-Next-Module/i.test(mod.downloadUrl)) {
    fail(`${mod.id}: placeholder or retired download URL`);
  }
  if (!/^[0-9a-f]{64}$/.test(mod.sha256)) fail(`${mod.id}: invalid sha256`);
  if (!/^[0-9a-f]{40}$/.test(mod.sourceCommit)) fail(`${mod.id}: invalid sourceCommit`);
  if (!Array.isArray(mod.testedKernelRanges) || mod.testedKernelRanges.length === 0) {
    fail(`${mod.id}: testedKernelRanges must be a non-empty array`);
  }
  if (typeof mod.signatureRequired !== 'boolean') {
    fail(`${mod.id}: signatureRequired must be boolean`);
  }
  if (!['experimental', 'stable'].includes(mod.channel)) {
    fail(`${mod.id}: channel must be experimental or stable`);
  }
}

const draftIds = new Set();
const draftSources = new Set();
for (const [index, draft] of drafts.drafts.entries()) {
  if (!draft.id || !draft.source || !draft.status || !draft.reason) {
    fail(`drafts[${index}] must include id, source, status and reason`);
    continue;
  }
  if (draftIds.has(draft.id)) fail(`duplicate draft id: ${draft.id}`);
  if (draftSources.has(draft.source)) fail(`duplicate draft source: ${draft.source}`);
  if (installableIds.has(draft.id)) fail(`${draft.id}: cannot be both draft and installable`);
  draftIds.add(draft.id);
  draftSources.add(draft.source);

  const sourcePath = path.join(root, draft.source);
  if (!fs.existsSync(sourcePath)) fail(`${draft.id}: missing source ${draft.source}`);
}

const sourceDir = path.join(root, 'module', 'kpms');
const checkedInSources = fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith('.c'))
  .map((name) => `module/kpms/${name}`)
  .sort();
const inventoriedSources = [...draftSources].sort();

for (const source of checkedInSources) {
  if (!draftSources.has(source)) fail(`untracked prototype source: ${source}`);
}
for (const source of inventoriedSources) {
  if (!checkedInSources.includes(source)) fail(`draft inventory points to absent source: ${source}`);
}

if (!process.exitCode) {
  console.log(`Catalog valid: ${catalog.modules.length} installable, ${drafts.drafts.length} drafts.`);
}
