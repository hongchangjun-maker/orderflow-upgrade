export type MessageKind = "INFO" | "AD";

export const MESSAGE_VARIABLES = ["{상점명}", "{고객명}", "{주문번호}", "{주문링크}"] as const;
export const AD_HEAD = "(광고) ";
export const AD_TAIL = "(수신거부는 회신 부탁드립니다)";

export function applyAdvertisingRules(body: string) {
  const trimmed = body.trim();
  const withHead = trimmed.startsWith("(광고)") ? trimmed.replace(/^\(광고\)\s*/u, AD_HEAD) : `${AD_HEAD}${trimmed}`;
  return withHead.includes(AD_TAIL) ? withHead : `${withHead}\n${AD_TAIL}`;
}

export function renderMessageTemplate(body: string, values: Record<string, string>) {
  return MESSAGE_VARIABLES.reduce((result, variable) => result.split(variable).join(values[variable] ?? variable), body);
}

export function messageBytes(body: string) {
  return new TextEncoder().encode(body).byteLength;
}
