import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { chatAutoReply, chatIsOpen, chatSettings, requireChatEnabled, validateChatSettings } from "../app/modules/live/chat-rules.ts";

test("unconfigured legacy chat works while explicit disabling is enforced", () => {
  assert.equal(chatSettings({}).enabled, true);
  assert.equal(requireChatEnabled(undefined).enabled, true);
  assert.throws(() => requireChatEnabled({ enabled: false }), /중지/u);
  assert.throws(() => validateChatSettings({ enabled: "false" }), /설정/u);
});

test("hours are evaluated in Korea with Monday-first mask and exclusive closing", () => {
  const settings = chatSettings({});
  assert.equal(chatIsOpen(settings, new Date("2026-11-15T23:59:00Z")), false);
  assert.equal(chatIsOpen(settings, new Date("2026-11-16T00:00:00Z")), true);
  assert.equal(chatIsOpen(settings, new Date("2026-11-16T08:59:00Z")), true);
  assert.equal(chatIsOpen(settings, new Date("2026-11-16T09:00:00Z")), false);
  assert.equal(chatIsOpen(settings, new Date("2026-11-21T01:00:00Z")), false);
});

test("overnight and 24-hour source schedules retain weekday gating", () => {
  const overnight = chatSettings({ bizHours: { from: "22:00", to: "05:00", days: "YYYYYYY" } });
  assert.equal(chatIsOpen(overnight, new Date("2026-11-16T14:00:00Z")), true);
  assert.equal(chatIsOpen(overnight, new Date("2026-11-16T19:00:00Z")), true);
  assert.equal(chatIsOpen(overnight, new Date("2026-11-16T20:00:00Z")), false);
  const allDay = chatSettings({ bizHours: { from: "00:00", to: "00:00", days: "YYYYYNN" } });
  assert.equal(chatIsOpen(allDay, new Date("2026-11-16T11:00:00Z")), true);
  assert.equal(chatIsOpen(allDay, new Date("2026-11-21T11:00:00Z")), false);
});

test("automatic replies need enabled chat, configured text and off hours", () => {
  const settings = validateChatSettings({ autoReplyOffHours: true, autoReplyText: "영업시간에 답변드릴게요." });
  assert.equal(chatAutoReply(settings, new Date("2026-11-16T01:00:00Z")), "");
  assert.equal(chatAutoReply(settings, new Date("2026-11-16T12:00:00Z")), settings.autoReplyText);
  assert.equal(chatAutoReply({ ...settings, enabled: false }, new Date("2026-11-16T12:00:00Z")), "");
  assert.equal(chatAutoReply({ ...settings, autoReplyOffHours: false }, new Date("2026-11-16T12:00:00Z")), "");
  assert.throws(() => validateChatSettings({ autoReplyOffHours: true }), /내용/u);
});

test("settings reject malformed masks and invalid wall-clock values", () => {
  for (const hours of [
    { from: "24:00", to: "18:00", days: "YYYYYNN" },
    { from: "09:60", to: "18:00", days: "YYYYYNN" },
    { from: "09:00", to: "18:00", days: "1111100" },
    { from: "09:00", to: "18:00", days: "YYYY" },
  ]) assert.throws(() => validateChatSettings({ bizHours: hours }), /영업시간/u);
});

