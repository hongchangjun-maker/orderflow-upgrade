import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogActive,
  catalogHub,
  catalogImportRange,
  catalogState,
} from "../app/modules/live/catalog-rules.ts";

test("catalog activation honors explicit inactive creation", () => {
  assert.equal(catalogActive("N"), 0);
  assert.equal(catalogActive("Y"), 1);
  assert.equal(catalogActive(undefined), 1);
});

test("catalog dates use Korean local time, including closing minute", () => {
  const form = {
    use_gbn: "Y",
    open_date: "20261116",
    open_time: "0900",
    expire_date: "20261116",
    expire_time: "1000",
  };
  assert.equal(
    catalogState(form, new Date("2026-11-15T23:59:59Z")).status,
    "SOON",
  );
  assert.equal(
    catalogState(form, new Date("2026-11-16T00:00:00Z")).status,
    "LIVE",
  );
  assert.equal(
    catalogState(form, new Date("2026-11-16T01:00:59Z")).status,
    "LIVE",
  );
  assert.equal(
    catalogState(form, new Date("2026-11-16T01:01:00Z")).status,
    "DONE",
  );
  assert.equal(
    catalogState({ ...form, use_gbn: "N" }, new Date("2026-11-16T00:30:00Z"))
      .status,
    "OFF",
  );
});

test("catalog hub retains active rows and pages only recent rows", () => {
  const at = new Date("2026-11-16T00:30:00Z");
  const forms = [
    { uocode: 1, use_gbn: "Y" },
    { uocode: 2, use_gbn: "N" },
    { uocode: 3, use_gbn: "Y", expire_date: "20261115" },
    { uocode: 4, use_gbn: "N" },
  ];
  assert.deepEqual(
    catalogHub(forms, { recent: 1, page: 0 }, at).rows.map((f) => f.uocode),
    [1, 2],
  );
  assert.deepEqual(
    catalogHub(forms, { recent: 1, page: 1 }, at).rows.map((f) => f.uocode),
    [1, 3],
  );
  assert.equal(catalogHub(forms, { recent: 1 }, at).totalCnt, 3);
  assert.deepEqual(
    catalogHub(forms, { recent: 10, useOnly: "Y" }, at).rows.map(
      (f) => f.uocode,
    ),
    [1, 3],
  );
  assert.equal(catalogHub(forms, { recent: 0, page: -1 }, at).rows.length, 2);
});

test("catalog date import range preserves explicit bounds and rejects reversals", () => {
  assert.deepEqual(catalogImportRange("2026-11-01", "20261116"), {
    from: "20261101",
    to: "20261116",
  });
  assert.deepEqual(catalogImportRange(undefined, undefined), {
    from: "00000000",
    to: "99999999",
  });
  assert.throws(() => catalogImportRange("20261117", "20261116"));
  assert.throws(() => catalogImportRange("invalid", "20261116"));
  assert.throws(() => catalogImportRange("20260230", "20261116"));
});
