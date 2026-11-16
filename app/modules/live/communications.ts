import {
  integer,
  LiveError,
  mobileOf,
  required,
  rows,
  text,
  type Doc,
} from "./domain";
import { orderRows } from "./orders";
import { chatAutoReply, chatDefaults, chatSettings, requireChatEnabled, validateChatSettings } from "./chat-rules";
import {
  audit,
  first,
  list,
  now,
  parse,
  put,
  query,
  remove,
  setting,
  transaction,
  type LiveContext,
} from "./store";
export { chatDefaults };

export async function getChatSettings(c: LiveContext) {
  return chatSettings(await setting(c, "chat"));
}

export async function markChatRead(c: LiveContext, id: number, reader = "S") {
  const current = await room(c, id);
  const pending = await first(c, "SELECT id FROM of_records WHERE shop=? AND kind=? AND deleted=0 AND json_extract(data,'$.sender')=? AND json_extract(data,'$.readAt') IS NULL LIMIT 1", c.shop, `chat-message:${id}`, reader === "C" ? "S" : "C");
  if (!pending && !Number(current[reader === "C" ? "customerUnread" : "unread"] ?? 0)) return;
  const time = now();
  await transaction(c, [
    c.db.prepare("UPDATE of_records SET data=json_set(data,'$.readAt',?),updated_at=? WHERE shop=? AND kind=? AND deleted=0 AND json_extract(data,'$.sender')=? AND json_extract(data,'$.readAt') IS NULL")
      .bind(time, time, c.shop, `chat-message:${id}`, reader === "C" ? "S" : "C"),
    c.db.prepare("UPDATE of_records SET data=json_set(data,?,0,?,?),revision=revision+1,updated_at=? WHERE shop=? AND kind='chat-room' AND id=? AND deleted=0")
      .bind(reader === "C" ? "$.customerUnread" : "$.unread", reader === "C" ? "$.customerReadAt" : "$.sellerReadAt", time, time, c.shop, id),
  ]);
  await audit(c, "chat:read", id);
}
export async function room(c: LiveContext, id: number) {
  const record = await first(
    c,
    "SELECT id,data,revision FROM of_records WHERE shop=? AND kind='chat-room' AND deleted=0 AND id=?",
    c.shop,
    id,
  );
  const r: Doc | null = record
    ? { ...parse(record.data), id: record.id, revision: record.revision }
    : null;
  if (!r) throw new LiveError("채팅방을 찾을 수 없습니다.", 404);
  return r;
}
export async function messages(c: LiveContext, id: number, data: Doc = {}) {
  await room(c, id);
  if (c.role === "CUSTOMER") await markChatRead(c, id, "C");
  const before = data.beforeMsgId == null ? Number.MAX_SAFE_INTEGER : integer(data.beforeMsgId, 1);
  const after = data.afterMsgId == null ? 0 : integer(data.afterMsgId, 0);
  const result = await query(c, "SELECT id,data,created_at FROM of_records WHERE shop=? AND kind=? AND deleted=0 AND id<? AND id>? ORDER BY id DESC LIMIT 2000", c.shop, `chat-message:${id}`, before, after);
  return result.reverse().map((m) => ({ ...parse(m.data), id: m.id, msgId: m.id, createdAt: parse(m.data).createdAt ?? m.created_at }));
}
export async function send(
  c: LiveContext,
  id: number,
  data: Doc,
  sender = "S",
) {
  const r = await room(c, id);
  const settings = sender === "C" ? requireChatEnabled(await setting(c, "chat")) : await getChatSettings(c);
  if (!["S", "C"].includes(sender)) throw new LiveError("메시지 발신자를 확인해 주세요.", 422);
  if (r.status === "C") throw new LiveError("종료된 채팅방입니다.", 409);
  const type = text(data.type) || "text";
  if (!["text", "image", "file", "order"].includes(type))
    throw new LiveError("지원하지 않는 메시지 형식입니다.", 422);
  const content =
    type === "text"
      ? required(data.content, "메시지", 5000)
      : text(data.content, 1000);
  if (type === "image" || type === "file") {
    const fileUrl = new URL(text(data.fileUrl), c.origin);
    if (
      fileUrl.origin !== c.origin ||
      !/^\/(live-image|live-file)\/[a-f\d]{32}$/u.test(fileUrl.pathname)
    )
      throw new LiveError("이 앱에서 업로드한 파일만 보낼 수 있습니다.", 422);
    const token=fileUrl.pathname.split('/').at(-1);
    if(!await first(c,"SELECT id FROM of_records WHERE shop=? AND kind=? AND deleted=0 AND json_extract(data,'$.token')=?",c.shop,fileUrl.pathname.startsWith('/live-file/')?'attachment':'image',token))throw new LiveError('이 매장에서 업로드한 첨부파일을 찾을 수 없습니다.',404);
  }
  const payload = {
    type,
    sender,
    senderName: sender === "S" ? "매장" : "고객",
    content,
    fileUrl: text(data.fileUrl, 500),
    thumbUrl: attachment(c, data.thumbUrl),
    fileName: text(data.fileName, 120),
    fileSize: integer(data.fileSize ?? 0, 0, 10_000_000),
    orderNo: integer(data.orderNo ?? 0),
    createdAt: now(),
  };
  const time = now();
  const autoReply = sender === "C" ? chatAutoReply(settings, new Date(time)) : "";
  const cutoff = new Date(new Date(time).getTime() - 5 * 60000).toISOString();
  const autoDue = "COALESCE(json_extract(data,'$.lastAutoReplyAt'),'')<?";
  const automatic = { type: "text", sender: "A", senderName: "매장 자동응답", content: autoReply, createdAt: time };
  const results = await transaction(
    c,
    [
      c.db
        .prepare(
          "INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          c.shop,
          `chat-message:${id}`,
          JSON.stringify(payload),
          time,
          time,
        ),
      ...(autoReply ? [c.db.prepare(`INSERT INTO of_records(shop,kind,data,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM of_records WHERE shop=? AND kind='chat-room' AND id=? AND deleted=0 AND ${autoDue})`)
        .bind(c.shop, `chat-message:${id}`, JSON.stringify(automatic), time, time, c.shop, id, cutoff)] : []),
      c.db
        .prepare(
          `UPDATE of_records SET data=json_set(data,'$.lastMessage',CASE WHEN ?<>'' AND ${autoDue} THEN ? ELSE ? END,'$.lastAt',?,'$.lastSender',CASE WHEN ?<>'' AND ${autoDue} THEN 'A' ELSE ? END,'$.lastAutoReplyAt',CASE WHEN ?<>'' AND ${autoDue} THEN ? ELSE json_extract(data,'$.lastAutoReplyAt') END,'$.unread',CASE WHEN ?='C' THEN COALESCE(json_extract(data,'$.unread'),0)+1 ELSE 0 END,'$.customerUnread',CASE WHEN ?='S' THEN COALESCE(json_extract(data,'$.customerUnread'),0)+1 ELSE 0 END),revision=revision+1,updated_at=? WHERE shop=? AND id=? AND kind='chat-room'`,
        )
        .bind(autoReply, cutoff, autoReply, content || type, time, autoReply, cutoff, sender, autoReply, cutoff, time, sender, sender, time, c.shop, id),
      ...(sender === "S" ? [c.db.prepare("UPDATE of_records SET data=json_set(data,'$.readAt',?),updated_at=? WHERE shop=? AND kind=? AND deleted=0 AND json_extract(data,'$.sender')='C' AND json_extract(data,'$.readAt') IS NULL")
        .bind(time, time, c.shop, `chat-message:${id}`)] : []),
    ],
    [
      {
        sql: "EXISTS(SELECT 1 FROM of_records WHERE shop=? AND id=? AND kind='chat-room' AND deleted=0 AND json_extract(data,'$.status')<>'C')",
        values: [c.shop, id],
      },
    ],
  );
  const msgId = results[1].meta.last_row_id;
  const message = { ...payload, id: msgId, msgId };
  await audit(c, "chat:new", id);
  return {
    message: { ...message, msgId: message.id },
    notify: { alimtalkQueued: false },
  };
}
export async function openCustomerRoom(
  c: LiveContext,
  orderKey: string,
): Promise<Doc> {
  requireChatEnabled(await setting(c, "chat"));
  const order = await first(
    c,
    "SELECT o.*,cu.name,cu.mobile FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND o.key=?",
    c.shop,
    orderKey,
  );
  if (!order) throw new LiveError("주문을 찾을 수 없습니다.", 404);
  const find = () =>
    first(
      c,
      "SELECT id,data,revision FROM of_records WHERE shop=? AND kind='chat-room' AND deleted=0 AND json_extract(data,'$.orderKey')=?",
      c.shop,
      orderKey,
    );
  const exists = await find();
  if (exists)
    return { ...parse(exists.data), id: exists.id, revision: exists.revision };
  try {
    const created = await put(c, "chat-room", {
      orderKey,
      token: crypto.randomUUID().replaceAll("-", ""),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      mobile: order.mobile,
      customerName: order.name,
      lastOrderNo: order.id,
      lastOrderDisplay: `No.${order.id}`,
      status: "O",
      unread: 0,
      customerUnread: 0,
      lastMessage: "",
      lastAt: now(),
      mute: false,
    });
    const config = await getChatSettings(c);
    if (config.greeting) await put(c, `chat-message:${created.id}`, {
      type: "greeting", sender: "S", senderName: "매장", content: config.greeting, createdAt: now(),
    });
    return created;
  } catch (error) {
    const raced = await find();
    if (raced)
      return { ...parse(raced.data), id: raced.id, revision: raced.revision };
    throw error;
  }
}

