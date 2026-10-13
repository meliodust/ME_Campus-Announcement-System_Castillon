import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';

const port = String(30_000 + Math.floor(Math.random() * 20_000));
const serverProcess = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const serverReady = new Promise((resolve, reject) => {
  serverProcess.once('error', reject);
  serverProcess.once('exit', (code) => reject(new Error(`Server exited before startup (${code}).`)));
  serverProcess.stdout.once('data', resolve);
});

await serverReady;
const endpoint = `http://127.0.0.1:${port}/api/announcements`;
after(async () => {
  serverProcess.kill();
  await once(serverProcess, 'exit');
});

test('announcements can be created, listed, retrieved, validated, and deleted', async () => {
  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /id-search-form/);

  const today = new Date().toISOString().slice(0, 10);
  const createResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Integration test',
      message: 'Test announcement',
      date_posted: today,
      expiry_date: today,
      category: 'Test',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.status, 'ACTIVE');
  assert.equal(typeof created.id, 'number');
  assert.ok(Number.isSafeInteger(created.id) && created.id > 0);
  const persisted = JSON.parse(await readFile('data.json', 'utf8'));
  assert.ok(persisted.every((item) => Number.isSafeInteger(item.id) && item.id > 0));
  assert.ok(persisted.some((item) => item.id === created.id));

  const listResponse = await fetch(endpoint);
  assert.equal(listResponse.status, 200);
  assert.ok((await listResponse.json()).some((item) => item.id === created.id));

  const getResponse = await fetch(`${endpoint}/${created.id}`);
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).id, created.id);

  const invalidResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Invalid dates',
      message: 'Expiry precedes posting',
      date_posted: '2026-10-14',
      expiry_date: '2026-10-13',
      category: 'Test',
    }),
  });
  assert.equal(invalidResponse.status, 400);

  const deleteResponse = await fetch(`${endpoint}/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
  assert.ok(!(JSON.parse(await readFile('data.json', 'utf8'))).some((item) => item.id === created.id));
  assert.equal((await fetch(`${endpoint}/${created.id}`)).status, 404);

  const nextCreateResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Monotonic ID test',
      message: 'The deleted ID must not be reused.',
      date_posted: today,
      expiry_date: today,
      category: 'Test',
    }),
  });
  assert.equal(nextCreateResponse.status, 201);
  const nextCreated = await nextCreateResponse.json();
  assert.equal(nextCreated.id, created.id + 1);
  assert.equal((await fetch(`${endpoint}/${nextCreated.id}`, { method: 'DELETE' })).status, 204);
});

test('expiry status is active through the expiry date and expired afterward', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const createdIds = [];

  async function createForExpiry(title, date) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        message: 'Temporary status boundary test.',
        date_posted: date,
        expiry_date: date,
        category: 'Test',
      }),
    });
    assert.equal(response.status, 201);
    const record = await response.json();
    createdIds.push(record.id);
    return record;
  }

  try {
    const activeOnExpiry = await createForExpiry('Active on expiry date', today);
    const expiredAfterExpiry = await createForExpiry('Expired after expiry date', yesterday);

    assert.equal(activeOnExpiry.status, 'ACTIVE');
    assert.equal(expiredAfterExpiry.status, 'EXPIRED');

    const listResponse = await fetch(endpoint);
    assert.equal(listResponse.status, 200);
    const allRecords = await listResponse.json();
    for (const id of createdIds) {
      assert.ok(allRecords.some((record) => record.id === id), `GET all should include ID ${id}`);
    }
    assert.equal((await (await fetch(`${endpoint}/${activeOnExpiry.id}`)).json()).status, 'ACTIVE');
    assert.equal((await (await fetch(`${endpoint}/${expiredAfterExpiry.id}`)).json()).status, 'EXPIRED');
  } finally {
    await Promise.all(createdIds.map((id) => fetch(`${endpoint}/${id}`, { method: 'DELETE' })));
  }
});

test('API returns useful errors for invalid requests', async (t) => {
  const validAnnouncement = {
    title: 'Error handling test',
    message: 'Test payload',
    date_posted: '2026-10-13',
    expiry_date: '2026-10-14',
    category: 'Testing',
  };

  async function postJson(body) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function assertJsonError(response, expectedStatus, expectedText) {
    assert.equal(response.status, expectedStatus);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    if (expectedText) assert.match(body.error, expectedText);
  }

  await t.test('1. rejects missing required fields', async () => {
    await assertJsonError(await postJson({}), 400, /title/);
  });

  await t.test('2. rejects blank required values', async () => {
    await assertJsonError(await postJson({ ...validAnnouncement, title: '   ' }), 400, /title/);
  });

  await t.test('3. rejects dates in the wrong format', async () => {
    await assertJsonError(await postJson({ ...validAnnouncement, date_posted: '10/13/2026' }), 400, /YYYY-MM-DD/);
  });

  await t.test('4. rejects impossible calendar dates', async () => {
    await assertJsonError(await postJson({ ...validAnnouncement, expiry_date: '2026-02-30' }), 400, /valid date/);
  });

  await t.test('5. rejects expiry earlier than posting date', async () => {
    await assertJsonError(await postJson({
      ...validAnnouncement,
      date_posted: '2026-10-14',
      expiry_date: '2026-10-13',
    }), 400, /cannot be earlier/);
  });

  await t.test('6. rejects malformed JSON', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    });
    await assertJsonError(response, 400, /valid JSON/);
  });

  await t.test('7. rejects a JSON array instead of an object', async () => {
    await assertJsonError(await postJson([]), 400, /JSON object/);
  });

  await t.test('8. rejects request bodies over the configured size limit', async () => {
    const oversized = { ...validAnnouncement, message: 'x'.repeat(1_050_000) };
    await assertJsonError(await postJson(oversized), 413, /too large/);
  });

  await t.test('9. returns 404 when retrieving an unknown ID', async () => {
    await assertJsonError(await fetch(`${endpoint}/missing-announcement-id`), 404, /not found/i);
  });

  await t.test('10. returns 404 when deleting an unknown ID', async () => {
    await assertJsonError(await fetch(`${endpoint}/missing-announcement-id`, { method: 'DELETE' }), 404, /not found/i);
  });

  await t.test('11. rejects unsupported update methods', async () => {
    await assertJsonError(await fetch(endpoint, { method: 'PATCH' }), 404, /route not found/i);
  });

  await t.test('12. returns JSON 404 for an unknown API route', async () => {
    await assertJsonError(await fetch(`${endpoint}/extra/path`), 404, /route not found/i);
  });
});
