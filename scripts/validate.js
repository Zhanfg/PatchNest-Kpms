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
const isSafeRepoPath = (value) => {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const resolved = path.resolve(root, value);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
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
  'id', 'name', 'version', 'author', 'description', 'downloadUrl', 'sha256',
  'minKpVersion', 'minPatchNestVersion', 'sourceCommit', 'testedKernelRanges',
  'signatureRequired', 'channel',
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
  if (!url.pathname.includes('/releases/download/')) fail(`${mod.id}: downloadUrl is not a GitHub Release asset`);
  if (/example\.com|KPatch-Next-Module/i.test(mod.downloadUrl)) fail(`${mod.id}: placeholder or retired download URL`);
  if (!/^[0-9a-f]{64}$/.test(mod.sha256)) fail(`${mod.id}: invalid sha256`);
  if (!/^[0-9a-f]{40}$/.test(mod.sourceCommit)) fail(`${mod.id}: invalid sourceCommit`);
  if (!Array.isArray(mod.testedKernelRanges) || mod.testedKernelRanges.length === 0) {
    fail(`${mod.id}: testedKernelRanges must be a non-empty array`);
  }
  if (typeof mod.signatureRequired !== 'boolean') fail(`${mod.id}: signatureRequired must be boolean`);
  if (!['experimental', 'stable'].includes(mod.channel)) fail(`${mod.id}: channel must be experimental or stable`);
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
for (const source of checkedInSources) {
  if (!draftSources.has(source)) fail(`untracked prototype source: ${source}`);
}
for (const source of [...draftSources].sort()) {
  if (!checkedInSources.includes(source)) fail(`draft inventory points to absent source: ${source}`);
}

const candidatesRoot = path.join(root, 'modules');
const candidateIds = new Set();
let candidateCount = 0;
if (fs.existsSync(candidatesRoot)) {
  for (const entry of fs.readdirSync(candidatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relativeDir = path.posix.join('modules', entry.name);
    const metadataPath = path.posix.join(relativeDir, 'module.json');
    if (!fs.existsSync(path.join(root, metadataPath))) {
      fail(`${relativeDir}: missing module.json`);
      continue;
    }

    candidateCount += 1;
    const candidate = readJson(metadataPath);
    for (const field of [
      'schemaVersion', 'id', 'name', 'version', 'author', 'license', 'description',
      'source', 'artifact', 'channel', 'installable', 'upstreamSdk', 'buildGraph',
      'binaryCapabilityProof',
    ]) {
      if (candidate[field] === undefined || candidate[field] === null || candidate[field] === '') {
        fail(`${metadataPath}: missing ${field}`);
      }
    }
    if (candidate.schemaVersion !== 2) fail(`${candidate.id}: schemaVersion must be 2`);
    if (candidateIds.has(candidate.id)) fail(`duplicate candidate id: ${candidate.id}`);
    if (installableIds.has(candidate.id)) fail(`${candidate.id}: candidate metadata cannot duplicate an installable catalog entry`);
    candidateIds.add(candidate.id);

    if (candidate.installable !== false || candidate.channel !== 'build-only') {
      fail(`${candidate.id}: unvalidated candidate must remain build-only and non-installable`);
    }
    if (candidate.binaryCapabilityProof !== false) {
      fail(`${candidate.id}: static build checks must not be represented as binary capability proof`);
    }
    if (!candidate.upstreamSdk || !/^[0-9a-f]{40}$/.test(candidate.upstreamSdk.commit || '')) {
      fail(`${candidate.id}: invalid pinned upstream SDK commit`);
    }
    if (!Array.isArray(candidate.prohibitedCapabilities) || candidate.prohibitedCapabilities.length === 0) {
      fail(`${candidate.id}: prohibitedCapabilities must be documented`);
    }

    const graph = candidate.buildGraph;
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
      fail(`${candidate.id}: buildGraph must be an object`);
      continue;
    }
    for (const field of ['sources', 'objects', 'declaredInputs', 'allowedUndefinedSymbols']) {
      if (!Array.isArray(graph[field]) || graph[field].length === 0) {
        fail(`${candidate.id}: buildGraph.${field} must be a non-empty array`);
      }
    }
    if (graph.networkDuringBuild !== false) fail(`${candidate.id}: buildGraph.networkDuringBuild must be false`);
    if (graph.generatedSource !== false) fail(`${candidate.id}: buildGraph.generatedSource must be false`);
    if (!isSafeRepoPath(graph.linkerScript)) fail(`${candidate.id}: invalid buildGraph.linkerScript`);
    if (typeof graph.mapFile !== 'string' || !graph.mapFile || path.isAbsolute(graph.mapFile)) {
      fail(`${candidate.id}: invalid buildGraph.mapFile`);
    }

    const graphPaths = [...(graph.sources || []), ...(graph.declaredInputs || [])];
    for (const file of graphPaths) {
      if (!isSafeRepoPath(file)) {
        fail(`${candidate.id}: unsafe declared build input ${file}`);
        continue;
      }
      if (!fs.existsSync(path.join(root, file))) fail(`${candidate.id}: missing declared build input ${file}`);
    }
    if (!(graph.sources || []).includes(candidate.source)) {
      fail(`${candidate.id}: candidate.source must be included in buildGraph.sources`);
    }

    const requiredFiles = [candidate.source, path.posix.join(relativeDir, 'Makefile'), path.posix.join(relativeDir, 'README.md')];
    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(root, file))) fail(`${candidate.id}: missing ${file}`);
    }

    const source = fs.existsSync(path.join(root, candidate.source))
      ? fs.readFileSync(path.join(root, candidate.source), 'utf8')
      : '';
    for (const marker of ['KPM_NAME(', 'KPM_VERSION(', 'KPM_INIT(', 'KPM_EXIT(']) {
      if (!source.includes(marker)) fail(`${candidate.id}: source missing ${marker}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`Catalog valid: ${catalog.modules.length} installable, ${drafts.drafts.length} drafts, ${candidateCount} build-only candidates.`);
}
