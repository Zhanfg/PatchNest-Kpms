#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const metadataPath = path.join(root, 'modules/diagnostic-hello/module.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const graph = metadata.buildGraph;

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
};
const sorted = (values) => [...values].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const safeRepoPath = (value) => {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const resolved = path.resolve(root, value);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
};

if (metadata.schemaVersion !== 2) fail('module metadata schemaVersion must be 2');
if (!graph || typeof graph !== 'object') fail('buildGraph must be an object');

for (const key of ['sources', 'objects', 'declaredInputs', 'allowedUndefinedSymbols']) {
  if (!Array.isArray(graph?.[key]) || graph[key].length === 0) fail(`buildGraph.${key} must be a non-empty array`);
}
for (const key of ['linkerScript']) {
  if (!safeRepoPath(graph?.[key])) fail(`buildGraph.${key} must be a safe repository path`);
}
for (const value of [...(graph?.sources || []), ...(graph?.declaredInputs || [])]) {
  if (!safeRepoPath(value)) fail(`unsafe declared build path: ${value}`);
  else if (!fs.existsSync(path.join(root, value))) fail(`missing declared build input: ${value}`);
}
if (graph?.networkDuringBuild !== false) fail('networkDuringBuild must be false');
if (graph?.generatedSource !== false) fail('generatedSource must be false');
if (metadata.binaryCapabilityProof !== false) fail('binaryCapabilityProof must remain false');

const moduleDir = path.join(root, 'modules/diagnostic-hello');
const actualLocalInputs = fs.readdirSync(moduleDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => name === 'Makefile' || /\.(?:c|h|S|s|lds)$/.test(name))
  .map((name) => path.posix.join('modules/diagnostic-hello', name));
if (!same(actualLocalInputs, graph?.declaredInputs || [])) {
  fail(`declaredInputs mismatch: actual=${sorted(actualLocalInputs).join(',')} declared=${sorted(graph?.declaredInputs || []).join(',')}`);
}

const makefilePath = path.join(moduleDir, 'Makefile');
const makefile = fs.readFileSync(makefilePath, 'utf8');
if (/\b(?:curl|wget)\b|\bgit\s+(?:clone|fetch|pull)\b|\b(?:python|node)\b.*https?:\/\//i.test(makefile)) {
  fail('Makefile contains undeclared network-capable build commands');
}

const objectsMatch = makefile.match(/^OBJECTS\s*:=\s*(.+)$/m);
const makeObjects = objectsMatch ? objectsMatch[1].trim().split(/\s+/).filter(Boolean) : [];
if (!same(makeObjects, graph?.objects || [])) fail('Makefile OBJECTS differs from buildGraph.objects');

const linkerMatch = makefile.match(/^LINKER_SCRIPT\s*:=\s*(\S+)$/m);
const expectedLinker = path.posix.basename(graph?.linkerScript || '');
if (!linkerMatch || linkerMatch[1] !== expectedLinker) fail('Makefile LINKER_SCRIPT differs from metadata');

const mapMatch = makefile.match(/^MAP\s*:=\s*(\S+)$/m);
if (!mapMatch || mapMatch[1] !== graph?.mapFile) fail('Makefile MAP differs from metadata');

const compileLines = makefile.split(/\r?\n/).filter((line) => /\$\(CC\).*\s-c(?:\s|$)/.test(line));
if (compileLines.length !== 1) fail('expected exactly one compile command');
for (const line of compileLines) {
  if (/(?:^|\s)-T\S*|-Wl,-T/.test(line)) fail('linker script must not be passed to compile-only command');
}

const linkLines = makefile.split(/\r?\n/).filter((line) => /\$\(CC\).*\s-r(?:\s|$)/.test(line));
if (linkLines.length !== 1) fail('expected exactly one relocatable link command');
if (linkLines.length === 1) {
  const line = linkLines[0];
  for (const required of ['-Wl,-T,$(LINKER_SCRIPT)', '-Wl,-Map,$(MAP)', '$(OBJECTS)']) {
    if (!line.includes(required)) fail(`final link command missing ${required}`);
  }
}

const sourcePath = path.join(root, metadata.source);
const source = fs.readFileSync(sourcePath, 'utf8');
for (const marker of ['KPM_NAME(', 'KPM_VERSION(', 'KPM_INIT(', 'KPM_EXIT(']) {
  if (!source.includes(marker)) fail(`diagnostic source missing ${marker}`);
}

for (const symbol of graph?.allowedUndefinedSymbols || []) {
  if (!/^[A-Za-z_][A-Za-z0-9_.$@]*$/.test(symbol)) fail(`invalid allowed undefined symbol: ${symbol}`);
}

if (!process.exitCode) console.log('Diagnostic KPM declared build graph is closed and consistent.');