// Execute the actual application service and store against SQLite. Only the
// unrelated order-report port is stubbed; persistence SQL is not mocked.
const domainUrl = new URL("../app/modules/live/domain.ts", import.meta.url).href;
const rulesUrl = new URL("../app/modules/live/chat-rules.ts", import.meta.url).href;
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const storeSource = await readFile(new URL("../app/modules/live/store.ts", import.meta.url), "utf8");
const storeUrl = moduleUrl(storeSource.replaceAll('"./domain"', JSON.stringify(domainUrl)));
const communicationSource = await readFile(new URL("../app/modules/live/communications.ts", import.meta.url), "utf8");
const service = await import(moduleUrl(communicationSource
  .replaceAll('"./domain"', JSON.stringify(domainUrl))
  .replaceAll('"./chat-rules"', JSON.stringify(rulesUrl))
  .replaceAll('"./store"', JSON.stringify(storeUrl))
  .replaceAll('"./orders"', JSON.stringify("data:text/javascript,export const orderRows=async()=>[]"))));

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE of_shops(id TEXT PRIMARY KEY,settings TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE of_records(id INTEGER PRIMARY KEY AUTOINCREMENT,shop TEXT,kind TEXT,data TEXT,revision INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
    CREATE TABLE of_changes(shop TEXT,kind TEXT,entity TEXT,actor TEXT,created_at TEXT);
    CREATE TABLE of_guards(id TEXT PRIMARY KEY,ok INTEGER CHECK(ok=1));
    CREATE TABLE of_customers(id INTEGER PRIMARY KEY,name TEXT,mobile TEXT);
    CREATE TABLE of_orders(id INTEGER PRIMARY KEY,shop TEXT,key TEXT,customer_id INTEGER);
    INSERT INTO of_shops(id) VALUES('one'),('two');`);
  // Keep SQL and its values inside each port instance for D1 batch semantics.
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => prepare(sql, next),
    first: async () => sqlite.prepare(sql).get(...values as never[]),
    all: async () => ({ results: sqlite.prepare(sql).all(...values as never[]) }),
    run: async () => { const r = sqlite.prepare(sql).run(...values as never[]); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    execute: () => { const r = sqlite.prepare(sql).run(...values as never[]); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec("BEGIN");
      try { const result = statements.map((s) => s.execute()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const context = { db, shop: "one", actor: "owner", role: "OWNER", permissions: {}, origin: "https://independent.test" };
  return { sqlite, context, store: () => import(storeUrl) };
}

test("chat stores real replies, read receipts, history and throttled off-hours auto replies", async () => {
  const { sqlite, context, store } = database();
  const persistence = await store();
  await persistence.setting(context, "chat", { enabled: true, autoReplyOffHours: true, autoReplyText: "다음 영업시간에 답변합니다", bizHours: { from: "09:00", to: "18:00", days: "NNNNNNN" } });
  const room = await persistence.put(context, "chat-room", { token: "a".repeat(32), status: "O", unread: 0, expiresAt: "2099-01-01T00:00:00Z" });
  const customer = { ...context, actor: "customer", role: "CUSTOMER" };
  const sent = await service.send(customer, room.id, { content: "주문 문의" }, "C");
  assert.equal(sent.message.content, "주문 문의");
  await service.send(customer, room.id, { content: "추가 문의" }, "C");
  const history = await service.messages(context, room.id);
  assert.equal(history.length, 3);
  assert.equal(history.filter((m: { sender: string }) => m.sender === "A").length, 1);
  assert.equal((await service.room(context, room.id)).unread, 2);
  await Promise.all(Array.from({ length: 20 }, (_, index) => service.send(customer, room.id, { content: `동시문의 ${index}` }, "C")));
  assert.equal((await service.messages(context, room.id)).filter((m: { sender: string }) => m.sender === "A").length, 1);
  assert.equal((await service.room(context, room.id)).unread, 22);
  await service.markChatRead(context, room.id);
  assert.equal((await service.room(context, room.id)).unread, 0);
  assert.ok((await service.messages(context, room.id))[0].readAt);
  const reply = await service.send(context, room.id, { content: "확인했습니다" });
  assert.equal((await service.room(context, room.id)).customerUnread, 1);
  await service.messages(customer, room.id);
  assert.ok((await service.messages(context, room.id)).find((m: { id: number }) => m.id === reply.message.id).readAt);
  assert.equal((await service.messages(context, room.id, { beforeMsgId: reply.message.id })).length, 23);
  const readsBefore = sqlite.prepare("SELECT COUNT(*) AS count FROM of_changes").get()?.count;
  await service.messages(customer, room.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM of_changes").get()?.count, readsBefore);
  await assert.rejects(service.room({ ...context, shop: "two" }, room.id), /찾을 수/u);
  await persistence.setting(context, "chat", { enabled: false });
  await assert.rejects(service.send(customer, room.id, { content: "차단" }, "C"), /중지/u);
  await assert.rejects(service.publicChatContext(context.db, "a".repeat(32), context.origin), /중지/u);
  sqlite.close();
});

test("saved greeting appears once and disabled chat never creates a new room", async () => {
  const { sqlite, context, store } = database();
  const persistence = await store();
  sqlite.exec("INSERT INTO of_customers VALUES(1,'테스트 고객','01000000000'); INSERT INTO of_orders VALUES(1,'one','local-order',1)");
  await persistence.setting(context, "chat", { enabled: false, greeting: "안녕하세요" });
  await assert.rejects(service.openCustomerRoom(context, "local-order"), /중지/u);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM of_records").get()?.count, 0);
  await persistence.setting(context, "chat", { enabled: true, greeting: "안녕하세요" });
  const opened = await service.openCustomerRoom(context, "local-order");
  const reopened = await service.openCustomerRoom(context, "local-order");
  assert.equal(opened.id, reopened.id);
  const history = await service.messages(context, opened.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].type, "greeting");
  assert.equal(history[0].content, "안녕하세요");
  sqlite.close();
});

test("internal inquiries preserve first message, scoped admin replies, unread and closed state", async () => {
  const { sqlite, context } = database();
  const api = (path: string, data = {}, c = context) => service.communicationsApi(c, path, "POST", data);
  const opened = await api("/inquiry/create", { title: "문의", content: "첫 내용", category: "이용문의" });
  const id = opened.inquiry_id;
  assert.equal((await api("/inquiry/messages", { inquiry_id: id })).length, 1);
  assert.equal((await api("/inquiry/admin/list"))[0].unread_count, 1);
  await assert.rejects(api("/inquiry/admin/send", { inquiry_id: id, content: "위조" }, { ...context, role: "STAFF" }), /관리자/u);
  await assert.rejects(api("/inquiry/send", { inquiry_id: id, content: "다른상점" }, { ...context, shop: "two" }), /찾을 수/u);
  await api("/inquiry/admin/messages", { inquiry_id: id });
  assert.equal((await api("/inquiry/admin/list"))[0].unread_count, 0);
  await api("/inquiry/admin/send", { inquiry_id: id, content: "관리자 답변" });
  assert.equal((await api("/inquiry/unread-count")).unread_count, 1);
  assert.equal((await api("/inquiry/list"))[0].status, "answered");
  const messages = await api("/inquiry/messages", { inquiry_id: id });
  assert.equal(messages[1].author_type, "admin");
  assert.equal(messages[1].content, "관리자 답변");
  assert.equal((await api("/inquiry/unread-count")).unread_count, 0);
  await api("/inquiry/escalate", { inquiry_id: id });
  await api("/inquiry/close", { inquiry_id: id });
  await assert.rejects(api("/inquiry/send", { inquiry_id: id, content: "종료후" }), /종료/u);
  sqlite.close();
});
