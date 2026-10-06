const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports, require: name => mocks[name] ?? require(name), console: { error() {}, warn() {} }, Date, Map, Set, Error, Promise, setTimeout, clearTimeout, setInterval: () => ({}), clearInterval() {} });
  return exports;
}
const payment = { id: 'a'.repeat(24), userId: 'u', telegramUserId: '123', telegramUsername: '<unsafe>&', tier: 'bor', durationMonths: 1, amount: 50000, method: 'manual_card', status: 'pending', createdAt: '2026-10-04T00:00:00Z' };
function harness(overrides = {}) {
  const calls = [], replies = [], edits = [];
  const api = { getReviewQueue: async page => { calls.push(['queue', page]); return { items: [payment], total: 26, page, totalPages: 6 }; }, getPayment: async () => payment, approvePayment: async () => payment, rejectPayment: async () => ({ payment, wasDowngraded: false }), getSubscriptionStatus: async () => ({ subscriptionEndDate: '2026-11-04' }), ...overrides };
  class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
  const texts = load('src/bot/texts.ts', { '../config/env': { env: {} } });
  const keyboards = require('telegraf').Markup;
  const handlers = load('src/bot/handlers/admin.ts', {
    '../texts': texts, '../keyboards': { keyboards: { backToMenu: {}, adminPaymentActions: id => keyboards.inlineKeyboard([[keyboards.button.callback('approve', `admin_approve_${id}`), keyboards.button.callback('reject', `admin_reject_${id}`)]]) } },
    '../../services/api-client': { api, ApiError }, './menu': { isAdmin: id => id === 1 },
    '../respond': { ackIfCallback: async ctx => { if (ctx.callbackQuery) await ctx.answerCbQuery(); }, respond: async (_ctx, text, options) => replies.push({ text, options }) },
  });
  const ctx = { from: { id: 1, username: '<admin>' }, callbackQuery: { message: { text: 'Payment details <original>' } }, answerCbQuery: async text => calls.push(['ack', text]), reply: async (text, options) => replies.push({ text, options }), replyWithPhoto: async (id, options) => replies.push({ id, options }), editMessageText: async (text, options) => edits.push({ text, options }), editMessageCaption: async (text, options) => edits.push({ text, options }), telegram: { sendMessage: async () => calls.push(['notify']) } };
  return { handlers, api, ctx, calls, replies, edits, ApiError };
}
test('bot queue is paginated and actionable, escapes user input and acknowledges before loading', async () => {
  const h = harness(); await h.handlers.handleMenuAdmin(h.ctx, 2);
  assert.equal(h.calls[0][0], 'ack'); assert.deepEqual(h.calls[1], ['queue', 2]);
  assert.match(h.replies[0].text, /Sahifa 2 \/ 6/); assert.ok(h.replies[0].text.includes('&lt;unsafe&gt;&amp;'));
  const actions = h.replies[0].options.reply_markup.inline_keyboard.flat().map(button => button.callback_data);
  for (const action of ['admin_view_' + payment.id, 'admin_page_1', 'admin_page_3', 'admin_page_2']) assert.ok(actions.includes(action));
});
test('non-admin cannot load a queue, inspect a receipt, approve or reject a payment', async () => {
  const h = harness({ getPayment: async () => { throw Error('must not read'); }, approvePayment: async () => { throw Error('must not write'); } });
  h.ctx.from.id = 2;
  await h.handlers.handleMenuAdmin(h.ctx); await h.handlers.handleAdminView(h.ctx, payment.id); await h.handlers.handleAdminApprove(h.ctx, payment.id); await h.handlers.handleAdminReject(h.ctx, payment.id);
  assert.equal(h.calls.some(call => call[0] === 'queue'), false); assert.equal(h.edits.length, 0);
});
test('review opens the submitted photo and details; unavailable photos still expose a usable review card', async () => {
  const p = { ...payment, receiptFileId: 'photo-id', senderCardDetails: { fullName: '<name>', cardNumber: '8600123456789012' } };
  const h = harness({ getPayment: async () => p }); await h.handlers.handleAdminView(h.ctx, p.id);
  assert.equal(h.replies[0].id, 'photo-id'); assert.ok(h.replies[0].options.caption.includes('•••• 9012')); assert.equal(h.replies[0].options.caption.includes('86001234'), false);
  h.ctx.replyWithPhoto = async () => { throw Error('expired photo'); }; await h.handlers.handleAdminView(h.ctx, p.id);
  assert.ok(h.replies[1].text.includes('&lt;name&gt;')); assert.ok(h.replies[1].options.reply_markup.inline_keyboard[0][0].callback_data.startsWith('admin_approve_'));
});
test('legacy reconciliations and settled payments never show an approval action', async () => {
  for (const status of ['provisioned', 'completed', 'rejected']) {
    const h = harness({ getPayment: async () => ({ ...payment, status, needsReconciliation: status === 'rejected' }) }); await h.handlers.handleAdminView(h.ctx, payment.id);
    const buttons = h.replies[0].options.reply_markup.inline_keyboard.flat();
    assert.equal(buttons.some(b => b.callback_data.startsWith('admin_approve_')), false);
  }
});
test('rapid approve/reject taps share one mutation lock; text cards show escaped outcomes and return to the queue', async () => {
  let resolve, writes = 0;
  const h = harness({ approvePayment: () => { writes++; return new Promise(done => resolve = done); }, rejectPayment: async () => { writes++; return { payment }; } });
  const first = h.handlers.handleAdminApprove(h.ctx, payment.id);
  await h.handlers.handleAdminReject(h.ctx, payment.id);
  assert.equal(writes, 1); resolve(payment); await first;
  assert.equal(h.edits.length, 1); assert.ok(h.edits[0].text.includes('&lt;admin&gt;')); assert.equal(h.edits[0].text.includes('&amp;lt;admin'), false);
  assert.equal(h.edits[0].options.reply_markup.inline_keyboard[0][0].callback_data, 'menu_admin');
});
test('a blocked user notification does not turn a successful approval into an error or hold the lock', async () => {
  const h = harness(); h.ctx.telegram.sendMessage = async () => { throw Error('blocked'); };
  await h.handlers.handleAdminApprove(h.ctx, payment.id);
  assert.equal(h.edits.length, 1); assert.equal(h.calls.some(c => c[1] === 'Xatolik'), false);
  await h.handlers.handleAdminReject(h.ctx, payment.id); assert.equal(h.edits.length, 2);
});
test('refreshing identical Telegram text avoids duplicating messages', async () => {
  const { respond } = load('src/bot/respond.ts'); let replies = 0;
  await respond({ callbackQuery: {}, editMessageText: async () => { throw { description: 'Bad Request: message is not modified' }; }, reply: async () => replies++ }, 'same');
  assert.equal(replies, 0);
});
test('pricing requests collapse concurrent taps, cache successes, and retry failures', async () => {
  let calls = 0, reject = true;
  const http = { interceptors: { request: { use() {} }, response: { use() {} } }, get: async () => { calls++; if (reject) throw Error('offline'); return { data: { success: true, data: { pricing: { bor: { 1: 100 } } } } }; } };
  const { api } = load('src/services/api-client.ts', { axios: { create: () => http }, '../config/env': { env: { BACKEND_URL: 'https://primary.test', BACKEND_BACKUP_URL: 'https://backup.test' } } });
  await Promise.allSettled([api.getPricing(), api.getPricing()]); assert.equal(calls, 1);
  reject = false; const [a, b] = await Promise.all([api.getPricing(), api.getPricing()]); assert.equal(calls, 2); assert.equal(a, b);
  await api.getPricing(); assert.equal(calls, 2);
});
