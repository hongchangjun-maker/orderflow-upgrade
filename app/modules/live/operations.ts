import {
  cartOf,
  day,
  integer,
  LiveError,
  mobileOf,
  nearestRoute,
  obj,
  rows,
  text,
  type Doc,
} from "./domain";
import { formDetail } from "./forms";
import { createLiveOrder } from "./orders";
import { orderRows } from "./order-reader";
import { reportDay, reportMonth, kstCreatedBounds } from "./report-rules";
import { nextSchedule } from "./schedule";
import { amountDue,paymentOptions } from "./pricing";
import {
  audit,
  first,
  list,
  now,
  parse,
  query,
  put,
  remove,
  setting,
  transaction,
  type LiveContext,
} from "./store";
const deliveryDay = (data: Doc) =>
  reportDay(data.deliveryDate ?? data.orderDate) || day();
const stopKeys = (s: Doc): string[] =>
  Array.isArray(s.ocodekeys)
    ? s.ocodekeys.map(String)
    : rows(s.orders).length
      ? rows(s.orders).map((o) => text(o.ocodekey))
      : [text(s.stopCode ?? s.ocodekey)].filter(Boolean);
const planView = (p: Doc): Doc => ({
  ...p,
  planNo: p.planNo ?? p.id,
  deliveryDate: p.deliveryDate ?? p.orderDate,
  orderDate: p.orderDate ?? p.deliveryDate,
});
async function savedPlans(c: LiveContext, data: Doc) {
  const date = deliveryDay(data);
  const result = await query(
    c,
    "SELECT id,data,revision FROM of_records WHERE shop=? AND kind='delivery-plan' AND deleted=0 AND COALESCE(json_extract(data,'$.deliveryDate'),json_extract(data,'$.orderDate'))=? ORDER BY id DESC",
    c.shop,
    date,
  );
  return result
    .map((r) => planView({ ...parse(r.data), id: r.id, revision: r.revision }))
    .filter(
      (p) => !Number(data.planNo) || Number(p.planNo) === Number(data.planNo),
    );
}
async function recurringItems(c: LiveContext, formId: number, input: unknown) {
  const catalog = (await formDetail(c, formId)).items;
  return rows(input).map((i) => {
    const item =
      catalog.find((r) => Number(r.seqno) === Number(i.seqno ?? i.itemId)) ??
      catalog.find((r) => r.iname === i.iname && r.unit === i.unit);
    if (!item)
      throw new LiveError(
        "정기주문 품목을 현재 주문서에서 찾을 수 없습니다.",
        422,
      );
    return {
      ...i,
      seqno: item.seqno,
      qty: integer(i.qty ?? i.quantity, 1, 9999),
    };
  });
}
export async function runRecurring(db: D1Database, shop?: string) {
  const raw = await db
    .prepare(
      "SELECT * FROM of_records WHERE kind='recurring' AND deleted=0 AND json_extract(data,'$.status')='active' AND (?='' OR shop=?) AND replace(json_extract(data,'$.next_order_date'),'-','')<=? ORDER BY json_extract(data,'$.next_order_date'),id LIMIT 500",
    )
    .bind(shop ?? "", shop ?? "", day())
    .all<Doc>();
  const today = day();
  let count = 0;
  for (const row of raw.results) {
    const master: Doc = { ...parse(row.data), revision: row.revision };
    const due = text(master.next_order_date).replaceAll("-", "");
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
    if (!due || due > today || hour < Number(master.generate_hour ?? 0))
      continue;
    const c: LiveContext = {
      db,
      shop: String(row.shop),
      actor: "scheduler",
      role: "OWNER",
      permissions: {},
      origin: "",
    };
    try {
      if (master.end_date && due > text(master.end_date).replaceAll("-", "")) {
        await put(
          c,
          "recurring",
          { ...master, status: "ended" },
          Number(row.id),
        );
        continue;
      }
      await createLiveOrder(c, Number(master.uocode), {
        ...master,
        items: await recurringItems(c, Number(master.uocode), master.items),
        idempotencyKey: `recurring:${row.id}:${due}`,
      });
      await put(
        c,
        "recurring",
        {
          ...master,
          next_order_date: nextSchedule(master, due),
          last_generated_at: now(),
          last_error: "",
        },
        Number(row.id),
      );
      count++;
    } catch (error) {
      await put(
        c,
        "recurring",
        {
          ...master,
          last_error: error instanceof Error ? error.message : "생성 실패",
        },
        Number(row.id),
      );
    }
  }
  return { generated: count };
}
export async function operationsApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/recurring-orders/run-due") {
    if (c.role !== "OWNER")
      throw new LiveError("사장님만 정기주문을 실행할 수 있습니다.", 403);
    return runRecurring(c.db, c.shop);
  }
  if (path === "/recurring-orders/list") {
    const search = text(data.search).toLowerCase();
    const result = await query(
      c,
      "SELECT id,data,revision,created_at,updated_at FROM of_records WHERE shop=? AND kind='recurring' AND deleted=0 AND (?='' OR json_extract(data,'$.status')=?) AND (?='' OR lower(COALESCE(json_extract(data,'$.cust_name'),'')||' '||COALESCE(json_extract(data,'$.mobile'),'')||' '||COALESCE(json_extract(data,'$.addr'),'')) LIKE ?) ORDER BY id DESC LIMIT 5000",
      c.shop,
      text(data.status),
      text(data.status),
      search,
      `%${search}%`,
    );
    return result.map((r) => ({
      ...parse(r.data),
      id: r.id,
      rocode: r.id,
      revision: r.revision,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }
  if (path === "/recurring-orders/summary") {
    const all = (
      await query(
        c,
        "SELECT data FROM of_records WHERE shop=? AND kind='recurring' AND deleted=0",
        c.shop,
      )
    ).map((r) => parse(r.data));
    const month = reportMonth({});
    const bounds = kstCreatedBounds(month.from, month.to);
    const generated = await first(
      c,
      "SELECT COUNT(*) n FROM of_orders WHERE shop=? AND idempotency LIKE 'recurring:%' AND created_at>=? AND created_at<?",
      c.shop,
      bounds.from,
      bounds.to,
    );
    return {
      active_count: all.filter((r) => r.status === "active").length,
      paused_count: all.filter((r) => r.status === "paused").length,
      this_week_count: all.filter(
        (r) =>
          r.status === "active" &&
          text(r.next_order_date).replaceAll("-", "") >= day() &&
          text(r.next_order_date).replaceAll("-", "") <=
            day(new Date(Date.now() + 7 * 86400000)),
      ).length,
      this_month_count: Number(generated?.n ?? 0),
    };
  }
  if (path === "/recurring-orders/save") {
    const id = Number(data.rocode ?? 0);
    const uocode = integer(data.uocode, 1, Number.MAX_SAFE_INTEGER);
    const items = await recurringItems(c, uocode, data.items);
    cartOf(items);
    const master: Doc = {
      ...data,
      uocode,
      mobile: mobileOf(data.mobile),
      items,
      status: text(data.status) || "active",
    };
    const start = text(data.start_date).replaceAll("-", "");
    if (!/^\d{8}$/u.test(start))
      throw new LiveError("정기주문 시작일을 확인해 주세요.", 422);
    nextSchedule(master, start);
    master.next_order_date = nextSchedule(
      master,
      day(new Date(Date.now() - 86400000)),
    );
    return put(c, "recurring", master, id);
  }
  if (path.startsWith("/recurring-orders/detail/")) {
    const row = (await list(c, "recurring")).find(
      (r) => r.id === Number(path.split("/").at(-1)),
    );
    if (!row) throw new LiveError("정기주문을 찾을 수 없습니다.", 404);
    return { master: { ...row, rocode: row.id }, items: row.items };
  }
  if (path.startsWith("/recurring-orders/urlorder-items/")) {
    const form = await formDetail(c, Number(path.split("/").at(-1)));
    return {
      items: form.items,
      deliveryOptions: [
        ...(form.setting.delivery_deliver!=='N'?[{value:"direct",label:"직배송"}]:[]),
        ...(form.setting.delivery_pickup==='Y'?[{value:"pickup",label:"픽업"}]:[]),
        ...(form.setting.delivery_parcel==='Y'?[{value:"parcel",label:"택배"}]:[]),
      ],
      payOptions: paymentOptions(form.setting,form.payMethods),
    };
  }
  if (path === "/recurring-orders/status") {
    if (!["active", "paused", "ended"].includes(text(data.status)))
      throw new LiveError("정기주문 상태를 확인해 주세요.", 422);
    const row = (await list(c, "recurring")).find(
      (r) => r.id === Number(data.rocode),
    );
    if (!row) throw new LiveError("정기주문을 찾을 수 없습니다.", 404);
    return put(c, "recurring", { ...row, status: data.status }, Number(row.id));
  }
  if (/^\/recurring-orders\/\d+$/u.test(path) && method === "DELETE")
    return remove(c, "recurring", Number(path.split("/").at(-1)));
  if (path.startsWith("/delivery-route/")) {
    const name = path.split("/")[2];
    if (["teams", "origins"].includes(name)) {
      const id = Number(path.split("/")[3] ?? 0);
      if (method === "DELETE") return remove(c, `delivery-${name}`, id);
      if (method !== "GET")
        await put(
          c,
          `delivery-${name}`,
          data,
          Number(data.seqno ?? data.id ?? 0),
        );
      return list(c, `delivery-${name}`);
    }
    if (name === "setting")
      return setting(c, "delivery", method === "GET" ? undefined : data);
    if (name === "plan-detail") {
      const plans = await savedPlans(c, data);
      if (Number(data.planNo) && !plans.length)
        throw new LiveError("저장된 배송 차수를 찾을 수 없습니다.", 404);
      const stops = plans.flatMap((p) => rows(p.stops));
      return {
        plans,
        stops,
        totalStops: stops.length,
        totalOrders: stops.reduce((n, s) => n + rows(s.orders).length, 0),
        totalDistance: plans.reduce((n, p) => n + Number(p.distance ?? 0), 0),
        totalDuration: plans.reduce((n, p) => n + Number(p.duration ?? 0), 0),
        coordinatesConfigured: false,
      };
    }
    if (name === "preview") {
      const orders = await orderRows(c, {
        frDate: deliveryDay(data),
        toDate: deliveryDay(data),
      });
      return {
        orders,
        stops: orders.map((o, i) => ({
          ...o,
          seq: i + 1,
          stopCode: o.ocodekey,
          orderNo: o.orderno,
          address: o.addr,
          customerName: o.cust_name,
          stopStatus: "10",
        })),
        teams: await list(c, "delivery-teams"),
        origins: await list(c, "delivery-origins"),
      };
    }
    if (name === "optimize") {
      const stops = rows(data.stops);
      if (
        stops.some(
          (s) =>
            s.lat == null ||
            s.lon == null ||
            s.lat === "" ||
            s.lon === "" ||
            !Number.isFinite(Number(s.lat)) ||
            !Number.isFinite(Number(s.lon)) ||
            Math.abs(Number(s.lat)) > 90 ||
            Math.abs(Number(s.lon)) > 180,
        )
      )
        throw new LiveError(
          "경로 최적화에는 각 배송지 좌표가 필요합니다. 좌표를 입력해 주세요. 외부 지도 연동은 연결 대기입니다.",
          422,
        );
      return {
        stops: nearestRoute(stops, obj(data.origin)),
        algorithm: "nearest-neighbor",
        provider: "internal",
      };
    }
    if (name === "save") {
      const date = deliveryDay(data);
      const teams = rows(data.teams).length
        ? rows(data.teams)
        : [
            {
              teamNo: data.teamNo ?? 1,
              teamName: data.teamName ?? "배송팀",
              stops: rows(data.stops),
            },
          ];
      const orders = await orderRows(c, { frDate: date, toDate: date });
      const seen = new Set<string>();
      const stops = teams.flatMap((t) =>
        rows(t.stops).map((s, i) => {
          const keys = Array.isArray(s.ocodekeys)
            ? s.ocodekeys.map(String)
            : [text(s.ocodekey ?? s.stopCode ?? s.key)].filter(Boolean);
          const selected = keys.map((key) => {
            const order = orders.find((o) => o.ocodekey === key);
            if (!order)
              throw new LiveError("배차 주문을 찾을 수 없습니다.", 422);
            if (seen.has(key))
              throw new LiveError("같은 주문을 중복 배차할 수 없습니다.", 422);
            seen.add(key);
            return order;
          });
          if (!selected.length)
            throw new LiveError("배송지에 주문을 선택해 주세요.", 422);
          return {
            ...s,
            key: text(s.key) || `${t.teamNo ?? 1}:${i + 1}`,
            stopCode: text(s.stopCode) || keys[0],
            ocodekeys: keys,
            vehicle: Number(t.teamNo ?? 1),
            teamNo: Number(t.teamNo ?? 1),
            teamName: text(t.teamName) || "배송팀",
            seq: i + 1,
            orderCount: selected.length,
            orders: selected,
            label:
              text(s.label ?? s.customerName) || text(selected[0].cust_name),
            addr: text(s.addr ?? s.address) || text(selected[0].addr),
            stopStatus: text(s.stopStatus) || "10",
          };
        }),
      );
      if (!stops.length) throw new LiveError("배송지를 선택해 주세요.", 422);
      const savedData: Doc = {
        ...data,
        planNo: undefined,
        deliveryDate: date,
        orderDate: date,
        teams,
        stops,
        distance: teams.reduce((n, t) => n + Number(t.distance ?? 0), 0),
        duration: teams.reduce((n, t) => n + Number(t.duration ?? 0), 0),
        planStatus: "10",
        stopCnt: stops.length,
        doneStopCnt: 0,
      };
      if (JSON.stringify(savedData).length > 200000)
        throw new LiveError("저장 내용이 너무 큽니다.", 413);
      const config = await setting(c, "delivery");
      const startOnSave =
        config.startOnSave === true || config.startOnSave === "Y";
      const selected = orders.filter((o) => seen.has(text(o.ocodekey)));
      const eligible = startOnSave
        ? selected.filter((o) => ["00", "10", "22"].includes(text(o.status)))
        : [];
      const skipped = {
        delivering: startOnSave
          ? selected.filter((o) => o.status === "24").length
          : 0,
        done: startOnSave
          ? selected.filter((o) => o.status === "30").length
          : 0,
        cancel: startOnSave
          ? selected.filter((o) => o.status === "40").length
          : 0,
      };
      const timestamp = now();
      const updates = eligible.map((o) =>
        c.db
          .prepare(
            "UPDATE of_orders SET status='24',revision=revision+1,updated_at=? WHERE shop=? AND (key=? OR merged_into=(SELECT id FROM of_orders WHERE shop=? AND key=?)) AND status IN ('00','10','22')",
          )
          .bind(timestamp, c.shop, o.ocodekey, c.shop, o.ocodekey),
      );
      const checks = eligible.map((o) => ({
        sql: "EXISTS(SELECT 1 FROM of_orders WHERE shop=? AND key=? AND revision=? AND status IN ('00','10','22'))",
        values: [c.shop, o.ocodekey, o.revision],
      }));
      const inserted = await transaction(
        c,
        [
          c.db
            .prepare(
              "INSERT INTO of_records(shop,kind,data,created_at,updated_at) VALUES(?,'delivery-plan',?,?,?)",
            )
            .bind(c.shop, JSON.stringify(savedData), timestamp, timestamp),
          ...updates,
        ],
        checks,
      );
      const planNo = Number(inserted[checks.length].meta.last_row_id);
      await audit(c, "delivery-plan", planNo);
      const saved = { ...savedData, id: planNo, revision: 1 };
      return {
        ...saved,
        planNo,
        orderCount: seen.size,
        statusChanged: eligible.length,
        startedCount: eligible.length,
        skipped,
      };
    }
    if (name === "progress") {
      const plans = await savedPlans(c, data);
      if (path.endsWith("/stops"))
        return plans.flatMap((p) =>
          rows(p.stops)
            .filter(
              (s) =>
                !data.teamNo ||
                Number(s.vehicle ?? s.teamNo ?? p.teamNo) ===
                  Number(data.teamNo),
            )
            .map((s) => ({
              ...s,
              planNo: p.planNo,
              teamNo: s.vehicle ?? s.teamNo ?? p.teamNo,
            })),
        );
      return plans.flatMap((p) => {
        const teams = rows(p.teams).length
          ? rows(p.teams)
          : [{ teamNo: p.teamNo ?? 1, teamName: p.teamName ?? "배송팀" }];
        return teams
          .filter(
            (t) => !data.teamNo || Number(t.teamNo) === Number(data.teamNo),
          )
          .map((t) => {
            const stops = rows(p.stops).filter(
              (s) =>
                Number(s.vehicle ?? s.teamNo ?? p.teamNo ?? 1) ===
                Number(t.teamNo),
            );
            return {
              ...p,
              ...t,
              stops,
              stopCnt: stops.length,
              doneStopCnt: stops.filter((s) => s.stopStatus === "30").length,
              orderCnt: stops.reduce(
                (n, s) => n + Number(s.orderCount ?? stopKeys(s).length),
                0,
              ),
            };
          });
      });
    }
    if (name === "share") {
      const plan = (await savedPlans(c, data)).find(
        (p) =>
          Number(p.planNo) === Number(data.planNo) &&
          (!data.orderDate || p.orderDate === data.orderDate),
      );
      if (!plan) throw new LiveError("배송 차수를 찾을 수 없습니다.", 404);
      const token = crypto.randomUUID().replaceAll("-", "");
      await put(
        c,
        "delivery-plan",
        {
          ...plan,
          shareToken: token,
          expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
        },
        Number(plan.id),
      );
      return { url: `${c.origin}/dispatch/${token}`, token };
    }
    if (name === "location")
      throw new LiveError(
        "외부 주소 좌표 변환은 지도 공급자 연결 후 사용할 수 있습니다.",
        503,
        "provider_not_configured",
      );
    if (name === "item-sum" || name === "item-stop") {
      const plans = rows(data.orders).length ? [] : await savedPlans(c, data);
      if (Number(data.planNo) && !plans.length && !rows(data.orders).length)
        throw new LiveError("저장된 배송 차수를 찾을 수 없습니다.", 404);
      const groups = plans.length
        ? plans.map((p) => ({ plan: p, stops: rows(p.stops) }))
        : [
            {
              plan: { planNo: 0, planStatus: "", teamNo: 0, teamName: "" },
              stops: [
                {
                  orders: rows(data.orders),
                  ocodekeys: rows(data.orders).map((o) => o.ocodekey),
                },
              ],
            },
          ];
      const result: Doc[] = [];
      for (const { plan, stops } of groups) {
        const keys = stops.flatMap(stopKeys);
        if (!keys.length) continue;
        const lines = await query(
          c,
          "SELECT i.*,COALESCE(p.key,o.key) order_key,COALESCE(p.status,o.status) order_status FROM of_order_items i JOIN of_orders o ON o.id=i.order_id LEFT JOIN of_orders p ON p.id=o.merged_into WHERE o.shop=? AND COALESCE(p.key,o.key) IN (SELECT value FROM json_each(?)) AND COALESCE(p.status,o.status)<>'40'",
          c.shop,
          JSON.stringify(keys),
        );
        const grouped = new Map<string, Doc>();
        for (const l of lines) {
          const stop = stops.find((s) =>
            stopKeys(s).includes(String(l.order_key)),
          );
          const teamNo = Number(
            stop?.vehicle ?? stop?.teamNo ?? plan.teamNo ?? 0,
          );
          const key = JSON.stringify([
            teamNo,
            l.name,
            l.unit,
            name === "item-stop" ? l.order_key : "",
          ]);
          const row = grouped.get(key) ?? {
            planNo: plan.planNo,
            teamNo,
            teamName: stop?.teamName ?? plan.teamName ?? "",
            planStatus: plan.planStatus,
            teamStopCnt: stops.filter(
              (s) => Number(s.vehicle ?? s.teamNo ?? 0) === teamNo,
            ).length,
            teamOrderCnt: stops
              .filter((s) => Number(s.vehicle ?? s.teamNo ?? 0) === teamNo)
              .reduce(
                (n, s) => n + Number(s.orderCount ?? rows(s.orders).length),
                0,
              ),
            catName: "",
            catRank: 0,
            iname: l.name,
            unit: l.unit,
            qty: 0,
            doneQty: 0,
            stopCode: l.order_key,
          };
          row.qty = Number(row.qty) + Number(l.quantity);
          if (l.order_status === "30")
            row.doneQty = Number(row.doneQty) + Number(l.quantity);
          grouped.set(key, row);
        }
        result.push(...grouped.values());
      }
      return result;
    }
  }
  if (path === "/event-calendar") return list(c, "calendar");
  if (path === "/event-calendar/save")
    return put(c, "calendar", data, Number(data.seqno ?? 0));
  if (path === "/deposit/list") return list(c, "deposit");
  if (path === "/deposit/manual")
    return put(c, "deposit", {
      ...data,
      tran_amt: integer(data.tran_amt, 1),
      source: "manual",
      matched: false,
    });
  if (path === "/deposit/match") {
    const deposit = (await list(c, "deposit")).find(
      (r) => r.id === Number(data.depositId),
    );
    if (!deposit || deposit.matched)
      throw new LiveError("입금 내역을 확인해 주세요.", 409);
    const order = await first(
      c,
      "SELECT * FROM of_orders WHERE shop=? AND key=?",
      c.shop,
      text(data.ocodekey),
    );
    if (
      !order ||
      amountDue({...order,data:parse(order.data)}) !== Number(deposit.tran_amt)
    )
      throw new LiveError("주문과 입금 금액이 다릅니다.", 409);
    if (order.status === "40" || order.ispaid === "Y" || order.merged_into)
      throw new LiveError("입금 확인할 수 없는 주문입니다.", 409);
    const linked = await first(
      c,
      "SELECT id FROM of_orders WHERE merged_into=?",
      order.id,
    );
    if (linked)
      throw new LiveError(
        "병합 주문은 선입금 원장으로 결제를 처리해 주세요.",
        409,
      );
    const next = { ...deposit, matched: true, ocodekey: order.key };
    await transaction(
      c,
      [
        c.db
          .prepare(
            "UPDATE of_orders SET ispaid='Y',revision=revision+1 WHERE shop=? AND id=?",
          )
          .bind(c.shop, order.id),
        c.db
          .prepare(
            "UPDATE of_records SET data=?,revision=revision+1,updated_at=? WHERE shop=? AND id=? AND kind='deposit'",
          )
          .bind(JSON.stringify(next), now(), c.shop, deposit.id),
      ],
      [
        {
          sql: "EXISTS(SELECT 1 FROM of_orders WHERE id=? AND shop=? AND revision=? AND ispaid='N' AND status<>'40')",
          values: [order.id, c.shop, order.revision],
        },
        {
          sql: "EXISTS(SELECT 1 FROM of_records WHERE id=? AND shop=? AND revision=? AND deleted=0)",
          values: [deposit.id, c.shop, deposit.revision],
        },
      ],
    );
    await audit(c, "deposit:match", order.key);
    return next;
  }
  return undefined;
}
