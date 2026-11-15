import { LiveError, text, type Doc } from "./domain.ts";
export function nextSchedule(master: Doc, after: string) {
  const start = text(master.start_date).replaceAll("-", "");
  if (!/^\d{8}$/u.test(after) || !/^\d{8}$/u.test(start))
    throw new LiveError("일정 날짜를 확인해 주세요.", 422);
  const date = new Date(
    `${after.slice(0, 4)}-${after.slice(4, 6)}-${after.slice(6, 8)}T12:00:00Z`,
  );
  const anchor = new Date(
    `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T12:00:00Z`,
  ).getTime();
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(anchor))
    throw new LiveError("일정 날짜를 확인해 주세요.", 422);
  const type = text(master.schedule_type);
  if (!["weekly", "biweekly", "monthly"].includes(type))
    throw new LiveError("반복 주기를 확인해 주세요.", 422);
  let raw: unknown;
  try {
    raw = Array.isArray(master.schedule_days)
      ? master.schedule_days
      : JSON.parse(text(master.schedule_days));
  } catch {
    raw = [];
  }
  const chosen = Array.isArray(raw) ? raw.map(String) : [];
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  if (
    !chosen.length ||
    chosen.some((v) =>
      type === "monthly"
        ? !/^([1-9]|[12]\d|3[01])$/u.test(v)
        : !keys.includes(v),
    )
  )
    throw new LiveError("반복 요일 또는 날짜를 선택해 주세요.", 422);
  for (let i = 0; i < 370; i++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
    if (stamp < start) continue;
    const valid =
      type === "monthly"
        ? chosen.includes(String(date.getUTCDate()))
        : chosen.includes(keys[date.getUTCDay()]) &&
          (type !== "biweekly" ||
            Math.floor((date.getTime() - anchor) / 604800000) % 2 === 0);
    if (valid) return stamp;
  }
  throw new LiveError("반복 일정을 계산할 수 없습니다.", 422);
}
