import { day, integer, LiveError, text, type Doc } from "./domain.ts";

export function reportDay(value: unknown): string {
  const stamp = text(value).replaceAll("-", "");
  if (!/^\d{8}$/u.test(stamp))
    throw new LiveError("조회 날짜를 확인해 주세요.", 422);
  const parsed = new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z`,
  );
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10).replaceAll("-", "") !== stamp
  )
    throw new LiveError("존재하지 않는 조회 날짜입니다.", 422);
  return stamp;
}

export function reportMonth(data: Doc, today = day()) {
  const candidate = text(
    data.yyyymm ??
      data.yearMonth ??
      data.year_month ??
      data.ym ??
      data.month_date ??
      (data.year != null
        ? `${data.year}${String(data.month ?? 1).padStart(2, "0")}`
        : data.month),
  );
  const month = candidate ? candidate.replaceAll("-", "") : today.slice(0, 6);
  if (
    !/^\d{6}$/u.test(month) ||
    Number(month.slice(4)) < 1 ||
    Number(month.slice(4)) > 12 ||
    Number(month.slice(0, 4)) < 1900
  )
    throw new LiveError("조회 연월을 확인해 주세요.", 422);
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)), 0),
  ).getUTCDate();
  return {
    month,
    from: `${month}01`,
    to: `${month}${String(last).padStart(2, "0")}`,
  };
}

export function reportRange(data: Doc, monthly = false, today = day()) {
  if (monthly || data.yyyymm || data.yearMonth || data.year_month || data.ym)
    return reportMonth(data, today);
  const from =
    data.frDate ??
    data.fr_date ??
    data.from_date ??
    data.from ??
    data.startDate;
  const to = data.toDate ?? data.to_date ?? data.to ?? data.endDate;
  const result = {
    from: from ? reportDay(from) : "00000000",
    to: to ? reportDay(to) : "99999999",
  };
  if (result.from > result.to)
    throw new LiveError("조회 시작일은 종료일 이후일 수 없습니다.", 422);
  return result;
}

export function reportPage(data: Doc, defaultSize = 5000, maximum = 5000) {
  const limit = integer(
    data.pageSize ?? data.size ?? data.limit ?? defaultSize,
    1,
    maximum,
  );
  const index =
    data.pageIndex != null
      ? integer(data.pageIndex, 0, 1000000)
      : Math.max(0, integer(data.page ?? 1, 0, 1000001) - 1);
  return { limit, offset: index * limit, pageIndex: index };
}

export function previousReportRange(from: string, to: string) {
  reportDay(from);
  reportDay(to);
  const first = new Date(
    `${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T00:00:00Z`,
  ).getTime();
  const last = new Date(
    `${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T00:00:00Z`,
  ).getTime();
  if (first > last) throw new LiveError("조회 기간을 확인해 주세요.", 422);
  const duration = last - first + 86400000;
  const stamp = (time: number) =>
    new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
  return { from: stamp(first - duration), to: stamp(first - 86400000) };
}

export function kstCreatedBounds(from: string, to: string) {
  const utc = (stamp: string, delta: number) =>
    new Date(
      Date.UTC(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8)),
        -9,
      ) + delta,
    ).toISOString();
  return {
    from: from === "00000000" ? "" : utc(reportDay(from), 0),
    to:
      to === "99999999"
        ? "9999-12-31T23:59:59.999Z"
        : utc(reportDay(to), 86400000),
  };
}

export function orderReportMoney(order: Doc, data: Doc = {}) {
  const gross = Number(order.amount ?? 0) + Number(order.fee ?? 0);
  const pointDisc = Number(data.point_used ?? data.point ?? 0);
  const adjust = Number(data.adjustment ?? 0);
  return { gross, pointDisc, adjust, total: gross - pointDisc + adjust };
}

const utcDay = (stamp: string) =>
  Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
  );
const stampOf = (time: number) =>
  new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
type ReportSum = { orderCnt: number; itemSales: number; total: number };
const sumRows = (rows: Doc[]): ReportSum =>
  rows.reduce<ReportSum>(
    (sum, r) => ({
      orderCnt: sum.orderCnt + Number(r.orderCnt ?? 0),
      itemSales: sum.itemSales + Number(r.itemSales ?? 0),
      total: sum.total + Number(r.total ?? 0),
    }),
    { orderCnt: 0, itemSales: 0, total: 0 },
  );
const difference = (current: number, previous: number) =>
  previous ? ((current - previous) / previous) * 100 : null;
const before = (left: string, right: string) => (left < right ? left : right);
function priorYearDate(stamp: string) {
  const year = Number(stamp.slice(0, 4)) - 1,
    month = Number(stamp.slice(4, 6)),
    last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}${stamp.slice(4, 6)}${String(Math.min(last, Number(stamp.slice(6, 8)))).padStart(2, "0")}`;
}

export function salesSeriesRange(data: Doc, today = day()) {
  const mode = text(data.mode) || "day";
  if (!["day", "month", "year"].includes(mode))
    throw new LiveError("매출 조회 단위를 확인해 주세요.", 422);
  let from: string, to: string;
  if (mode === "year") {
    from = `${Number(today.slice(0, 4)) - 4}0101`;
    to = today;
  } else {
    const month = Number(today.slice(4, 6)) - 1;
    const defaultFrom =
      mode === "day"
        ? `${today.slice(0, 6)}01`
        : stampOf(Date.UTC(Number(today.slice(0, 4)), month - 11, 1));
    from = reportDay(data.from ?? data.frDate ?? data.fr_date ?? defaultFrom);
    to = before(
      reportDay(data.to ?? data.toDate ?? data.to_date ?? today),
      today,
    );
  }
  if (from > to)
    throw new LiveError("조회 시작일은 종료일 이후일 수 없습니다.", 422);
  if (mode === "day" && (utcDay(to) - utcDay(from)) / 86400000 + 1 > 366)
    throw new LiveError("일별 조회는 최대 366일입니다.", 422);
  if (
    mode === "month" &&
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      Number(to.slice(4, 6)) -
      Number(from.slice(4, 6)) +
      1 >
      36
  )
    throw new LiveError("월별 조회는 최대 36개월입니다.", 422);
  return { mode, from, to };
}

export function salesSeries(
  daily: Doc[],
  mode: string,
  from: string,
  to: string,
) {
  const buckets = new Map<string, Doc[]>();
  const key = (stamp: string) =>
    mode === "year"
      ? stamp.slice(0, 4)
      : mode === "month"
        ? stamp.slice(0, 6)
        : stamp;
  for (const row of daily) {
    const stamp = text(row.date);
    if (stamp < from || stamp > to) continue;
    const bucket = key(stamp);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row]);
  }
  const labels = new Map<string, string>();
  for (let cursor = utcDay(from); cursor <= utcDay(to); cursor += 86400000) {
    const stamp = stampOf(cursor),
      bucket = key(stamp);
    if (labels.has(bucket)) continue;
    labels.set(
      bucket,
      mode === "year"
        ? `${bucket}년`
        : mode === "month"
          ? `${bucket.slice(0, 4)}.${bucket.slice(4, 6)}`
          : `${stamp.slice(4, 6)}.${stamp.slice(6, 8)} (${"일월화수목금토"[new Date(cursor).getUTCDay()]})`,
    );
  }
  let previous = 0;
  const rows = [...labels].map(([bucket, label]) => {
    const amount = sumRows(buckets.get(bucket) ?? []),
      end =
        mode === "year"
          ? `${bucket}1231`
          : mode === "month"
            ? reportMonth({ yyyymm: bucket }).to
            : bucket;
    const row = {
      bucket,
      label,
      ...amount,
      diffPct: difference(amount.itemSales, previous),
      partial: end > to,
      through: before(end, to),
    };
    previous = amount.itemSales;
    return row;
  });
  const maximum = rows.reduce<Doc | null>(
    (best, row) =>
      !best || row.itemSales > Number(best.itemSales) ? row : best,
    null,
  );
  return {
    mode,
    from,
    to,
    rows,
    sum: sumRows(rows),
    maxBucket: maximum?.bucket ?? null,
    fromCache: false,
    cachedAt: null,
  };
}

