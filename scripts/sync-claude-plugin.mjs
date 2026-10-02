#!/usr/bin/env node
// The npm marketplace source remains intact; the directory gets this focused folder.
import { addCommon, addFile, addSkill, syncPackage } from './plugin-files.mjs';

const expected = new Map();
addCommon(expected);
addFile(expected, '.claude-plugin/plugin.json', '.claude-plugin/plugin.json');
for (const name of ['phone-a-friend', 'curiosity-engine']) addSkill(expected, name, 'claude');
for (const name of ['phone-a-friend', 'curiosity-engine', 'phone-a-team']) addFile(expected, `commands/${name}.md`, `commands/${name}.md`);
addFile(expected, 'agents/paf-reviewer.md', 'agents/paf-reviewer.md');
syncPackage('plugins/claude', expected, process.argv[2]);
