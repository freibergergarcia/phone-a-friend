import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// These assertions intentionally judge the fixture's answer, not just whether
// a provider returned text. A valid refusal is still a failed acceptance case.
export function assertProbeOutput(name, output, { backend, repo } = {}) {
  const text = output.trim();
  if (['oneshot', 'stream', 'fast', 'job-result'].includes(name)) {
    assert.equal(text, 'PONG', 'expected exactly PONG');
  } else if (name === 'sess1') {
    assert.equal(text, 'OK', 'session start did not acknowledge the instruction');
  } else if (name === 'sess2') {
    assert.equal(text, 'MARMALADE', 'session did not recall the previous turn');
  } else if (name === 'schema') {
    assert.deepEqual(JSON.parse(text), { ok: true, word: 'PONG' });
  } else if (name === 'review') {
    assert.match(text, /math\.js|\badd\b/i, 'review must identify the changed file or function');
    assert.match(text, /subtract|subtraction|a\s*-\s*b|minus/i,
      'review must identify the introduced subtraction bug');
  } else if (name === 'verdict') {
    const value = JSON.parse(text);
    assert.deepEqual(Object.keys(value).sort(), ['findings', 'schema_version', 'summary', 'verdict']);
    assert.equal(value.schema_version, 1);
    assert.equal(value.verdict, 'iterate', 'the fixture has a correctness bug');
    assert.equal(typeof value.summary, 'string');
    assert.ok(Array.isArray(value.findings) && value.findings.length > 0);
    for (const finding of value.findings) {
      assert.deepEqual(Object.keys(finding).sort(), ['location', 'rationale', 'severity', 'title']);
      assert.ok(['blocker', 'important', 'nit'].includes(finding.severity));
      assert.equal(typeof finding.title, 'string');
      assert.equal(typeof finding.rationale, 'string');
      assert.ok(finding.location === null || typeof finding.location === 'string');
    }
    assert.ok(value.findings.some(f => ['blocker', 'important'].includes(f.severity)
      && /math\.js|\badd\b/i.test(`${f.location} ${f.title} ${f.rationale}`)
      && /subtract|subtraction|a\s*-\s*b|minus/i.test(`${value.summary} ${f.title} ${f.rationale}`)),
    'verdict must flag the introduced subtraction bug');
  } else if (name === 'quiet') {
    assert.match(text, /Job started [a-z0-9-]+/);
  } else if (name === 'session-list') {
    const rows = JSON.parse(text);
    assert.ok(Array.isArray(rows));
    const session = rows.find(row => row.id === 'probe');
    assert.ok(session, 'probe session missing');
    assert.equal(session.backend, backend);
    assert.equal(session.repoPath, repo);
    if (backend === 'ollama' || backend === 'xai') assert.ok(session.history.length >= 4);
    else {
      assert.ok(typeof session.backendSessionId === 'string' && session.backendSessionId.length > 0);
      assert.deepEqual(session.history, []);
    }
  } else if (name === 'task-list') {
    const rows = JSON.parse(text);
    assert.ok(Array.isArray(rows) && rows.length >= 8, 'expected tracked probe calls');
    for (const row of rows) {
      assert.equal(row.backend, backend);
      assert.equal(row.repoPath, repo);
      assert.ok(['completed', 'failed', 'interrupted'].includes(row.status), 'task still running');
    }
    assert.ok(rows.some(row => row.sessionLabel === 'probe'), 'session tasks missing');
    assert.ok(rows.some(row => row.kind === 'review'), 'review tasks missing');
  } else {
    throw new Error(`Unknown probe assertion: ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, file, backend, repo] = process.argv.slice(2);
  try {
    assertProbeOutput(name, readFileSync(file, 'utf8'), { backend, repo });
  } catch (error) {
    // The raw output is retained in the evidence file; don't echo it here.
    console.error(`${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
