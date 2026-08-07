#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManifest } = require('../scripts/generate-provenance.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'patchnest-provenance-'));
try {
  const moduleDir = path.join(temp, 'module');
  const reportDir = path.join(temp, 'report');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'patchnest-diagnostic-hello.kpm'), 'artifact');
  fs.writeFileSync(path.join(moduleDir, 'patchnest-diagnostic-hello.map'), 'map');
  fs.writeFileSync(path.join(moduleDir, 'diagnostic_hello.o'), 'object');
  fs.writeFileSync(
    path.join(reportDir, 'source-inputs.json'),
    JSON.stringify({ inputs: [{ path: 'x.c', sha256: 'a'.repeat(64), size: 1 }] }),
  );

  const common = {
    MODULE_DIR: moduleDir,
    REPORT_DIR: reportDir,
    ARTIFACT_NAME: 'patchnest-diagnostic-hello.kpm',
    GITHUB_REPOSITORY: 'Zhanfg/PatchNest-Kpms',
    WORKFLOW_REF: 'Zhanfg/PatchNest-Kpms/.github/workflows/build-diagnostic.yml@refs/pull/7/merge',
    RUN_ID: '123',
    RUN_ATTEMPT: '1',
    SOURCE_TREE_DIRTY_BEFORE_BUILD: 'false',
    KP_REPOSITORY: 'KernelSU-Next/KPatch-Next',
    KP_COMMIT: '0fe6d142266b80e5aa445a7ea1534f88a8f33a35',
    ARM_TOOLCHAIN_SHA256: 'b'.repeat(64),
  };

  const pullRequest = createManifest({
    ...common,
    GITHUB_EVENT_NAME: 'pull_request',
    SOURCE_HEAD_COMMIT: '1'.repeat(40),
    BASE_COMMIT: '2'.repeat(40),
    TESTED_CHECKOUT_COMMIT: '3'.repeat(40),
    TESTED_MERGE_COMMIT: '3'.repeat(40),
  });
  assert.equal(pullRequest.sourceHeadCommit, '1'.repeat(40));
  assert.equal(pullRequest.baseCommit, '2'.repeat(40));
  assert.equal(pullRequest.testedCheckoutCommit, '3'.repeat(40));
  assert.equal(pullRequest.testedMergeCommit, '3'.repeat(40));
  assert.deepEqual(pullRequest.physicalValidationBinding, {
    artifactSha256: pullRequest.sha256,
    sourceHeadCommit: '1'.repeat(40),
    testedMergeCommit: '3'.repeat(40),
  });

  const push = createManifest({
    ...common,
    GITHUB_EVENT_NAME: 'push',
    SOURCE_HEAD_COMMIT: '4'.repeat(40),
    BASE_COMMIT: '',
    TESTED_CHECKOUT_COMMIT: '4'.repeat(40),
    TESTED_MERGE_COMMIT: '',
  });
  assert.equal(push.sourceHeadCommit, '4'.repeat(40));
  assert.equal(push.baseCommit, null);
  assert.equal(push.testedCheckoutCommit, '4'.repeat(40));
  assert.equal(push.testedMergeCommit, null);
  assert.deepEqual(push.physicalValidationBinding, {
    artifactSha256: push.sha256,
    sourceHeadCommit: '4'.repeat(40),
    testedMergeCommit: null,
  });

  assert.throws(() => createManifest({
    ...common,
    GITHUB_EVENT_NAME: 'pull_request',
    SOURCE_HEAD_COMMIT: '5'.repeat(40),
    BASE_COMMIT: '',
    TESTED_CHECKOUT_COMMIT: '6'.repeat(40),
    TESTED_MERGE_COMMIT: '6'.repeat(40),
  }), /requires BASE_COMMIT/);

  assert.throws(() => createManifest({
    ...common,
    GITHUB_EVENT_NAME: 'pull_request',
    SOURCE_HEAD_COMMIT: '7'.repeat(40),
    BASE_COMMIT: '8'.repeat(40),
    TESTED_CHECKOUT_COMMIT: '9'.repeat(40),
    TESTED_MERGE_COMMIT: 'a'.repeat(40),
  }), /tested merge must equal actual checkout commit/);

  assert.throws(() => createManifest({
    ...common,
    GITHUB_EVENT_NAME: 'pull_request',
    SOURCE_HEAD_COMMIT: 'c'.repeat(40),
    BASE_COMMIT: 'd'.repeat(40),
    TESTED_CHECKOUT_COMMIT: 'c'.repeat(40),
    TESTED_MERGE_COMMIT: 'c'.repeat(40),
  }), /source head must not be replaced/);

  process.stdout.write('provenance tests: PASS\n');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