export function salesComparison(
  daily: Doc[],
  kind: string,
  base: string,
): Doc & {
  rows: Doc[];
  card: {
    curSum: number;
    prevSum: number;
    diffAmt: number;
    diffPct: number | null;
    orderCnt: number;
    prevOrderCnt: number;
    diffCnt: number;
    prevFrom: string;
    prevThrough: string;
  };
} {
  reportDay(base);
  if (!["dow", "month", "year"].includes(kind))
    throw new LiveError("매출 비교 단위를 확인해 주세요.", 422);
  const aggregate = (from: string, to: string) =>
    sumRows(daily.filter((r) => text(r.date) >= from && text(r.date) <= to));
  const year = Number(base.slice(0, 4)),
    prevBase = priorYearDate(base);
  const card = (
    cur: ReturnType<typeof sumRows>,
    prev: ReturnType<typeof sumRows>,
    prevFrom: string,
    prevThrough: string,
  ) => ({
    curSum: cur.itemSales,
    prevSum: prev.itemSales,
    diffAmt: cur.itemSales - prev.itemSales,
    diffPct: difference(cur.itemSales, prev.itemSales),
    orderCnt: cur.orderCnt,
    prevOrderCnt: prev.orderCnt,
    diffCnt: cur.orderCnt - prev.orderCnt,
    prevFrom,
    prevThrough,
  });
  if (kind === "dow") {
    const weekday = (new Date(utcDay(base)).getUTCDay() + 6) % 7,
      weekFrom = stampOf(utcDay(base) - weekday * 86400000),
      weekTo = stampOf(utcDay(weekFrom) + 6 * 86400000),
      previousFrom = stampOf(utcDay(weekFrom) - 7 * 86400000),
      previousThrough = stampOf(utcDay(base) - 7 * 86400000);
    const rows = Array.from({ length: 7 }, (_, index) => {
      const date = stampOf(utcDay(weekFrom) + index * 86400000),
        prevDate = stampOf(utcDay(date) - 7 * 86400000),
        cur = date <= base ? aggregate(date, date) : sumRows([]),
        prev = date <= base ? aggregate(prevDate, prevDate) : sumRows([]);
      return {
        dow: "월화수목금토일"[index],
        date,
        prevDate,
        cur: cur.itemSales,
        prev: prev.itemSales,
        diffPct: difference(cur.itemSales, prev.itemSales),
        orderCnt: cur.orderCnt,
        prevOrderCnt: prev.orderCnt,
      };
    });
    return {
      kind,
      weekFrom,
      weekTo,
      rows,
      card: card(
        aggregate(weekFrom, base),
        aggregate(previousFrom, previousThrough),
        previousFrom,
        previousThrough,
      ),
      fromCache: false,
      cachedAt: null,
    };
  }
  const current = aggregate(`${year}0101`, base),
    previous = aggregate(`${year - 1}0101`, prevBase),
    comparisonCard = card(current, previous, `${year - 1}0101`, prevBase);
  if (kind === "month") {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1,
        stamp = `${year}${String(month).padStart(2, "0")}`,
        range = reportMonth({ yyyymm: stamp }),
        through = before(range.to, base),
        isFuture = range.from > base,
        prevThrough = priorYearDate(through),
        prevFrom = `${year - 1}${String(month).padStart(2, "0")}01`;
      const cur = isFuture ? sumRows([]) : aggregate(range.from, through),
        prev = isFuture ? sumRows([]) : aggregate(prevFrom, prevThrough);
      return {
        month,
        cur: cur.itemSales,
        prev: prev.itemSales,
        diffPct: difference(cur.itemSales, prev.itemSales),
        orderCnt: cur.orderCnt,
        prevOrderCnt: prev.orderCnt,
        partial: month === Number(base.slice(4, 6)) && base < range.to,
        prevThrough,
      };
    });
    return {
      kind,
      year,
      prevYear: year - 1,
      through: base,
      rows,
      card: comparisonCard,
      fromCache: false,
      cachedAt: null,
    };
  }
  const rows = Array.from({ length: 5 }, (_, index) => {
    const selected = year - 4 + index,
      through = selected === year ? base : `${selected}1231`,
      cur = aggregate(`${selected}0101`, through),
      prevFull = aggregate(`${selected - 1}0101`, `${selected - 1}1231`),
      prevSame = aggregate(`${selected - 1}0101`, priorYearDate(through));
    return {
      year: selected,
      itemSales: cur.itemSales,
      total: cur.total,
      prevFullYear: prevFull.itemSales,
      diffPct: difference(
        cur.itemSales,
        selected === year ? prevSame.itemSales : prevFull.itemSales,
      ),
      orderCnt: cur.orderCnt,
      partial: selected === year && base < `${year}1231`,
      through,
      samePeriod: { prev: prevSame.itemSales, prevOrderCnt: prevSame.orderCnt },
    };
  });
  return {
    kind,
    fromYear: year - 4,
    toYear: year,
    rows,
    card: comparisonCard,
    fromCache: false,
    cachedAt: null,
  };
}
