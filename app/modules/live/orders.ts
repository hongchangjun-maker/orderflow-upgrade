import { sha256Hex } from "../../lib/security";
import {
  assertSameCustomer,
  cartOf,
  day,
  integer,
  LiveError,
  mobileOf,
  obj,
  required,
  rows,
  text,
  type Doc,
} from "./domain";
import { formDetail } from "./forms";
import {
  audit,
  first,
  now,
  parse,
  query,
  transaction,
  type LiveContext,
} from "./store";
export async function orderRows(c: LiveContext, filter: Doc = {}) {
  const from =
      text(filter.frDate ?? filter.fr_date).replaceAll("-", "") || "00000000",
    to =
      text(filter.toDate ?? filter.to_date).replaceAll("-", "") || "99999999";
  const result = await query(
    c,
    "SELECT o.*,c.name cust_name,c.mobile FROM of_orders o JOIN of_customers c ON c.id=o.customer_id WHERE o.shop=? AND o.order_date BETWEEN ? AND ? AND o.merged_into IS NULL AND (?='' OR o.key=?) ORDER BY o.id DESC LIMIT 5000",
    c.shop,
    from,
    to,
    text(filter.key),
    text(filter.key),
  );
  const keyword = text(filter.searchData ?? filter.search).toLowerCase();
  const output: Doc[] = [];
  const ids = JSON.stringify(result.map((o) => o.id));
  const membersAll = await query(
    c,
    "SELECT id,key,amount,fee,merged_into FROM of_orders WHERE shop=? AND (id IN (SELECT value FROM json_each(?)) OR merged_into IN (SELECT value FROM json_each(?)))",
    c.shop,
    ids,
    ids,
  );
  const linesAll = await query(
    c,
    "SELECT i.*,o.merged_into FROM of_order_items i JOIN of_orders o ON o.id=i.order_id WHERE o.shop=? AND (o.id IN (SELECT value FROM json_each(?)) OR o.merged_into IN (SELECT value FROM json_each(?)))",
    c.shop,
    ids,
    ids,
  );
  const memberMap = new Map<number, Doc[]>(),
    lineMap = new Map<number, Doc[]>();
  for (const m of membersAll) {
    const id = Number(m.merged_into ?? m.id);
    memberMap.set(id, [...(memberMap.get(id) ?? []), m]);
  }
  for (const l of linesAll) {
    const id = Number(l.merged_into ?? l.order_id);
    lineMap.set(id, [...(lineMap.get(id) ?? []), l]);
  }
  for (const o of result) {
    const members = memberMap.get(Number(o.id)) ?? [o],
      lines = lineMap.get(Number(o.id)) ?? [];
    const data = parse(o.data);
    const total = members.reduce(
      (n, r) => n + Number(r.amount) + Number(r.fee),
      0,
    );
    const row = {
      ...data,
      ocodekey: o.key,
      orderno: Number(o.id),
      uocode: Number(o.form_id),
      cust_name: o.cust_name,
      mobile: o.mobile,
      order_date: o.order_date,
      status: o.status,
      ispaid: o.ispaid,
      finbank: o.ispaid,
      order_amt: members.reduce((n, r) => n + Number(r.amount), 0),
      delivery_amt: members.reduce((n, r) => n + Number(r.fee), 0),
      tamt: total,
      total_amt: total,
      tqty: lines.length,
      item_summary: lines[0]?.name ?? "",
      contents: lines.map((i) => `${i.name} ${i.quantity}${i.unit}`).join("\n"),
      revision: o.revision,
      isrt_date: o.created_at,
      update_date: o.updated_at,
      point: 0,
      saved_point: 0,
      isrt_user: "고객",
      sms_result: "",
      memberKeys: members.map((m) => m.key),
      ordernumber:
        members.length > 1 ? members.map((m) => m.key).join(",") : "",
    };
    if (
      keyword &&
      !`${o.cust_name} ${o.mobile} ${o.id} ${data.addr}`
        .toLowerCase()
        .includes(keyword)
    )
      continue;
    output.push(row);
  }
  return output;
}
export async function createLiveOrder(
  c: LiveContext,
  formId: number,
  input: Doc,
) {
  const detail = await formDetail(c, formId);
  const form = await first(
    c,
    "SELECT active FROM of_forms WHERE id=? AND shop=?",
    formId,
    c.shop,
  );
  if (!form?.active) throw new LiveError("마감된 주문서입니다.", 409);
  const setting = detail.setting;
  const time = now();
  const kst =
    day() +
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date())
      .replace(":", "");
  const open =
    text(setting.open_date).replaceAll("-", "") +
    text(setting.open_time || "0000");
  const close =
    text(setting.expire_date).replaceAll("-", "") +
    text(setting.expire_time || "2359");
  if (
    (/^\d{12}$/u.test(open) && kst < open) ||
    (/^\d{12}$/u.test(close) && kst > close)
  )
    throw new LiveError("주문 접수 기간이 아닙니다.", 409);
  if (
    (setting.open_at && time < String(setting.open_at)) ||
    (setting.close_at && time > String(setting.close_at))
  )
    throw new LiveError("주문 접수 기간이 아닙니다.", 409);
  const mobile = mobileOf(input.mobile ?? input.phone);
  const name = required(input.cust_name ?? input.name, "고객명", 80);
  const cart = cartOf(input.items);
  const idempotency = required(input.idempotencyKey, "중복 방지 식별자", 120);
  const requestHash = await sha256Hex(
    JSON.stringify({
      formId,
      mobile,
      name,
      cart: [...cart].sort((a, b) => a.id - b.id),
      addr: text(input.addr ?? input.address, 400),
      addr2: text(input.addr2 ?? input.addressDetail, 200),
      delivery_gbn: text(input.delivery_gbn ?? "direct"),
      delivery_memo: text(input.delivery_memo ?? input.note, 1000),
    }),
  );
  const existing = await first(
    c,
    "SELECT * FROM of_orders WHERE form_id=? AND idempotency=?",
    formId,
    idempotency,
  );
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new LiveError("같은 식별자로 다른 주문이 제출되었습니다.", 409);
    return { orderNo: existing.id, key: existing.key, replayed: true };
  }
  const block = await first(
    c,
    "SELECT id FROM of_records WHERE shop=? AND kind='customer-block' AND deleted=0 AND json_extract(data,'$.mobile')=?",
    c.shop,
    mobile,
  );
  if (block)
    throw new LiveError(
      "현재 주문을 접수할 수 없습니다. 매장에 문의해 주세요.",
      403,
    );
  const items = cart.map((line) => {
    const row = detail.items.find((i) => Number(i.seqno) === line.id);
    if (!row || row.use_yn === "N" || row.cat_gbn === "CAT")
      throw new LiveError("주문할 수 없는 품목입니다.", 422);
    if (Number(row.stock) < line.qty)
      throw new LiveError("재고가 부족합니다.", 409, "insufficient_stock");
    if (
      (Number(row.item_min_qty) > 0 && line.qty < Number(row.item_min_qty)) ||
      (Number(row.item_max_qty) > 0 && line.qty > Number(row.item_max_qty))
    )
      throw new LiveError(
        `${row.iname}의 주문 수량 범위를 확인해 주세요.`,
        422,
      );
    return {
      ...line,
      price: Number(row.cost),
      name: String(row.iname),
      unit: String(row.unit),
    };
  });
  const amount = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  if (amount < Number(setting.min_order_amount ?? 0))
    throw new LiveError("최소 주문 금액보다 적습니다.", 422);
  const delivery = text(input.delivery_gbn ?? "direct");
  if (
    !["direct", "pickup", "parcel"].includes(delivery) ||
    (delivery === "pickup" && setting.delivery_pickup !== "Y") ||
    (delivery === "direct" && setting.delivery_deliver === "N") ||
    (delivery === "parcel" && setting.delivery_parcel !== "Y")
  )
    throw new LiveError("선택할 수 없는 배송 방법입니다.", 422);
  const fee =
    delivery === "pickup"
      ? 0
      : integer(setting.shipping_fee ?? setting.delivery_amt ?? 0);
  const key = crypto.randomUUID();
  const data = {
    cust_name: name,
    mobile,
    addr: text(input.addr ?? input.address, 400),
    addr2: text(input.addr2 ?? input.addressDetail, 200),
    delivery_gbn: delivery,
    pay_gbn: "transfer",
    delivery_memo: text(input.delivery_memo ?? input.note, 1000),
    memo: "",
    point: 0,
    iscashreceipt: "N",
    ispresent: "N",
  };
  if (delivery !== "pickup" && !data.addr)
    throw new LiveError("배송 주소를 입력해 주세요.", 422);
  const statements = [
    c.db
      .prepare(
        "INSERT INTO of_customers(shop,mobile,name,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(shop,mobile) DO UPDATE SET name=excluded.name,data=excluded.data",
      )
      .bind(c.shop, mobile, name, JSON.stringify(data), time),
    c.db
      .prepare(
        "INSERT INTO of_orders(shop,form_id,customer_id,key,idempotency,request_hash,order_date,amount,fee,data,created_at,updated_at) VALUES(?,?,(SELECT id FROM of_customers WHERE shop=? AND mobile=?),?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        c.shop,
        formId,
        c.shop,
        mobile,
        key,
        idempotency,
        requestHash,
        day(),
        amount,
        fee,
        JSON.stringify(data),
        time,
        time,
      ),
  ];
  for (const i of items)
    statements.push(
      c.db
        .prepare(
          "INSERT INTO of_order_items(order_id,item_id,name,unit,quantity,price) VALUES((SELECT id FROM of_orders WHERE key=?),?,?,?,?,?)",
        )
        .bind(key, i.id, i.name, i.unit, i.qty, i.price),
    );
  try {
    await transaction(c, statements, [
      {
        sql: "EXISTS(SELECT 1 FROM of_forms WHERE id=? AND shop=? AND active=1 AND revision=?)",
        values: [formId, c.shop, setting.revision],
      },
      {
        sql: "NOT EXISTS(SELECT 1 FROM json_each(?) x LEFT JOIN of_items i ON i.id=json_extract(x.value,'$.id') WHERE i.id IS NULL OR i.active<>1 OR i.price<>json_extract(x.value,'$.price') OR i.form_id<>? OR i.shop<>?)",
        values: [JSON.stringify(items), formId, c.shop],
      },
    ]);
  } catch (error) {
    const duplicate = await first(
      c,
      "SELECT * FROM of_orders WHERE form_id=? AND idempotency=?",
      formId,
      idempotency,
    );
    if (duplicate && duplicate.request_hash === requestHash)
      return { orderNo: duplicate.id, key: duplicate.key, replayed: true };
    if (String(error).includes("stock"))
      throw new LiveError(
        "다른 고객의 주문으로 재고가 변경됐습니다. 수량을 확인해 주세요.",
        409,
        "insufficient_stock",
      );
    throw error;
  }
  const order = await first(c, "SELECT id FROM of_orders WHERE key=?", key);
  await audit(c, "order:new", key);
  return { orderNo: order?.id, key, replayed: false };
}
export async function orderDetail(c: LiveContext, key: unknown) {
  const order = await first(
    c,
    "SELECT * FROM of_orders WHERE key=? AND shop=?",
    text(key),
    c.shop,
  );
  if (!order) throw new LiveError("주문을 찾을 수 없습니다.", 404);
  if (order.merged_into)
    throw new LiveError("병합 대표 주문에서 조회해 주세요.", 409);
  const header = (await orderRows(c, { key }))[0];
  const items = await query(
    c,
    "SELECT i.* FROM of_order_items i JOIN of_orders o ON i.order_id=o.id WHERE o.shop=? AND (o.id=? OR o.merged_into=?)",
    c.shop,
    order.id,
    order.id,
  );
  return {
    header,
    items: items.map((i) => ({
      ...i,
      seqno: i.id,
      iname: i.name,
      item_name: i.name,
      disp: i.name,
      qty: i.quantity,
      cost: i.price,
      amt: Number(i.quantity) * Number(i.price),
    })),
    availableItems: (await formDetail(c, Number(order.form_id))).items,
  };
}
export async function ordersApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/orders/list") {
    const orders = await orderRows(c, data);
    return {
      orders,
      summary: {
        tstatus: orders.length,
        ...Object.fromEntries(
          ["00", "10", "22", "24", "30", "40"].map((s) => [
            `tstatus${s}`,
            orders.filter((o) => o.status === s).length,
          ]),
        ),
      },
    };
  }
  if (path === "/orders/detail") return orderDetail(c, data.ocodekey);
  if (path === "/orders/status" || path === "/orders/payment") {
    const selected = rows(data.orders);
    if (!selected.length || selected.length > 100)
      throw new LiveError("1~100건을 선택해 주세요.", 422);
    const status = path.endsWith("status") ? text(data.status) : null;
    if (status && !["00", "10", "22", "24", "30", "40"].includes(status))
      throw new LiveError("유효하지 않은 상태입니다.", 422);
    let updated = 0;
    const statements: D1PreparedStatement[] = [];
    for (const item of selected) {
      const key = text(item.ocodekey);
      const order = await first(
        c,
        "SELECT id FROM of_orders WHERE shop=? AND key=?",
        c.shop,
        key,
      );
      if (!order)
        throw new LiveError("다른 상점의 주문은 변경할 수 없습니다.", 404);
      const paid = data.ispaid ?? data.finbank ?? data.paied ?? "Y";
      statements.push(
        c.db
          .prepare(
            status
              ? "UPDATE of_orders SET status=?,revision=revision+1,updated_at=? WHERE shop=? AND (id=? OR merged_into=?)"
              : "UPDATE of_orders SET ispaid=?,revision=revision+1,updated_at=? WHERE shop=? AND (id=? OR merged_into=?)",
          )
          .bind(
            status ?? (paid === "N" ? "N" : "Y"),
            now(),
            c.shop,
            order.id,
            order.id,
          ),
      );
    }
    const results = await c.db.batch(statements);
    updated = results.reduce((n, r) => n + Number(r.meta.changes), 0);
    await audit(c, "orders:update", updated);
    return {
      updated,
      failed: 0,
      results: selected.map((o) => ({
        orderno: o.orderno,
        error_no: 0,
        error_msg: "",
      })),
    };
  }
  if (path === "/orders/save") {
    const header = obj(data.header ?? data);
    const old = await first(
      c,
      "SELECT * FROM of_orders WHERE shop=? AND key=?",
      c.shop,
      text(header.ocodekey),
    );
    if (!old) throw new LiveError("주문을 찾을 수 없습니다.", 404);
    if (old.status === "40")
      throw new LiveError("취소된 주문은 변경할 수 없습니다.", 409);
    if (
      header.revision != null &&
      Number(header.revision) !== Number(old.revision)
    )
      throw new LiveError("다른 사용자가 주문을 변경했습니다.", 409);
    const next = { ...parse(old.data) };
    for (const field of [
      "delivery_gbn",
      "delivery_part_gbn",
      "packing",
      "delivery",
      "postal",
      "addr",
      "addr2",
      "door_pw",
      "pickup_time",
      "pay_gbn",
      "tranname",
      "cash_receipt",
      "memo",
      "delivery_memo",
    ])
      if (header[field] !== undefined) next[field] = text(header[field], 1000);
    const status = text(header.status ?? old.status);
    const children = await query(
      c,
      "SELECT fee FROM of_orders WHERE shop=? AND merged_into=?",
      c.shop,
      old.id,
    );
    const fee = integer(header.delivery_amt ?? old.fee);
    if (
      children.length &&
      fee !== Number(old.fee) + children.reduce((n, o) => n + Number(o.fee), 0)
    )
      throw new LiveError("병합 주문의 배송비는 변경할 수 없습니다.", 409);
    if (old.ispaid === "Y" && fee !== Number(old.fee))
      throw new LiveError("결제된 주문의 금액은 변경할 수 없습니다.", 409);
    if (!["00", "10", "22", "24", "30", "40"].includes(status))
      throw new LiveError("주문 상태를 확인해 주세요.", 422);
    const r = await c.db
      .prepare(
        "UPDATE of_orders SET data=?,status=?,fee=?,revision=revision+1,updated_at=? WHERE shop=? AND key=? AND revision=?",
      )
      .bind(
        JSON.stringify(next),
        status,
        children.length ? old.fee : fee,
        now(),
        c.shop,
        old.key,
        old.revision,
      )
      .run();
    if (!r.meta.changes) throw new LiveError("동시 수정 충돌입니다.", 409);
    await audit(c, "order:edit", old.key);
    return orderDetail(c, old.key);
  }
  if (path === "/orders/save-items") {
    const old = await first(
      c,
      "SELECT * FROM of_orders WHERE shop=? AND key=?",
      c.shop,
      text(data.ocodekey),
    );
    const merged =
      old &&
      (await first(c, "SELECT id FROM of_orders WHERE merged_into=?", old.id));
    if (
      !old ||
      ["30", "40"].includes(String(old.status)) ||
      old.ispaid === "Y" ||
      old.merged_into ||
      merged
    )
      throw new LiveError("변경할 수 없는 주문입니다.", 409);
    const detail = await formDetail(c, Number(old.form_id));
    const cart = cartOf(
      rows(data.items).map((line) => {
        const matches = detail.items.filter(
          (i) => i.iname === line.iname && i.unit === line.unit,
        );
        if (line.seqno || line.itemId) return line;
        if (matches.length !== 1)
          throw new LiveError(
            "동일한 품목명이 중복되어 있습니다. 품목 식별자를 확인해 주세요.",
            422,
          );
        return { ...line, seqno: matches[0].seqno };
      }),
    );
    const selected = cart.map((i) => {
      const item = detail.items.find((r) => Number(r.seqno) === i.id);
      if (!item) throw new LiveError("품목을 확인해 주세요.", 422);
      return { ...i, item };
    });
    const amount = selected.reduce(
      (n, i) => n + Number(i.item.cost) * i.qty,
      0,
    );
    const statements = [
      c.db.prepare("DELETE FROM of_order_items WHERE order_id=?").bind(old.id),
    ];
    for (const i of selected)
      statements.push(
        c.db
          .prepare(
            "INSERT INTO of_order_items(order_id,item_id,name,unit,quantity,price) VALUES(?,?,?,?,?,?)",
          )
          .bind(old.id, i.id, i.item.iname, i.item.unit, i.qty, i.item.cost),
      );
    statements.push(
      c.db
        .prepare(
          "UPDATE of_orders SET amount=?,revision=revision+1,updated_at=? WHERE id=? AND shop=?",
        )
        .bind(amount, now(), old.id, c.shop),
    );
    await transaction(c, statements, [
      {
        sql: "EXISTS(SELECT 1 FROM of_orders WHERE id=? AND shop=? AND revision=? AND status NOT IN ('30','40') AND merged_into IS NULL)",
        values: [old.id, c.shop, data.revision ?? old.revision],
      },
    ]);
    await audit(c, "order:items", old.key);
    return {
      order_amt: amount,
      delivery_amt: old.fee,
      contents: selected.map((i) => `${i.item.iname} ${i.qty}`).join("\n"),
    };
  }
  if (path === "/orders/merge-list") {
    const all = await orderRows(c, {
      ...data,
      frDate: data.order_date,
      toDate: data.order_date,
    });
    return {
      orders: all.filter(
        (o) =>
          all.filter((r) => r.mobile === o.mobile).length > 1 &&
          o.status !== "40",
      ),
    };
  }
  if (path === "/orders/merge") {
    const keys = [
      ...new Set(text(data.ocodekey_arr, 10000).split(",").filter(Boolean)),
    ];
    if (keys.length < 2 || keys.length > 100)
      throw new LiveError("2~100건을 선택해 주세요.", 422);
    const orders: Doc[] = [];
    for (const key of keys) {
      const o = await first(
        c,
        "SELECT * FROM of_orders WHERE shop=? AND key=?",
        c.shop,
        key,
      );
      if (!o) throw new LiveError("주문을 찾을 수 없습니다.", 404);
      orders.push({ ...o, data: parse(o.data) });
    }
    const parent = orders[0];
    if (
      !parent.merged_into &&
      orders.slice(1).every((o) => o.merged_into === parent.id)
    )
      return { error_no: 0, ocodekey: parent.key, replayed: true };
    assertSameCustomer(orders);
    if (orders.some((o) => o.status === "30" || o.ispaid === "Y"))
      throw new LiveError("미결제·미완료 주문만 병합할 수 있습니다.", 409);
    const children = await first(
      c,
      "SELECT COUNT(*) n FROM of_orders WHERE shop=? AND merged_into IN (SELECT id FROM of_orders WHERE shop=? AND key IN (" +
        keys.map(() => "?").join(",") +
        "))",
      c.shop,
      c.shop,
      ...keys,
    );
    if (Number(children?.n) > 0)
      throw new LiveError("이미 병합된 주문은 다시 병합할 수 없습니다.", 409);
    await transaction(
      c,
      orders
        .slice(1)
        .map((o) =>
          c.db
            .prepare(
              "UPDATE of_orders SET merged_into=?,revision=revision+1 WHERE id=? AND shop=? AND merged_into IS NULL",
            )
            .bind(parent.id, o.id, c.shop),
        ),
      orders.map((o) => ({
        sql: "EXISTS(SELECT 1 FROM of_orders WHERE id=? AND shop=? AND revision=? AND merged_into IS NULL AND status NOT IN ('30','40') AND ispaid='N')",
        values: [o.id, c.shop, o.revision],
      })),
    );
    await audit(c, "order:merge", parent.key);
    return { error_no: 0, ocodekey: parent.key };
  }
  if (path === "/orders/merged-detail") {
    const selected = text(data.ocodekey_arr).split(",");
    return {
      orders: (await orderRows(c)).filter((o) =>
        selected.includes(String(o.ocodekey)),
      ),
    };
  }
  if (path === "/orders/prepay-deduct") {
    const requested = rows(data.orders).length
      ? rows(data.orders)
      : [{ ocodekey: data.ocodekey }];
    if (requested.length > 100)
      throw new LiveError("100건 이하를 선택해 주세요.", 422);
    let updated = 0;
    for (const entry of requested) {
      const order = await first(
        c,
        "SELECT o.*,cu.mobile FROM of_orders o JOIN of_customers cu ON cu.id=o.customer_id WHERE o.shop=? AND o.key=?",
        c.shop,
        text(entry.ocodekey),
      );
      if (!order || order.status === "40" || order.merged_into)
        throw new LiveError("공제할 수 없는 주문입니다.", 409);
      const operation = `prepay-order:${order.key}`;
      if (
        await first(
          c,
          "SELECT id FROM of_ledger WHERE shop=? AND operation=?",
          c.shop,
          operation,
        )
      ) {
        updated++;
        continue;
      }
      const members = await query(
        c,
        "SELECT amount,fee FROM of_orders WHERE shop=? AND (id=? OR merged_into=?)",
        c.shop,
        order.id,
        order.id,
      );
      const total = members.reduce(
        (n, o) => n + Number(o.amount) + Number(o.fee),
        0,
      );
      if (total <= 0 || order.ispaid === "Y")
        throw new LiveError("이미 결제됐거나 금액이 없는 주문입니다.", 409);
      await transaction(
        c,
        [
          c.db
            .prepare(
              "INSERT INTO of_ledger(shop,mobile,kind,delta,memo,operation,actor,created_at) VALUES(?,?,?,?,?,?,?,?)",
            )
            .bind(
              c.shop,
              order.mobile,
              "prepay",
              -total,
              `주문 ${order.id} 선입금 공제`,
              operation,
              c.actor,
              now(),
            ),
          c.db
            .prepare(
              "UPDATE of_orders SET ispaid='Y',revision=revision+1,updated_at=? WHERE shop=? AND (id=? OR merged_into=?)",
            )
            .bind(now(), c.shop, order.id, order.id),
        ],
        [
          {
            sql: "EXISTS(SELECT 1 FROM of_orders WHERE id=? AND shop=? AND revision=? AND ispaid='N' AND status<>'40')",
            values: [order.id, c.shop, order.revision],
          },
        ],
      );
      updated++;
    }
    await audit(c, "order:prepay", updated);
    return {
      updated,
      failed: 0,
      results: requested.map((o) => ({
        orderno: o.orderno,
        error_no: 0,
        error_msg: "",
      })),
    };
  }
  if (path === "/orders/excel-data")
    return { orders: await orderRows(c, data), items: [] };
  if (path === "/orders/delivery-methods")
    return [
      {
        code: "direct",
        code_name: "direct",
        name: "직배송",
        part_gbn: "delivery",
        use_address_input_type: "text",
        use_addressbook: "Y",
        use_door_pw: "Y",
        use_pickup_time: "N",
      },
      {
        code: "pickup",
        code_name: "pickup",
        name: "픽업",
        part_gbn: "pickup",
        use_address_input_type: "text",
        use_addressbook: "N",
        use_door_pw: "N",
        use_pickup_time: "Y",
      },
    ];
  if (path === "/orders/pay-methods")
    return [
      {
        code: "transfer",
        code_name: "transfer",
        name: "계좌이체",
        pay_name: "계좌이체",
      },
    ];
  if (path === "/orders/compute-delivery-amt")
    return {
      delivery_amt: Number(
        (await formDetail(c, integer(data.uocode, 1, Number.MAX_SAFE_INTEGER)))
          .setting.shipping_fee ?? 0,
      ),
    };
  if (path === "/orders/share-link") {
    const o = await first(
      c,
      "SELECT key FROM of_orders WHERE shop=? AND key=?",
      c.shop,
      text(data.ocodekey),
    );
    if (!o) throw new LiveError("주문을 찾을 수 없습니다.", 404);
    return { url: `${c.origin}/receipt/${o.key}` };
  }
  return undefined;
}
