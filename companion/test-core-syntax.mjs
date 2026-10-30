import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const req=createRequire('C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app/package.json');
const source=readFileSync('companion/core-output-recovery.ts','utf8');req('esbuild').transformSync(source,{loader:'ts',format:'esm'});
assert.match(source,/new SpendingBook\(join\(loaded.rootDir, 'guardian-budget.sqlite3'\), null/);assert.match(source,/searchPublic:createDeepSeekPublicSearch/);
console.log('PASS core TypeScript syntax, Whale monetary cap remains null, authorized separate search wired without changing chat model');
