#!/usr/bin/env node
// Generate the complete Codex marketplace/submission folder, including resources.
import { addCommon, addFile, addSkill, syncPackage } from './plugin-files.mjs';

const expected = new Map();
addCommon(expected);
addFile(expected, '.codex-plugin/plugin.json', '.codex-plugin/plugin.json');
for (const name of ['phone-a-friend', 'curiosity-engine', 'phone-a-team']) addSkill(expected, name, 'codex');
syncPackage('plugins/phone-a-friend', expected, process.argv[2]);
