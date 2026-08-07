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

const normalizeRelative = (value) => path.posix.normalize(String(value).replaceAll('\\', '/'));
const sameSet = (left, right) => {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
};
const walkFiles = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
};
const validateCandidatePath = (candidateId, relativeDir, value, field) => {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${candidateId}: ${field} must be a non-empty path`);
    return null;
  }
  const normalized = normalizeRelative(value);
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    fail(`${candidateId}: ${field} must stay inside the repository`);
    return null;
  }
  if (!(normalized === relativeDir || normalized.startsWith(`${relativeDir}/`))) {
    fail(`${candidateId}: ${field} must stay inside ${relativeDir}`);
    return null;
  }
  return normalized;
};
const parseLiteralAssignment = (makefile, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = makefile.match(new RegExp(`^${escaped}\\s*:?=\\s*(.*?)\\s*$`, 'm'));
  return match ? match[1].trim() : null;
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

const candidatesRoot = path.join(root, 'modules');
const candidateIds = new Set();
let candidateCount = 0;
if (fs.existsSync(candidatesRoot)) {
  for (const entry of fs.readdirSync(candidatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relativeDir = path.posix.join('modules', entry.name);
    const absoluteDir = path.join(root, relativeDir);
    const metadataPath = path.posix.join(relativeDir, 'module.json');
    if (!fs.existsSync(path.join(root, metadataPath))) {
      fail(`${relativeDir}: missing module.json`);
      continue;
    }

    candidateCount += 1;
    const candidate = readJson(metadataPath);
    for (const field of [
      'id', 'name', 'version', 'author', 'license', 'description', 'source',
      'artifact', 'channel', 'installable', 'upstreamSdk', 'build',
    ]) {
      if (candidate[field] === undefined || candidate[field] === null || candidate[field] === '') {
        fail(`${metadataPath}: missing ${field}`);
      }
    }
    if (!candidate.id) continue;
    if (candidateIds.has(candidate.id)) fail(`duplicate candidate id: ${candidate.id}`);
    if (installableIds.has(candidate.id)) {
      fail(`${candidate.id}: candidate metadata cannot duplicate an installable catalog entry`);
    }
    candidateIds.add(candidate.id);

    if (candidate.installable !== false || candidate.channel !== 'build-only') {
      fail(`${candidate.id}: unvalidated candidate must remain build-only and non-installable`);
    }
    if (!candidate.upstreamSdk || !/^[0-9a-f]{40}$/.test(candidate.upstreamSdk.commit || '')) {
      fail(`${candidate.id}: invalid pinned upstream SDK commit`);
    }
    if (!Array.isArray(candidate.prohibitedCapabilities) || candidate.prohibitedCapabilities.length === 0) {
      fail(`${candidate.id}: prohibitedCapabilities must be documented`);
    }

    const build = candidate.build || {};
    for (const field of ['sources', 'localHeaders', 'declaredInputs', 'generatedOutputs', 'allowedUndefinedSymbols']) {
      if (!Array.isArray(build[field])) fail(`${candidate.id}: build.${field} must be an array`);
    }
    if (!Array.isArray(build.sources) || build.sources.length === 0) {
      fail(`${candidate.id}: build.sources must contain at least one source`);
    }
    if (!Array.isArray(build.allowedUndefinedSymbols) || build.allowedUndefinedSymbols.length === 0) {
      fail(`${candidate.id}: build.allowedUndefinedSymbols must be non-empty`);
    }
    if (!build.linkerScript) fail(`${candidate.id}: build.linkerScript is required`);

    const sourcePaths = new Set((build.sources || [])
      .map((value) => validateCandidatePath(candidate.id, relativeDir, value, 'build.sources[]'))
      .filter(Boolean));
    const localHeaders = new Set((build.localHeaders || [])
      .map((value) => validateCandidatePath(candidate.id, relativeDir, value, 'build.localHeaders[]'))
      .filter(Boolean));
    const declaredInputs = new Set((build.declaredInputs || [])
      .map((value) => validateCandidatePath(candidate.id, relativeDir, value, 'build.declaredInputs[]'))
      .filter(Boolean));
    const generatedOutputs = new Set((build.generatedOutputs || [])
      .map((value) => validateCandidatePath(candidate.id, relativeDir, value, 'build.generatedOutputs[]'))
      .filter(Boolean));
    const linkerScript = validateCandidatePath(
      candidate.id, relativeDir, build.linkerScript, 'build.linkerScript',
    );
    const primarySource = validateCandidatePath(candidate.id, relativeDir, candidate.source, 'source');

    if (primarySource && !sourcePaths.has(primarySource)) {
      fail(`${candidate.id}: primary source must be listed in build.sources`);
    }
    for (const input of [...sourcePaths, ...localHeaders, linkerScript, metadataPath].filter(Boolean)) {
      if (!declaredInputs.has(input)) fail(`${candidate.id}: undeclared build input ${input}`);
    }
    for (const output of generatedOutputs) {
      if (declaredInputs.has(output)) fail(`${candidate.id}: generated output overlaps declared input: ${output}`);
      if (fs.existsSync(path.join(root, output))) {
        fail(`${candidate.id}: generated output must not be checked in: ${output}`);
      }
    }

    const checkedInFiles = new Set(walkFiles(absoluteDir)
      .map((file) => normalizeRelative(path.relative(root, file))));
    if (!sameSet(checkedInFiles, declaredInputs)) {
      for (const file of checkedInFiles) {
        if (!declaredInputs.has(file)) fail(`${candidate.id}: undeclared checked-in candidate file: ${file}`);
      }
      for (const file of declaredInputs) {
        if (!checkedInFiles.has(file)) fail(`${candidate.id}: declared input is absent: ${file}`);
      }
    }

    for (const source of sourcePaths) {
      if (!/\.(c|S|s)$/.test(source)) fail(`${candidate.id}: unsupported source type: ${source}`);
    }
    for (const header of localHeaders) {
      if (!/\.h$/.test(header)) fail(`${candidate.id}: local header must end in .h: ${header}`);
    }
    for (const file of checkedInFiles) {
      if (/\.(c|S|s)$/.test(file) && !sourcePaths.has(file)) {
        fail(`${candidate.id}: source-like file is not in build.sources: ${file}`);
      }
      if (/\.h$/.test(file) && !localHeaders.has(file)) {
        fail(`${candidate.id}: header is not in build.localHeaders: ${file}`);
      }
      if (/\.o$/.test(file)) fail(`${candidate.id}: prebuilt object is forbidden: ${file}`);
    }

    const symbolSet = new Set();
    for (const symbol of build.allowedUndefinedSymbols || []) {
      if (typeof symbol !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) {
        fail(`${candidate.id}: invalid allowed undefined symbol: ${symbol}`);
        continue;
      }
      if (symbolSet.has(symbol)) fail(`${candidate.id}: duplicate allowed undefined symbol: ${symbol}`);
      symbolSet.add(symbol);
    }

    const makefilePath = path.join(absoluteDir, 'Makefile');
    if (!fs.existsSync(makefilePath)) {
      fail(`${candidate.id}: missing ${relativeDir}/Makefile`);
      continue;
    }
    const makefile = fs.readFileSync(makefilePath, 'utf8');
    const makeSources = parseLiteralAssignment(makefile, 'SOURCES');
    if (!makeSources || /[$*?`]/.test(makeSources)) {
      fail(`${candidate.id}: Makefile SOURCES must be a literal source allowlist`);
    } else {
      const declaredMakeSources = new Set(makeSources.split(/\s+/).filter(Boolean)
        .map((name) => path.posix.join(relativeDir, name)));
      if (!sameSet(declaredMakeSources, sourcePaths)) {
        fail(`${candidate.id}: Makefile SOURCES differs from module.json build.sources`);
      }
    }

    const makeObjects = parseLiteralAssignment(makefile, 'OBJECTS');
    if (makeObjects !== '$(SOURCES:.c=.o)') {
      fail(`${candidate.id}: Makefile OBJECTS must derive only from SOURCES`);
    }
    const makeLinkerScript = parseLiteralAssignment(makefile, 'LINKER_SCRIPT');
    if (linkerScript && makeLinkerScript !== path.posix.basename(linkerScript)) {
      fail(`${candidate.id}: Makefile LINKER_SCRIPT differs from module.json`);
    }
    const makeLdflags = parseLiteralAssignment(makefile, 'LDFLAGS') || '';
    for (const requiredFlag of ['-r', '-Wl,-T,$(LINKER_SCRIPT)', '-Wl,-Map,$(MAP)']) {
      if (!makeLdflags.includes(requiredFlag)) {
        fail(`${candidate.id}: Makefile LDFLAGS missing ${requiredFlag}`);
      }
    }
    if (!/^\t\$\(CC\) \$\(LDFLAGS\) -o \$@ \$\(OBJECTS\)$/m.test(makefile)) {
      fail(`${candidate.id}: final link command must consume only declared OBJECTS via LDFLAGS`);
    }
    for (const recipe of makefile.split('\n').filter((line) => line.startsWith('\t'))) {
      if (recipe.includes(' -c ') && /(^|\s)(-T|-Wl,-T)/.test(recipe)) {
        fail(`${candidate.id}: compile-only recipe contains linker-script flag`);
      }
      if (/\b(curl|wget|scp|ssh|socat|nc)\b|\bgit\s+(clone|fetch|pull|submodule)\b/.test(recipe)) {
        fail(`${candidate.id}: network-capable build recipe is forbidden: ${recipe.trim()}`);
      }
    }

    const prohibited = [
      /hook_wrap/i,
      /fp_hook/i,
      /syscall_hook/i,
      /kallsyms_lookup/i,
      /selinux/i,
      /proc_maps/i,
      /boot_state/i,
      /module_hide/i,
    ];
    for (const codeInput of [...sourcePaths, ...localHeaders]) {
      const content = fs.readFileSync(path.join(root, codeInput), 'utf8');
      for (const pattern of prohibited) {
        if (pattern.test(content)) {
          fail(`${candidate.id}: prohibited source-scope marker ${pattern} in ${codeInput}`);
        }
      }
    }
    for (const source of sourcePaths) {
      const content = fs.readFileSync(path.join(root, source), 'utf8');
      for (const marker of ['KPM_NAME(', 'KPM_VERSION(', 'KPM_INIT(', 'KPM_EXIT(']) {
        if (!content.includes(marker)) fail(`${candidate.id}: source missing ${marker}`);
      }
    }
  }
}

if (!process.exitCode) {
  console.log(
    `Catalog valid: ${catalog.modules.length} installable, ` +
    `${drafts.drafts.length} drafts, ${candidateCount} build-only candidates.`,
  );
}
