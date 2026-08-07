#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const moduleDir = path.join(root, 'modules', 'diagnostic-hello');
const toolPrefix = '/__patchnest_toolchain__/aarch64-none-elf-';
const sdkRoot = '/__patchnest_sdk__';

function normalizeCommands(output) {
  const commands = [];
  let pending = '';

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }

    const command = `${pending}${line}`.replace(/\s+/g, ' ').trim();
    pending = '';
    if (command) commands.push(command);
  }

  if (pending.trim()) commands.push(pending.replace(/\s+/g, ' ').trim());
  return commands;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const result = spawnSync(
  'make',
  [
    '--no-print-directory',
    '-C', moduleDir,
    '-n',
    `TARGET_COMPILE=${toolPrefix}`,
    `KP_DIR=${sdkRoot}`,
    'all',
  ],
  { encoding: 'utf8' },
);

if (result.error) fail(`unable to dry-run diagnostic Makefile: ${result.error.message}`);
if (result.status !== 0) {
  process.stderr.write(result.stderr || '');
  fail(`diagnostic Makefile dry-run exited ${result.status}`);
}

const commands = normalizeCommands(result.stdout);
const expected = [
  `${toolPrefix}gcc -O2 -Wall -Wextra -Werror=implicit-function-declaration -Werror=int-conversion -MMD -MP -MF diagnostic_hello.d -I${sdkRoot}/kernel/. -I${sdkRoot}/kernel/include -I${sdkRoot}/kernel/patch/include -I${sdkRoot}/kernel/linux/include -I${sdkRoot}/kernel/linux/arch/arm64/include -I${sdkRoot}/kernel/linux/tools/arch/arm64/include -c -o diagnostic_hello.o diagnostic_hello.c`,
  `test -f "${sdkRoot}/kpms/demo-hello/hello.lds" || { echo "missing pinned upstream linker script: ${sdkRoot}/kpms/demo-hello/hello.lds" >&2; exit 1; }`,
  `cmp "diagnostic_hello.lds" "${sdkRoot}/kpms/demo-hello/hello.lds" || { echo "local linker script diverged from pinned upstream contract" >&2; exit 1; }`,
  `${toolPrefix}gcc -r -Wl,-T,diagnostic_hello.lds -Wl,-Map,patchnest-diagnostic-hello.map -o patchnest-diagnostic-hello.kpm diagnostic_hello.o`,
  `for section in .plt .init.plt .text.ftrace_trampoline; do ${toolPrefix}readelf -SW patchnest-diagnostic-hello.kpm | awk -v section="$section" 'BEGIN { found=0 } { for (i=1; i<=NF; i++) if ($i == section) { found=1; size=$(i + 4); if (size !~ /^0*1$/) exit 2 } } END { if (!found) exit 1 }' || { echo "linker sentinel contract failed for $section" >&2; exit 1; }; done`,
].map((command) => command.replace(/\s+/g, ' ').trim());

if (commands.length !== expected.length) {
  fail(`build plan command count changed: expected ${expected.length}, observed ${commands.length}\n${commands.join('\n')}`);
}

for (let i = 0; i < expected.length; i += 1) {
  if (commands[i] !== expected[i]) {
    fail(
      `build plan command ${i + 1} changed\nEXPECTED: ${expected[i]}\nOBSERVED: ${commands[i]}`,
    );
  }
}

console.log(`Diagnostic build plan valid: ${commands.length} commands, no hidden prerequisites or recipes.`);
