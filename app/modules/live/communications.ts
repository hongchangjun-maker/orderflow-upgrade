import {
  integer,
  LiveError,
  mobileOf,
  obj,
  required,
  rows,
  text,
  type Doc,
} from "./domain";
import { orderRows } from "./orders";
import {
  audit,
  first,
  list,
  now,
  parse,
  put,
  remove,
  setting,
  transaction,
  type LiveContext,
} from "./store";
export const chatDefaults = {
  enabled: false,
  bizHours: { from: "09:00", to: "18:00", days: "YYYYYNN" },
  autoReplyOffHours: false,
  autoReplyText: "",
  notifyPc: false,
  notifyApp: false,
  greeting: "",
};
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
export async function messages(c: LiveContext, id: number) {
  return (await list(c, `chat-message:${id}`))
    .map((m) => ({ ...m, msgId: m.id }))
    .reverse();
}
export async function send(
  c: LiveContext,
  id: number,
  data: Doc,
  sender = "S",
) {
  const r = await room(c, id);
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
      !fileUrl.pathname.startsWith("/live-image/")
    )
      throw new LiveError("이 앱에서 업로드한 파일만 보낼 수 있습니다.", 422);
  }
  const payload = {
    type,
    sender,
    senderName: sender === "S" ? "매장" : "고객",
    content,
    fileUrl: text(data.fileUrl, 500),
    thumbUrl: text(data.thumbUrl, 500),
    fileName: text(data.fileName, 120),
    fileSize: Number(data.fileSize ?? 0),
    orderNo: Number(data.orderNo ?? 0),
    createdAt: now(),
  };
  const time = now();
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
      c.db
        .prepare(
          "UPDATE of_records SET data=json_set(data,'$.lastMessage',?,'$.lastAt',?,'$.lastSender',?,'$.unread',CASE WHEN ?='C' THEN COALESCE(json_extract(data,'$.unread'),0)+1 ELSE 0 END),revision=revision+1,updated_at=? WHERE shop=? AND id=? AND kind='chat-room'",
        )
        .bind(content || type, time, sender, sender, time, c.shop, id),
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
    return await put(c, "chat-room", {
      orderKey,
      token: crypto.randomUUID().replaceAll("-", ""),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      mobile: order.mobile,
      customerName: order.name,
      lastOrderNo: order.id,
      lastOrderDisplay: `No.${order.id}`,
      status: "O",
      unread: 0,
      lastMessage: "",
      lastAt: now(),
      mute: false,
    });
  } catch (error) {
    const raced = await find();
    if (raced)
      return { ...parse(raced.data), id: raced.id, revision: raced.revision };
    throw error;
  }
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
      const hours = obj(data.bizHours);
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/u.test(text(hours.from)) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/u.test(text(hours.to)) ||
        !/^([YN]{7})$/u.test(text(hours.days))
      )
        throw new LiveError("영업시간과 요일을 확인해 주세요.", 422);
      await setting(c, "chat", { ...chatDefaults, ...data });
    }
    return { settings: { ...chatDefaults, ...(await setting(c, "chat")) } };
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
              : r.status !== "C",
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
        ? { messages: await messages(c, id) }
        : send(c, id, data);
    if (
      action === "read" ||
      action === "close" ||
      action === "reopen" ||
      action === "mute"
    ) {
      await put(
        c,
        "chat-room",
        {
          ...r,
          ...(action === "read"
            ? { unread: 0 }
            : action === "mute"
              ? { mute: !!data.mute }
              : { status: action === "close" ? "C" : "O" }),
        },
        id,
      );
      await audit(c, "chat:read", id);
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
  if (path.startsWith("/inquiry/")) {
    const action = path.split("/")[2];
    if (action === "unread-count") return { unread_count: 0 };
    if (action === "list") return list(c, "inquiry");
    if (action === "create")
      return {
        ...(await put(c, "inquiry", {
          ...data,
          status: "open",
          inquiry_id: crypto.randomUUID(),
        })),
        notice:
          "자체 문의함에 저장했습니다. 외부 고객지원으로 발송되지 않습니다.",
      };
    if (action === "messages")
      return list(
        c,
        `inquiry-message:${required(data.inquiry_id, "문의번호", 100)}`,
      );
    if (action === "send")
      return put(
        c,
        `inquiry-message:${required(data.inquiry_id, "문의번호", 100)}`,
        { ...data, author_type: "user", createdAt: now() },
      );
    if (action === "close") {
      const record = (await list(c, "inquiry")).find(
        (r) => r.inquiry_id === data.inquiry_id,
      );
      if (!record) throw new LiveError("문의를 찾을 수 없습니다.", 404);
      return put(
        c,
        "inquiry",
        { ...record, status: "closed" },
        Number(record.id),
      );
    }
  }
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
  return { c, id: Number(record.id), data: parse(record.data) };
}
