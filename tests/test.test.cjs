const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('sending a result locks the page behind the umbrella when the Worker refuses the account', async () => {
  const refused = [];
  const profiles = { current: { name: 'Student' },
    refuse: code => /^(?:app|books)_(?:forbidden|not_configured)$|^unauthorized$/.test(code) && refused.push(code) > 0 };
  const context = vm.createContext({ window: { Profiles: profiles }, Profiles: profiles, WORKER_URL: '/report',
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'app_forbidden', message: 'Refused', userId: 555123 }) }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), context);
  const status = { className: '', textContent: '' }, retry = { style: {} };
  assert.equal(await context.sendReport('Test', 'Result', status, retry), false);
  assert.deepEqual(refused, ['app_forbidden']);
  assert.doesNotMatch(status.textContent, /555123|Refused|Couldn't send/);
  assert.equal(retry.style.display, 'none');
  const plain = vm.createContext({ window: { Profiles: profiles }, Profiles: profiles, WORKER_URL: '/report',
    fetch: async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), plain);
  assert.equal(await plain.sendReport('Test', 'Result', status, retry), false);
  assert.match(status.textContent, /Couldn't send/);
  assert.equal(retry.style.display, 'block');
  assert.deepEqual(refused, ['app_forbidden']);
});
