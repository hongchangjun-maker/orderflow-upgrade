import { LiveError, obj, text, type Doc } from "./domain.ts";

export const chatDefaults = {
  enabled: true,
  bizHours: { from: "09:00", to: "18:00", days: "YYYYYNN" },
  autoReplyOffHours: false,
  autoReplyText: "",
  notifyPc: false,
  notifyApp: false,
  greeting: "",
};

/** Missing legacy settings remain usable; an explicit disabled setting is binding. */
export function chatSettings(value: unknown) {
  const data = obj(value);
  return {
    enabled: data.enabled !== false,
    bizHours: { ...chatDefaults.bizHours, ...obj(data.bizHours) },
    autoReplyOffHours: data.autoReplyOffHours === true,
    autoReplyText: text(data.autoReplyText, 5000),
    notifyPc: data.notifyPc === true,
    notifyApp: data.notifyApp === true,
    greeting: text(data.greeting, 5000),
  };
}

export function validateChatSettings(data: Doc) {
  for (const name of ["enabled", "autoReplyOffHours", "notifyPc", "notifyApp"])
    if (data[name] != null && typeof data[name] !== "boolean")
      throw new LiveError("채팅 설정 값을 확인해 주세요.", 422);
  const result = chatSettings(data);
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/u.test(text(result.bizHours.from)) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/u.test(text(result.bizHours.to)) ||
    !/^[YN]{7}$/u.test(text(result.bizHours.days))
  ) throw new LiveError("영업시간과 요일을 확인해 주세요.", 422);
  if (result.autoReplyOffHours && !result.autoReplyText)
    throw new LiveError("영업시간 외 자동응답 내용을 입력해 주세요.", 422);
  return result;
}

/** Source weekday mask is Monday first. Korea wall-clock time is not host time. */
export function chatIsOpen(settings: ReturnType<typeof chatSettings>, at: Date) {
  const kst = new Date(at.getTime() + 9 * 3600000);
  const weekday = (kst.getUTCDay() + 6) % 7;
  const { from, to, days } = settings.bizHours;
  if (String(days)[weekday] !== "Y") return false;
  if (from === to) return true;
  const time = `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
  return String(from) < String(to)
    ? time >= String(from) && time < String(to)
    : time >= String(from) || time < String(to);
}

export function chatAutoReply(settings: ReturnType<typeof chatSettings>, at: Date) {
  return settings.enabled && settings.autoReplyOffHours && !chatIsOpen(settings, at)
    ? settings.autoReplyText : "";
}

export function requireChatEnabled(value: unknown) {
  const settings = chatSettings(value);
  if (!settings.enabled)
    throw new LiveError("매장에서 고객 채팅을 잠시 중지했습니다.", 403, "chat_disabled");
  return settings;
}
