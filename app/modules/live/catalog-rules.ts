import { LiveError, text, type Doc } from "./domain.ts";

export type CatalogStatus = "LIVE" | "SOON" | "DONE" | "OFF";

export const catalogActive = (value: unknown): 0 | 1 =>
  text(value).toUpperCase() === "N" ? 0 : 1;

function minuteOf(value: unknown, clock: unknown, closing = false) {
  const date = text(value).replaceAll("-", "");
  const time = text(clock || (closing ? "2359" : "0000")).replaceAll(":", "");
  if (!/^\d{8}$/u.test(date) || !/^([01]\d|2[0-3])[0-5]\d$/u.test(time))
    return null;
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(4, 6)),
    day = Number(date.slice(6, 8));
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (
    valid.getUTCFullYear() !== year ||
    valid.getUTCMonth() !== month - 1 ||
    valid.getUTCDate() !== day
  )
    return null;
  return (
    Date.UTC(
      year,
      month - 1,
      day,
      Number(time.slice(0, 2)) - 9,
      Number(time.slice(2, 4)),
    ) + (closing ? 59999 : 0)
  );
}

function instantOf(value: unknown) {
  if (!text(value)) return null;
  const result = Date.parse(text(value));
  return Number.isFinite(result) ? result : null;
}

export function catalogState(
  form: Doc,
  at = new Date(),
): {
  status: CatalogStatus;
  section: "LIVE" | "RECENT";
  close_min: number | null;
  remain_min: number | null;
} {
  const time = at.getTime();
  const open =
    instantOf(form.open_at) ?? minuteOf(form.open_date, form.open_time);
  const close =
    instantOf(form.close_at) ??
    minuteOf(form.expire_date, form.expire_time, true);
  const status: CatalogStatus = !catalogActive(form.use_gbn)
    ? "OFF"
    : open != null && time < open
      ? "SOON"
      : close != null && time > close
        ? "DONE"
        : "LIVE";
  const remaining =
    close == null ? null : Math.max(0, Math.ceil((close - time) / 60000));
  return {
    status,
    section: status === "LIVE" || status === "SOON" ? "LIVE" : "RECENT",
    close_min: remaining,
    remain_min: remaining,
  };
}

const bounded = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
};

/** Active/soon forms stay visible; only the recent-history section is paginated. */
export function catalogHub(forms: Doc[], query: Doc = {}, at = new Date()) {
  const filtered = forms
    .filter(
      (form) => query.useOnly !== "Y" || catalogActive(form.use_gbn) === 1,
    )
    .map((form): Doc & ReturnType<typeof catalogState> => ({
      ...form,
      ...catalogState(form, at),
    }));
  const active = filtered.filter((form) => form.section === "LIVE");
  const history = filtered.filter((form) => form.section === "RECENT");
  const size = bounded(query.recent ?? query.pageSize ?? 20, 20, 1, 2000);
  const page = bounded(query.page ?? 0, 0, 0, 100000);
  return {
    rows: [...active, ...history.slice(page * size, (page + 1) * size)],
    totalCnt: history.length,
    liveCnt: active.length,
    totalCount: filtered.length,
  };
}

export function catalogImportRange(fromValue: unknown, toValue: unknown) {
  const from = text(fromValue).replaceAll("-", "") || "00000000";
  const to = text(toValue).replaceAll("-", "") || "99999999";
  if (
    !/^\d{8}$/u.test(from) ||
    !/^\d{8}$/u.test(to) ||
    from > to ||
    (from !== "00000000" && minuteOf(from, "0000") == null) ||
    (to !== "99999999" && minuteOf(to, "0000") == null)
  )
    throw new LiveError("품목을 불러올 시작일과 종료일을 확인해 주세요.", 422);
  return { from, to };
}
