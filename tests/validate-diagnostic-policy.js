#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const requireContract = (condition, message) => {
  if (!condition) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
};

const makefile = read('modules/diagnostic-hello/Makefile');
const metadata = json('modules/diagnostic-hello/module.json');
const validator = read('scripts/validate-build-graph.js');
const workflow = read('.github/workflows/build-diagnostic.yml');

requireContract(!/\$\(CC\).*\s-c[^\n]*-T/.test(makefile), 'compile-only command still receives linker script');
requireContract(/\$\(CC\) -r -Wl,-T,\$\(LINKER_SCRIPT\) -Wl,-Map,\$\(MAP\)/.test(makefile), 'final relocatable link is not linker-script/map bound');
requireContract(metadata.schemaVersion === 2, 'module metadata schema is not v2');
requireContract(metadata.installable === false && metadata.channel === 'build-only', 'diagnostic candidate escaped build-only isolation');
requireContract(metadata.binaryCapabilityProof === false, 'static checks are being represented as capability proof');
requireContract(metadata.buildGraph?.networkDuringBuild === false, 'build graph permits network');
requireContract(metadata.buildGraph?.generatedSource === false, 'build graph permits generated source');
requireContract(Array.isArray(metadata.buildGraph?.declaredInputs) && metadata.buildGraph.declaredInputs.length >= 3, 'declared build inputs missing');
requireContract(Array.isArray(metadata.buildGraph?.objects) && metadata.buildGraph.objects.length === 1, 'diagnostic build graph is not single-object as declared');
requireContract(validator.includes('declaredInputs mismatch'), 'build graph validator does not close undeclared local inputs');
requireContract(validator.includes('Makefile OBJECTS differs from buildGraph.objects'), 'build graph validator does not bind object list');
requireContract(validator.includes('undeclared network-capable build commands'), 'build graph validator does not reject network-capable recipes');
requireContract(workflow.includes('sourceHeadCommit'), 'provenance lacks source head identity');
requireContract(workflow.includes('testedMergeCommit'), 'provenance lacks tested checkout identity');
requireContract(workflow.includes('baseCommit'), 'provenance lacks PR base identity');
requireContract(workflow.includes('declaredInputDigests'), 'provenance lacks declared input digests');
requireContract(workflow.includes('objectDigests'), 'provenance lacks object digests');
requireContract(workflow.includes('linkMap'), 'provenance lacks link map digest');
requireContract(workflow.includes('undefinedSymbols'), 'provenance lacks final undefined-symbol inventory');
requireContract(!workflow.includes('prohibited diagnostic capability:'), 'obsolete single-source keyword capability proof remains in workflow');

console.log('Diagnostic KPM build/provenance policy contract passed.');
