#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baseCatalog = JSON.parse(fs.readFileSync(path.join(root, 'kpm_repo.json'), 'utf8'));
const baseDrafts = JSON.parse(fs.readFileSync(path.join(root, 'drafts.json'), 'utf8'));
const validator = path.join(root, 'scripts', 'validate.js');

const clone = (value) => JSON.parse(JSON.stringify(value));

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validModule(id = 'sample-module') {
  return {
    id,
    name: 'Sample Module',
    version: '1.0.0',
    author: 'PatchNest Test',
    description: 'Contract fixture used only by the offline validator test.',
    source: `modules/${id}/module.c`,
    sourceCommit: '0'.repeat(40),
    releaseTag: 'v1.0.0',
    assetName: `${id}.zip`,
    downloadUrl: `https://github.com/${baseCatalog.repository}/releases/download/v1.0.0/${id}.zip`,
    sha256: '1'.repeat(64),
    minKpVersion: '0.13.3',
    minPatchNestVersion: '0.4.1',
    testedKernelRanges: ['6.1', '6.6'],
    signatureRequired: true,
    channel: 'stable',
    size: 4096,
  };
}

function runCase(name, mutate, expectedSuccess) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'patchnest-kpm-contract-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts'), { recursive: true });
    fs.copyFileSync(validator, path.join(temp, 'scripts', 'validate.js'));
    fs.cpSync(path.join(root, 'module'), path.join(temp, 'module'), { recursive: true });

    const catalog = clone(baseCatalog);
    const drafts = clone(baseDrafts);
    mutate({ temp, catalog, drafts });
    writeJson(path.join(temp, 'kpm_repo.json'), catalog);
    writeJson(path.join(temp, 'drafts.json'), drafts);

    const result = spawnSync(process.execPath, ['scripts/validate.js'], {
      cwd: temp,
      encoding: 'utf8',
    });
    const succeeded = result.status === 0;
    if (succeeded !== expectedSuccess) {
      console.error(`CASE FAILED: ${name}`);
      console.error(`expected success=${expectedSuccess}, actual success=${succeeded}`);
      if (result.stdout) console.error(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: ${name}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function addValidModule({ temp, catalog }, id = 'sample-module') {
  const mod = validModule(id);
  const sourcePath = path.join(temp, mod.source);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, '/* offline catalog contract fixture */\n', 'utf8');
  catalog.modules = [mod];
  return mod;
}

runCase('empty official catalog remains valid', () => {}, true);

runCase('complete installable entry passes schema validation', (state) => {
  addValidModule(state);
}, true);

runCase('release URL cannot target another repository', (state) => {
  const mod = addValidModule(state);
  mod.downloadUrl = 'https://github.com/another-owner/another-repo/releases/download/v1.0.0/sample-module.zip';
}, false);

runCase('source path traversal is rejected', (state) => {
  const mod = addValidModule(state);
  mod.source = 'modules/sample-module/../escape.c';
}, false);

runCase('stable module cannot disable signature enforcement', (state) => {
  const mod = addValidModule(state);
  mod.signatureRequired = false;
}, false);

runCase('draft and installable IDs cannot overlap', (state) => {
  addValidModule(state, state.drafts.drafts[0].id);
}, false);

runCase('canonical catalog URL is bound to repository metadata', ({ catalog }) => {
  catalog.catalogUrl = 'https://raw.githubusercontent.com/another/repository/main/kpm_repo.json';
}, false);

runCase('blocked draft cannot silently become KPM-shaped', ({ temp, drafts }) => {
  const first = drafts.drafts[0];
  const sourcePath = path.join(temp, first.source);
  fs.writeFileSync(
    sourcePath,
    'KPM_NAME("fixture");\nKPM_INIT(fixture_init);\nmodule_init(fixture_init);\n',
    'utf8',
  );
}, false);

if (process.exitCode) process.exit(process.exitCode);
console.log('All offline catalog contract tests passed.');
