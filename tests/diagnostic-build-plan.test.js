#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function copyRepo() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'patchnest-build-plan-'));
  fs.cpSync(repoRoot, temp, {
    recursive: true,
    filter: (source) => path.basename(source) !== '.git' && !source.includes(`${path.sep}build-reports${path.sep}`),
  });
  return temp;
}

function run(root) {
  return spawnSync(process.execPath, ['scripts/validate-diagnostic-build-plan.js'], {
    cwd: root,
    encoding: 'utf8',
  });
}

const baseline = copyRepo();
try {
  const result = run(baseline);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write('PASS baseline diagnostic build plan\n');
} finally {
  fs.rmSync(baseline, { recursive: true, force: true });
}

const hiddenPrerequisite = copyRepo();
try {
  const makefile = path.join(hiddenPrerequisite, 'modules/diagnostic-hello/Makefile');
  fs.appendFileSync(
    makefile,
    '\n$(TARGET): hidden-prelink\n\nhidden-prelink:\n\tprintf hidden-prelink > /tmp/patchnest-hidden-prelink\n',
  );
  const result = run(hiddenPrerequisite);
  assert.notEqual(result.status, 0, 'hidden prerequisite unexpectedly passed the build-plan gate');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /build plan command count changed|build plan command \d+ changed/,
  );
  process.stdout.write('PASS reject hidden pre-link prerequisite recipe\n');
} finally {
  fs.rmSync(hiddenPrerequisite, { recursive: true, force: true });
}

const extraTargetRecipe = copyRepo();
try {
  const makefile = path.join(extraTargetRecipe, 'modules/diagnostic-hello/Makefile');
  const original = fs.readFileSync(makefile, 'utf8');
  fs.writeFileSync(
    makefile,
    original.replace(
      '$(CC) $(LDFLAGS) -o $@ $(OBJECTS)',
      '$(CC) $(LDFLAGS) -o $@ $(OBJECTS)\n\tprintf post-link > /tmp/patchnest-post-link',
    ),
  );
  const result = run(extraTargetRecipe);
  assert.notEqual(result.status, 0, 'extra final-target recipe unexpectedly passed the build-plan gate');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /build plan command count changed|build plan command \d+ changed/,
  );
  process.stdout.write('PASS reject extra final-target recipe\n');
} finally {
  fs.rmSync(extraTargetRecipe, { recursive: true, force: true });
}

process.stdout.write('diagnostic build-plan tests: PASS\n');
