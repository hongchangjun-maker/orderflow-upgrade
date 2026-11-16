import assert from "node:assert/strict";
import test from "node:test";
import {
  reportMonth,
  reportRange,
  reportPage,
  previousReportRange,
  kstCreatedBounds,
  orderReportMoney,
  salesSeriesRange,
  salesSeries,
  salesComparison,
} from "../app/modules/live/report-rules.ts";

test("monthly reports accept source yyyymm and leap-year month ends", () => {
  assert.deepEqual(reportMonth({ yyyymm: "2024-02" }), {
    month: "202402",
    from: "20240201",
    to: "20240229",
  });
  assert.deepEqual(reportMonth({ year: 2026, month: 11 }), {
    month: "202611",
    from: "20261101",
    to: "20261130",
  });
  assert.deepEqual(reportMonth({}, "20260101"), {
    month: "202601",
    from: "20260101",
    to: "20260131",
  });
  for (const yyyymm of ["202613", "202600", "bad", "20261116"])
    assert.throws(() => reportMonth({ yyyymm }));
});
test("report dates validate real calendar dates and reversed periods", () => {
  assert.deepEqual(
    reportRange({ frDate: "2026-11-01", toDate: "2026-11-16" }),
    { from: "20261101", to: "20261116" },
  );
  assert.throws(() => reportRange({ frDate: "2026-02-30" }));
  assert.throws(() => reportRange({ frDate: "20261116", toDate: "20261101" }));
  assert.deepEqual(previousReportRange("20260301", "20260303"), {
    from: "20260226",
    to: "20260228",
  });
});
test("created-at filters use Seoul midnight rather than UTC day", () => {
  assert.deepEqual(kstCreatedBounds("20261116", "20261116"), {
    from: "2026-11-15T15:00:00.000Z",
    to: "2026-11-16T15:00:00.000Z",
  });
});
test("pagination is explicit and bounded, not a post-query search cap", () => {
  assert.deepEqual(reportPage({ page: 2, size: 100 }), {
    limit: 100,
    offset: 100,
    pageIndex: 1,
  });
  assert.deepEqual(reportPage({ pageIndex: 2, pageSize: 20 }), {
    limit: 20,
    offset: 40,
    pageIndex: 2,
  });
  assert.throws(() => reportPage({ size: 5001 }));
});
test("order totals subtract canonical points once and include signed adjustments", () => {
  assert.deepEqual(
    orderReportMoney(
      { amount: 10000, fee: 3000 },
      { point_used: 1000, point: 9999, adjustment: -500 },
    ),
    { gross: 13000, pointDisc: 1000, adjust: -500, total: 11500 },
  );
  assert.equal(
    orderReportMoney({ amount: 10000, fee: 0 }, { point: 1000 }).total,
    9000,
  );
});
test("series restores source bucket contracts and filters before aggregation", () => {
  const data = [
    { date: "20261101", orderCnt: 2, itemSales: 20000, total: 22000 },
    { date: "20261102", orderCnt: 1, itemSales: 10000, total: 9000 },
    { date: "20261031", orderCnt: 99, itemSales: 990000, total: 990000 },
  ];
  const result = salesSeries(data, "day", "20261101", "20261103");
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].bucket, "20261101");
  assert.equal(result.maxBucket, "20261101");
  assert.equal(result.rows[2].itemSales, 0);
  assert.deepEqual(result.sum, { orderCnt: 3, itemSales: 30000, total: 31000 });
  assert.equal(result.rows[0].diffPct, null);
  assert.equal(result.rows[1].diffPct, -50);
  assert.deepEqual(salesSeriesRange({ mode: "month" }, "20261116"), {
    mode: "month",
    from: "20251201",
    to: "20261116",
  });
  assert.throws(() =>
    salesSeriesRange(
      { mode: "day", from: "20200101", to: "20261116" },
      "20261116",
    ),
  );
});
test("compare uses product revenue and matched elapsed periods with leap-day handling", () => {
  const rows = [
    { date: "20240229", orderCnt: 1, itemSales: 100, total: 9999 },
    { date: "20230228", orderCnt: 2, itemSales: 50, total: 1 },
    { date: "20230301", orderCnt: 20, itemSales: 800, total: 800 },
  ];
  const result = salesComparison(rows, "month", "20240229");
  assert.equal(result.card.curSum, 100);
  assert.equal(result.card.prevSum, 50);
  assert.equal(result.card.diffPct, 100);
  assert.equal(result.card.prevThrough, "20230228");
  const year = salesComparison(rows, "year", "20240229");
  assert.equal(year.rows.length, 5);
  assert.equal(year.rows.at(-1)?.partial, true);
  const week = salesComparison(
    [
      { date: "20261116", itemSales: 20, orderCnt: 1 },
      { date: "20261109", itemSales: 10, orderCnt: 1 },
    ],
    "dow",
    "20261116",
  );
  assert.equal(week.weekFrom, "20261116");
  assert.equal(week.rows[0].cur, 20);
  assert.equal(week.rows[0].prev, 10);
  assert.equal(week.rows[1].cur, 0);
});
