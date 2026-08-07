#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = (env, name) => {
  const value = env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
};
const emptyToNull = (value) => value || null;

function createManifest(env = process.env) {
  const moduleDir = required(env, 'MODULE_DIR');
  const reportDir = required(env, 'REPORT_DIR');
  const artifactName = required(env, 'ARTIFACT_NAME');
  const artifactPath = `${moduleDir}/${artifactName}`;
  const mapPath = `${moduleDir}/patchnest-diagnostic-hello.map`;
  const objectPath = `${moduleDir}/diagnostic_hello.o`;
  const sourceInputs = JSON.parse(
    fs.readFileSync(`${reportDir}/source-inputs.json`, 'utf8'),
  ).inputs;

  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const sourceHeadCommit = required(env, 'SOURCE_HEAD_COMMIT');
  const testedCheckoutCommit = required(env, 'TESTED_CHECKOUT_COMMIT');
  const baseCommit = emptyToNull(env.BASE_COMMIT);
  const testedMergeCommit = emptyToNull(env.TESTED_MERGE_COMMIT);

  if (eventName === 'pull_request') {
    if (!baseCommit) throw new Error('pull_request provenance requires BASE_COMMIT');
    if (!testedMergeCommit) throw new Error('pull_request provenance requires TESTED_MERGE_COMMIT');
    if (testedMergeCommit !== testedCheckoutCommit) {
      throw new Error('pull_request tested merge must equal actual checkout commit');
    }
    if (sourceHeadCommit === testedMergeCommit) {
      throw new Error('pull_request source head must not be replaced by the temporary merge commit');
    }
  } else if (testedMergeCommit !== null) {
    throw new Error('non-pull_request provenance must set TESTED_MERGE_COMMIT to null/empty');
  }

  const artifactSha256 = digest(artifactPath);

  return {
    schemaVersion: 2,
    artifact: artifactName,
    sha256: artifactSha256,
    size: fs.statSync(artifactPath).size,
    eventName,
    repository: required(env, 'GITHUB_REPOSITORY'),
    workflowRef: required(env, 'WORKFLOW_REF'),
    runId: required(env, 'RUN_ID'),
    runAttempt: required(env, 'RUN_ATTEMPT'),
    sourceHeadCommit,
    baseCommit,
    testedCheckoutCommit,
    testedMergeCommit,
    sourceTreeDirtyBeforeBuild: env.SOURCE_TREE_DIRTY_BEFORE_BUILD === 'true',
    sourceInputs,
    objectSha256: digest(objectPath),
    linkMapSha256: digest(mapPath),
    sdkRepository: required(env, 'KP_REPOSITORY'),
    sdkCommit: required(env, 'KP_COMMIT'),
    toolchain: 'arm-gnu-toolchain-12.2.rel1-x86_64-aarch64-none-elf',
    toolchainSha256: required(env, 'ARM_TOOLCHAIN_SHA256'),
    physicalValidationBinding: {
      artifactSha256,
      sourceHeadCommit,
      testedMergeCommit,
    },
    installable: false,
    deviceValidated: false,
  };
}

function main() {
  const output = process.env.PROVENANCE_OUTPUT || `${required(process.env, 'REPORT_DIR')}/build-provenance.json`;
  fs.writeFileSync(output, JSON.stringify(createManifest(), null, 2) + '\n');
  process.stdout.write(fs.readFileSync(output, 'utf8'));
}

if (require.main === module) main();

module.exports = { createManifest };
