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
import { createLiveOrder, orderRows } from "./orders";
import { nextSchedule } from "./schedule";
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
    const master:Doc = { ...parse(row.data), revision: row.revision };
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
  if (path === "/recurring-orders/list")
    return (await list(c, "recurring"))
      .map((r): Doc => ({ ...r, rocode: r.id }))
      .filter((r) => !data.status || r.status === data.status);
  if (path === "/recurring-orders/summary") {
    const all = await list(c, "recurring");
    return {
      active_count: all.filter((r) => r.status === "active").length,
      paused_count: all.filter((r) => r.status === "paused").length,
      this_week_count: all.filter(
        (r) =>
          r.status === "active" &&
          text(r.next_order_date) <= day(new Date(Date.now() + 7 * 86400000)),
      ).length,
      this_month_count: all.filter((r) =>
        text(r.last_generated_at).startsWith(
          new Date().toISOString().slice(0, 7),
        ),
      ).length,
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
        { value: "direct", label: "직배송" },
        { value: "pickup", label: "픽업" },
      ],
      payOptions: [{ value: "transfer", label: "계좌이체" }],
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
    if (name === "preview" || name === "plan-detail") {
      const orders = await orderRows(c, {
        frDate: data.orderDate,
        toDate: data.orderDate,
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
            !Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lon)),
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
      const stops = rows(data.stops);
      if (!stops.length) throw new LiveError("배송지를 선택해 주세요.", 422);
      return put(c, "delivery-plan", {
        ...data,
        stops,
        orderDate: text(data.orderDate) || day(),
        planNo: Number(data.planNo ?? 1),
        teamNo: Number(data.teamNo ?? 1),
        teamName: text(data.teamName) || "배송팀",
        planStatus: "10",
        stopCnt: stops.length,
        doneStopCnt: 0,
      });
    }
    if (name === "progress") {
      const plans = await list(c, "delivery-plan");
      if (path.endsWith("/stops"))
        return plans
          .filter((p) => !data.orderDate || p.orderDate === data.orderDate)
          .flatMap((p) => rows(p.stops));
      return plans.filter(
        (p) => !data.orderDate || p.orderDate === data.orderDate,
      );
    }
    if (name === "share") {
      const plan = (await list(c, "delivery-plan")).find(
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
    if (name === "item-sum" || name === "item-stop")
      return (
        await orderRows(c, { frDate: data.orderDate, toDate: data.orderDate })
      ).map((o) => ({
        iname: o.item_summary,
        qty: o.tqty,
        orderno: o.orderno,
        stopCode: o.ocodekey,
      }));
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
      Number(order.amount) + Number(order.fee) !== Number(deposit.tran_amt)
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
