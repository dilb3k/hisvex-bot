const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Telegraf } = require('telegraf');

function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name) => mocks[name] ?? require(name),
    ...globals,
  }, { filename: file });
  return exports;
}

async function startHarness(t, options = {}) {
  const env = {
    BOT_TOKEN: 'local-test-bot-token',
    BOT_INTERNAL_SECRET: 'local-test-internal-secret',
    BACKEND_URL: 'https://unavailable-backend.test',
    WEBHOOK_URL: 'https://bot.test',
    WEBHOOK_PATH: options.path,
    PORT: 0,
  };
  const bot = new Telegraf(env.BOT_TOKEN);
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' };
  const updates = [];
  const registrations = [];
  const signals = new Map();
  let externalCalls = 0;
  bot.use((ctx) => { updates.push(ctx.update); });
  bot.telegram.setWebhook = async (url, config) => {
    registrations.push({ url, config });
    return true;
  };
  bot.telegram.callApi = async () => {
    externalCalls++;
    throw new Error('External service unavailable');
  };

  // Exercise the same launch() server and fallback as production. Telegram
  // registration and the reminder scheduler are the only startup substitutes.
  const launch = bot.launch.bind(bot);
  bot.launch = (config) => launch({
    ...config,
    webhook: {
      ...config.webhook,
      host: '127.0.0.1',
      ...(options.secretToken ? { secretToken: options.secretToken } : {}),
    },
  });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  load('src/index.ts', {
    './config/env': { env },
    './bot/bot': { createBot: () => bot },
    './cron/reminders': { startReminderCron: () => {} },
    './http/webhook-fallback': load('src/http/webhook-fallback.ts', {}),
  }, {
    console: { log() {}, error() {} },
    process: {
      on() {},
      once(signal, handler) {
        signals.set(signal, handler);
        if (signal === 'SIGTERM') readyResolve();
      },
      exit(code) { readyReject(new Error(`Bot startup exited with ${code}`)); },
    },
  });
  const server = bot.webhookServer;
  server.once('error', readyReject);
  t.after(async () => {
    if (!server.listening) return;
    const closed = once(server, 'close');
    if (signals.has('SIGTERM')) signals.get('SIGTERM')();
    else bot.stop('test cleanup');
    server.closeAllConnections();
    await closed;
  });
  await ready;
  if (!server.listening) await once(server, 'listening');

  function request(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, method, path: url,
        headers, agent: false,
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(3000, () => req.destroy(new Error('HTTP request timed out')));
      req.end(body);
    });
  }
  const webhookPath = options.path ??
    `/tg/${createHash('sha256').update(env.BOT_TOKEN).digest('hex').slice(0, 32)}`;
  return { request, webhookPath, registrations, updates, externalCalls: () => externalCalls };
}

test('/health accepts every method, including bodyless HEAD, without external services', { timeout: 10000 }, async (t) => {
  const h = await startHarness(t);
  for (const url of ['/health', '/health?monitor=uptimerobot']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await h.request(method, url);
      assert.equal(res.status, 200, `${method} ${url}`);
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(res.headers['cache-control'], 'no-store');
      if (method === 'HEAD') assert.equal(res.body, '');
      else assert.deepEqual(JSON.parse(res.body), { status: 'ok', service: 'hisvex-bot' });
    }
  }
  assert.equal(h.updates.length, 0, 'health must not invoke bot middleware');
  assert.equal(h.externalCalls(), 0, 'health must not call an external service');
});

test('health only exposes the exact path; other requests retain HTTP 403', { timeout: 10000 }, async (t) => {
  const h = await startHarness(t);
  for (const [method, url] of [
    ['GET', '/'], ['GET', '/unknown'], ['GET', '/health/'],
    ['GET', '/health/extra'], ['GET', '/%68ealth'], ['GET', '/HEALTH'],
    ['GET', h.webhookPath], ['POST', '/tg/wrong-path'],
    ['POST', `${h.webhookPath}?monitor=uptimerobot`],
  ]) {
    const res = await h.request(method, url, method === 'POST' ? '{"update_id":1}' : undefined);
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body, '');
  }
  assert.equal(h.updates.length, 0);
});

test('derived and configured webhook paths keep registration, update delivery and JSON validation', { timeout: 10000 }, async (t) => {
  for (const webhookPath of [undefined, '/tg/custom-private-path']) {
    await t.test(webhookPath ? 'configured path' : 'token-derived path', async (t) => {
      const h = await startHarness(t, { path: webhookPath });
      assert.equal(h.registrations.length, 1);
      assert.equal(h.registrations[0].url, `https://bot.test${h.webhookPath}`);
      const update = { update_id: 42 };
      assert.equal((await h.request('POST', h.webhookPath, JSON.stringify(update))).status, 200);
      assert.deepEqual(h.updates, [update]);
      assert.equal((await h.request('POST', h.webhookPath, 'invalid JSON')).status, 415);
      assert.equal(h.updates.length, 1);
      assert.equal((await h.request('GET', '/health')).status, 200);
    });
  }
});

test('the fallback also preserves Telegraf secret-token validation when configured', { timeout: 10000 }, async (t) => {
  const secretToken = 'local-webhook-test-secret';
  const h = await startHarness(t, { secretToken });
  const body = JSON.stringify({ update_id: 43 });
  for (const headers of [{}, { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-token' }]) {
    assert.equal((await h.request('POST', h.webhookPath, body, headers)).status, 403);
  }
  assert.equal(h.updates.length, 0);
  assert.equal((await h.request('GET', '/health')).status, 200);
  assert.equal((await h.request('POST', h.webhookPath, body, {
    'X-Telegram-Bot-Api-Secret-Token': secretToken,
  })).status, 200);
  assert.equal(h.updates.length, 1);
  assert.equal(h.registrations[0].config.secret_token, secretToken);
});
