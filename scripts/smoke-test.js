/**
 * End-to-end smoke test. Start the API first (npm run dev), then run: npm run smoke
 * Optional: BASE_URL=https://your-app.onrender.com npm run smoke
 */
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const run = Date.now();
let passed = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, body: json };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const txn = (accountId, type, amount, ref, description) =>
  call('POST', `/accounts/${accountId}/transactions`, { type, amount, reference_id: ref, description });

(async () => {
  console.log(`Running smoke tests against ${BASE}\n`);
  let a;
  let b;

  await test('create account (balance starts at 0)', async () => {
    const r = await call('POST', '/accounts', { name: 'Alice' });
    assert.equal(r.status, 201);
    assert.equal(Number(r.body.balance), 0);
    assert.ok(r.body.id && r.body.created_at);
    a = r.body.id;
    b = (await call('POST', '/accounts', { name: 'Bob' })).body.id;
  });

  await test('account validation: missing name, empty name, client-set balance', async () => {
    assert.equal((await call('POST', '/accounts', {})).status, 400);
    assert.equal((await call('POST', '/accounts', { name: '   ' })).status, 400);
    assert.equal((await call('POST', '/accounts', { name: 'Eve', balance: 500 })).status, 400);
  });

  await test('invalid JSON body -> 400 INVALID_REQUEST_BODY', async () => {
    const res = await fetch(BASE + '/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST_BODY');
  });

  await test('credit 100, credit 50, debit 30, debit 20 -> balance 100', async () => {
    assert.equal((await txn(a, 'credit', 100, `r1-${run}`)).status, 201);
    assert.equal((await txn(a, 'credit', 50, `r2-${run}`)).status, 201);
    assert.equal((await txn(a, 'debit', 30, `r3-${run}`)).status, 201);
    const last = await txn(a, 'debit', 20, `r4-${run}`);
    assert.equal(last.status, 201);
    const bal = await call('GET', `/accounts/${a}/balance`);
    assert.equal(bal.status, 200);
    assert.equal(bal.body.account_id, a);
    assert.equal(Number(bal.body.balance), 100);
  });

  await test('duplicate reference_id: 200, no new row, balance unchanged', async () => {
    const r = await txn(a, 'credit', 999, `r1-${run}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.duplicate, true);
    assert.equal(Number(r.body.balance), 100);
    const bal = await call('GET', `/accounts/${a}/balance`);
    assert.equal(Number(bal.body.balance), 100);
  });

  await test('same reference_id is allowed on a different account', async () => {
    const r = await txn(b, 'credit', 50, `r1-${run}`);
    assert.equal(r.status, 201);
  });

  await test('overdraft rejected (422) and balance unchanged', async () => {
    const r = await txn(a, 'debit', 150, `over-${run}`);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(Number((await call('GET', `/accounts/${a}/balance`)).body.balance), 100);
  });

  await test('validation errors: type, amount, reference_id', async () => {
    const t = await txn(a, 'refund', 10, `x-${run}`);
    assert.equal(t.status, 400);
    assert.equal(t.body.error.code, 'INVALID_TRANSACTION_TYPE');
    for (const bad of [0, -5, 'abc', 10.123, null]) {
      const r = await txn(a, 'credit', bad, `x-${run}`);
      assert.equal(r.status, 400, `amount ${bad} should be 400`);
      assert.equal(r.body.error.code, 'INVALID_AMOUNT');
    }
    const noRef = await call('POST', `/accounts/${a}/transactions`, { type: 'credit', amount: 5 });
    assert.equal(noRef.status, 400);
    assert.equal(Number((await call('GET', `/accounts/${a}/balance`)).body.balance), 100);
  });

  await test('unknown / invalid account ids', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    assert.equal((await call('GET', `/accounts/${missing}/balance`)).status, 404);
    assert.equal((await txn(missing, 'credit', 5, `m-${run}`)).status, 404);
    assert.equal((await call('GET', `/accounts/${missing}/transactions`)).status, 404);
    const bad = await call('GET', '/accounts/not-a-uuid/balance');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_ACCOUNT_ID');
  });

  await test('history: latest first, filter, pagination metadata', async () => {
    const all = await call('GET', `/accounts/${a}/transactions?page=1&limit=3`);
    assert.equal(all.status, 200);
    assert.equal(all.body.pagination.total_records, 4);
    assert.equal(all.body.pagination.total_pages, 2);
    assert.equal(all.body.pagination.page, 1);
    assert.equal(all.body.pagination.limit, 3);
    assert.equal(all.body.data.length, 3);
    assert.equal(all.body.data[0].reference_id, `r4-${run}`); // newest first
    const times = all.body.data.map((t) => new Date(t.created_at).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => y - x));

    const page2 = await call('GET', `/accounts/${a}/transactions?page=2&limit=3`);
    assert.equal(page2.body.data.length, 1);

    const debits = await call('GET', `/accounts/${a}/transactions?type=debit`);
    assert.equal(debits.body.pagination.total_records, 2);
    assert.ok(debits.body.data.every((t) => t.type === 'debit'));
  });

  await test('invalid pagination / type filter -> 400', async () => {
    for (const q of ['page=0', 'page=abc', 'limit=0', 'limit=101', 'limit=-1', 'type=refund']) {
      const r = await call('GET', `/accounts/${a}/transactions?${q}`);
      assert.equal(r.status, 400, q);
    }
  });

  await test('transactions are immutable via the API (no PUT/PATCH/DELETE)', async () => {
    const list = await call('GET', `/accounts/${a}/transactions`);
    const id = list.body.data[0].id;
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await call(method, `/accounts/${a}/transactions/${id}`, {});
      assert.ok([404, 405].includes(r.status), `${method} should not succeed`);
    }
  });

  await test('concurrency: 6 parallel debits of 30 on balance 100 -> exactly 3 succeed', async () => {
    const acc = (await call('POST', '/accounts', { name: 'Concurrent' })).body.id;
    await txn(acc, 'credit', 100, `seed-${run}`);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => txn(acc, 'debit', 30, `par-${run}-${i}`))
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    assert.equal(ok, 3);
    assert.equal(rejected, 3);
    assert.equal(Number((await call('GET', `/accounts/${acc}/balance`)).body.balance), 10);
  });

  await test('concurrency: same reference_id sent 5x in parallel -> one transaction', async () => {
    const acc = (await call('POST', '/accounts', { name: 'Dup' })).body.id;
    const results = await Promise.all(Array.from({ length: 5 }, () => txn(acc, 'credit', 40, `same-${run}`)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200).length, 4);
    assert.equal(Number((await call('GET', `/accounts/${acc}/balance`)).body.balance), 40);
  });

  await test('transfer: 30 from A to B', async () => {
    const x = (await call('POST', '/accounts', { name: 'X' })).body.id;
    const y = (await call('POST', '/accounts', { name: 'Y' })).body.id;
    await txn(x, 'credit', 100, `sx-${run}`);
    await txn(y, 'credit', 50, `sy-${run}`);
    const r = await call('POST', '/transfers', {
      from_account_id: x,
      to_account_id: y,
      amount: 30,
      reference_id: `t1-${run}`,
    });
    assert.equal(r.status, 201);
    assert.equal(Number((await call('GET', `/accounts/${x}/balance`)).body.balance), 70);
    assert.equal(Number((await call('GET', `/accounts/${y}/balance`)).body.balance), 80);

    // duplicate transfer is a no-op
    const dup = await call('POST', '/transfers', {
      from_account_id: x,
      to_account_id: y,
      amount: 30,
      reference_id: `t1-${run}`,
    });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    assert.equal(Number((await call('GET', `/accounts/${x}/balance`)).body.balance), 70);

    // insufficient funds: nothing changes on either side
    const bad = await call('POST', '/transfers', {
      from_account_id: x,
      to_account_id: y,
      amount: 500,
      reference_id: `t2-${run}`,
    });
    assert.equal(bad.status, 422);
    assert.equal(Number((await call('GET', `/accounts/${x}/balance`)).body.balance), 70);
    assert.equal(Number((await call('GET', `/accounts/${y}/balance`)).body.balance), 80);

    // missing destination: nothing changes
    const missing = await call('POST', '/transfers', {
      from_account_id: x,
      to_account_id: '00000000-0000-4000-8000-000000000000',
      amount: 5,
      reference_id: `t3-${run}`,
    });
    assert.equal(missing.status, 404);
    assert.equal(Number((await call('GET', `/accounts/${x}/balance`)).body.balance), 70);

    // same account
    const same = await call('POST', '/transfers', {
      from_account_id: x,
      to_account_id: x,
      amount: 5,
      reference_id: `t4-${run}`,
    });
    assert.equal(same.status, 400);
  });

  await test('opposite concurrent transfers do not deadlock', async () => {
    const x = (await call('POST', '/accounts', { name: 'P' })).body.id;
    const y = (await call('POST', '/accounts', { name: 'Q' })).body.id;
    await txn(x, 'credit', 100, `dx-${run}`);
    await txn(y, 'credit', 100, `dy-${run}`);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call('POST', '/transfers', {
          from_account_id: i % 2 ? x : y,
          to_account_id: i % 2 ? y : x,
          amount: 10,
          reference_id: `dl-${run}-${i}`,
        })
      )
    );
    assert.ok(results.every((r) => r.status === 201), 'all transfers should succeed');
    assert.equal(Number((await call('GET', `/accounts/${x}/balance`)).body.balance), 100);
    assert.equal(Number((await call('GET', `/accounts/${y}/balance`)).body.balance), 100);
  });

  console.log(`\n${passed} test group(s) passed${process.exitCode ? ', some FAILED' : ''}`);
})();