async function inquiry(c: LiveContext, id: string) {
  const found = await first(c, "SELECT id,data,revision FROM of_records WHERE shop=? AND kind='inquiry' AND deleted=0 AND json_extract(data,'$.inquiry_id')=?", c.shop, id);
  if (!found) throw new LiveError("문의를 찾을 수 없습니다.", 404);
  return { ...parse(found.data), id: Number(found.id), revision: Number(found.revision) } as Doc;
}

function attachment(c: LiveContext, value: unknown) {
  const path = text(value, 500);
  if (!path) return "";
  let url: URL;
  try { url = new URL(path, c.origin); } catch { throw new LiveError("첨부파일 주소를 확인해 주세요.", 422); }
  if (url.origin !== c.origin || !url.pathname.startsWith("/live-image/"))
    throw new LiveError("이 앱에 업로드한 이미지만 첨부할 수 있습니다.", 422);
  return url.pathname;
}

async function inquiryApi(c: LiveContext, path: string, data: Doc) {
  const admin = path.startsWith("/inquiry/admin/");
  if (admin && c.role !== "OWNER") throw new LiveError("관리자만 문의에 답변할 수 있습니다.", 403);
  const action = path.split("/")[admin ? 3 : 2];
  const unreadKey = admin ? "admin_unread" : "user_unread";
  if (action === "unread-count") {
    const total = await first(c, "SELECT COALESCE(SUM(COALESCE(json_extract(data,?),0)),0) AS unread FROM of_records WHERE shop=? AND kind='inquiry' AND deleted=0", `$.${unreadKey}`, c.shop);
    return { unread_count: Number(total?.unread ?? 0) };
  }
  if (action === "list") {
    const page = data.page == null ? 1 : integer(data.page, 1, 1000000);
    const size = data.pageSize == null ? 50 : integer(data.pageSize, 1, 200);
    const status = text(data.status) || "all";
    const result = await query(c, "SELECT id,data,revision,created_at,updated_at FROM of_records WHERE shop=? AND kind='inquiry' AND deleted=0 AND (?='all' OR json_extract(data,'$.status')=?) ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?", c.shop, status, status, size, (page - 1) * size);
    return result.map((row) => {
      const value = parse(row.data);
      return { ...value, id: row.id, revision: row.revision, created_at: row.created_at, updated_at: row.updated_at, unread_count: Number(value[unreadKey] ?? 0) };
    });
  }
  if (action === "create") {
    if (admin) throw new LiveError("허용되지 않은 요청입니다.", 405);
    const id = crypto.randomUUID(), time = now();
    const content = required(data.content, "문의 내용", 10000);
    const value = { inquiry_id: id, title: required(data.title, "문의 제목", 200), category: text(data.category, 60) || "이용문의", status: "waiting", created_by: c.actor, last_message: content, last_message_at: time, admin_unread: 1, user_unread: 0, escalated: false };
    await transaction(c, [
      c.db.prepare("INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)").bind(c.shop, "inquiry", JSON.stringify(value), time, time),
      c.db.prepare("INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)").bind(c.shop, `inquiry-message:${id}`, JSON.stringify({ content, author_type: "user", author_name: c.actor, created_at: time, createdAt: time }), time, time),
    ]);
    await audit(c, "inquiry:create", id);
    return { ...(await inquiry(c, id)), notice: "자체 문의함에 저장했습니다. 외부 고객지원으로 발송되지 않습니다." };
  }
  const id = required(data.inquiry_id, "문의번호", 100);
  const record = await inquiry(c, id);
  if (action === "messages") {
    const time = now();
    await transaction(c, [
      c.db.prepare("UPDATE of_records SET data=json_set(data,'$.read_at',?),updated_at=? WHERE shop=? AND kind=? AND deleted=0 AND json_extract(data,'$.author_type')=? AND json_extract(data,'$.read_at') IS NULL").bind(time, time, c.shop, `inquiry-message:${id}`, admin ? "user" : "admin"),
      c.db.prepare("UPDATE of_records SET data=json_set(data,?,0),revision=revision+1 WHERE shop=? AND kind='inquiry' AND id=? AND deleted=0").bind(`$.${unreadKey}`, c.shop, record.id),
    ]);
    return (await list(c, `inquiry-message:${id}`)).reverse().map((m) => ({ ...m, message_id: m.id, created_at: m.created_at ?? m.createdAt }));
  }
  if (action === "send") {
    if (record.status === "closed" && !admin) throw new LiveError("종료된 문의입니다.", 409);
    const file = attachment(c, data.attachment_url);
    const content = file ? text(data.content, 10000) || "(이미지)" : required(data.content, "답변 내용", 10000);
    const time = now(), recipientKey = admin ? "user_unread" : "admin_unread";
    const payload = { content, attachment_url: file, author_type: admin ? "admin" : "user", author_name: c.actor, created_at: time, createdAt: time };
    const results = await transaction(c, [
      c.db.prepare("INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)").bind(c.shop, `inquiry-message:${id}`, JSON.stringify(payload), time, time),
      c.db.prepare("UPDATE of_records SET data=json_set(data,'$.last_message',?,'$.last_message_at',?,'$.status',?,?,COALESCE(json_extract(data,?),0)+1),revision=revision+1,updated_at=? WHERE shop=? AND kind='inquiry' AND id=? AND deleted=0").bind(content, time, admin ? "answered" : "waiting", `$.${recipientKey}`, `$.${recipientKey}`, time, c.shop, record.id),
    ], [{ sql: "EXISTS(SELECT 1 FROM of_records WHERE shop=? AND id=? AND kind='inquiry' AND deleted=0 AND (?=1 OR json_extract(data,'$.status')<>'closed'))", values: [c.shop, record.id, admin ? 1 : 0] }]);
    await audit(c, admin?"inquiry:message:admin":"inquiry:message:user", id);
    return { ...payload, id: results[1].meta.last_row_id, escalated: record.escalated === true };
  }
  if (action === "close" || action === "escalate") {
    if (action === "escalate" && record.status === "closed") throw new LiveError("종료된 문의입니다.", 409);
    return put(c, "inquiry", { ...record, ...(action === "close" ? { status: "closed" } : { escalated: true, status: "waiting" }) }, Number(record.id));
  }
  return undefined;
}
export async function communicationsApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
  raw?: unknown,
) {
  if (path === "/chat/settings") {
    if (method === "PUT") {
      await setting(c, "chat", validateChatSettings({ ...(await getChatSettings(c)), ...data }));
    }
    return { settings: await getChatSettings(c) };
  }
  if (path === "/chat/quick-replies") {
    if (method === "PUT")
      await setting(c, "quick-replies", {
        items: Array.isArray(raw) ? raw : rows(data.items),
      });
    return { quickReplies: rows((await setting(c, "quick-replies")).items) };
  }
  if (path === "/chat/rooms/open") {
    let key = text(data.ocodekey);
    if (!key) {
      const order = await first(
        c,
        "SELECT o.key FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND cu.mobile=? ORDER BY o.id DESC LIMIT 1",
        c.shop,
        text(data.mobile),
      );
      key = text(order?.key);
    }
    const r = await openCustomerRoom(c, key);
    return { roomId: r.id, url: `${c.origin}/contact/${r.token}` };
  }
  if (path === "/chat/unread")
    return {
      unread: (await list(c, "chat-room")).reduce(
        (n, r) => n + Number(r.unread ?? 0),
        0,
      ),
    };
  if (path === "/chat/rooms") {
    const rooms = await list(c, "chat-room");
    return {
      rooms: rooms
        .filter((r) =>
          data.filter === "closed"
            ? r.status === "C"
            : data.filter === "unread"
              ? Number(r.unread) > 0
              : data.filter === "all" ? true : r.status !== "C",
        )
        .map((r) => ({
          ...r,
          roomId: r.id,
          mobileMasked: text(r.mobile).replace(
            /(\d{3})\d+(\d{4})/u,
            "$1-****-$2",
          ),
        })),
    };
  }
  if (/^\/chat\/rooms\/\d+/u.test(path)) {
    const id = integer(path.split("/")[3], 1),
      action = path.split("/")[4],
      r = await room(c, id);
    if (action === "messages")
      return method === "GET"
        ? { messages: await messages(c, id, data) }
        : send(c, id, data);
    if (
      action === "read" ||
      action === "close" ||
      action === "reopen" ||
      action === "mute"
    ) {
      if (action === "read") {
        await markChatRead(c, id);
        return { updated: 1 };
      }
      await put(
        c,
        "chat-room",
        {
          ...r,
          ...(action === "mute"
              ? { mute: !!data.mute }
              : { status: action === "close" ? "C" : "O" }),
        },
        id,
      );
      await audit(c, `chat:${action}`, id);
      return { updated: 1 };
    }
    return {
      room: { ...r, roomId: id },
      customer: {
        name: r.customerName,
        mobileMasked: text(r.mobile).slice(-4),
        orderCount: 1,
      },
      orders: (await orderRows(c))
        .filter((o) => o.ocodekey === r.orderKey)
        .map((o) => ({
          orderNo: o.orderno,
          ocodekey: o.ocodekey,
          orderDt: o.order_date,
          status: o.status,
          amount: o.tamt,
          itemsSummary: o.contents,
        })),
    };
  }
  if (path === "/chat/orders/display")
    return {
      items: (await orderRows(c)).filter(
        (o) => Array.isArray(data.keys) && data.keys.includes(o.ocodekey),
      ),
    };
  if (path.startsWith("/inquiry/")) return inquiryApi(c, path, data);
  const groups: [[string, string], ...Array<[string, string]>] = [
    ["/sms/templates", "sms-template"],
    ["/sms/address/groups", "address-group"],
    ["/sms/address/contacts", "address-contact"],
    ["/sms/block", "sms-block"],
  ];
  for (const [base, kind] of groups) {
    if (path === base || path.startsWith(base + "/")) {
      const id = Number(path.slice(base.length + 1) || 0);
      if (method === "GET") {
        const all = await list(c, kind);
        return all.map((r) => ({
          ...r,
          group_name: r.group_name ?? r.name,
          contact_count: 0,
        }));
      }
      if (method === "DELETE") return remove(c, kind, id);
      const clean = { ...data };
      if (kind === "sms-template") {
        required(data.title, "템플릿 이름", 120);
        required(data.contents, "문자 내용", 10000);
      }
      if (kind === "address-contact" || kind === "sms-block")
        clean.mobile = mobileOf(data.mobile);
      return put(c, kind, clean, id);
    }
  }
  if (path === "/sms/history")
    return {
      list: await list(c, "sms-job"),
      items: await list(c, "sms-job"),
      total: (await list(c, "sms-job")).length,
    };
  if (path === "/sms/stats")
    return { total: 0, success: 0, fail: 0, pending: 0, configured: false };
  if (path === "/sms/info")
    return {
      configured: false,
      remainPoint: 0,
      callback: "",
      smsPrice: null,
      lmsPrice: null,
      mmsPrice: null,
      message: "문자 공급자 연결 대기",
    };
  if (path === "/sms/charge/history" || path === "/sms/block/log") return [];
  if (path === "/notice/list")
    return {
      list: await list(c, "notice"),
      items: await list(c, "notice"),
      total: (await list(c, "notice")).length,
    };
  if (path === "/auth/login-popup") return { notices: [] };
  return undefined;
}
export async function publicChatContext(
  db: D1Database,
  token: string,
  origin: string,
) {
  if (!/^[a-f\d]{32}$/u.test(token))
    throw new LiveError("유효하지 않은 채팅 링크입니다.", 404);
  const record = await db
    .prepare(
      "SELECT * FROM of_records WHERE kind='chat-room' AND deleted=0 AND json_extract(data,'$.token')=?",
    )
    .bind(token)
    .first<Doc>();
  if (!record) throw new LiveError("채팅 링크를 찾을 수 없습니다.", 404);
  if (text(parse(record.data).expiresAt) < now())
    throw new LiveError("채팅 링크가 만료되었습니다.", 410);
  const c: LiveContext = {
    db,
    shop: String(record.shop),
    actor: `customer:${record.id}`,
    role: "CUSTOMER",
    permissions: {},
    origin,
  };
  requireChatEnabled(await setting(c, "chat"));
  return { c, id: Number(record.id), data: parse(record.data) };
}
