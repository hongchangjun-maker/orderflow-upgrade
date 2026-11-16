import { clearedSessionCookie } from "../../lib/auth";
import { getD1 } from "../../lib/data";
import { sha256Hex } from "../../lib/security";
import {cookieValue,clearCookie} from './credentials';
import { context, authorize } from "./context";
import { accountsApi, liveLogin } from "./accounts";
import { customerAccessApi } from "./customer-access";
import { communicationsApi } from "./communications";
import { customerRows, customersApi } from "./customers";
import { dashboardApi } from "./dashboard";
import { integer, LiveError, obj, text, type Doc } from "./domain";
import { formList, formsApi, saveForm } from "./forms";
import { mediaApi, upload } from "./media";
import { operationsApi } from "./operations";
import { ordersApi } from "./orders";
import { first, list, query } from "./store";
export const success = (data: unknown) =>
  Response.json(
    { success: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
export function failure(error: unknown) {
  if (error instanceof LiveError)
    return Response.json(
      { success: false, error: { code: error.code, message: error.message },...(error.details!==undefined?{data:error.details}:{}) },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  const message = String(error);
  if (/D1.*(?:overloaded|transient issue|storage operation exceeded timeout)/iu.test(message))
    return Response.json({success:false,error:{code:'temporarily_busy',message:'주문이 몰려 잠시 대기 중입니다. 같은 주문을 다시 제출해도 중복 접수되지 않습니다.'}},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'12'}});
  if (
    /stock|insufficient_balance|completed_order_is_final|cancelled_order_is_final|prepay_payment_is_final|point_earned_payment_is_final|invalid_point_amount|UNIQUE/u.test(
      message,
    )
  )
    return Response.json(
      {
        success: false,
        error: {
          code: "conflict",
          message: message.includes("balance")
            ? "잔액이 부족하거나 이미 처리된 거래입니다."
            : message.includes("stock")
              ? "재고가 변경되었습니다. 다시 확인해 주세요."
              : "중복 또는 완료된 처리입니다.",
        },
      },
      { status: 409 },
    );
  console.error(
    JSON.stringify({ event: "live_api_error", message: message.slice(0, 300) }),
  );
  return Response.json(
    {
      success: false,
      error: {
        code: "server_error",
        message: "처리를 완료하지 못했습니다. 다시 시도해 주세요.",
      },
    },
    { status: 500 },
  );
}
export async function readInput(
  request: Request,
  max = 65536,
): Promise<unknown> {
  if (!request.body) return {};
  const reader = request.body.getReader();
  let length = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > max) {
      await reader.cancel();
      throw new LiveError("요청 내용이 너무 큽니다.", 413);
    }
    parts.push(part.value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    buffer.set(p, offset);
    offset += p.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new LiveError("유효한 JSON이 아닙니다.", 400);
  }
}
export async function liveApi(request: Request) {
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\/replica/u, "") || "/",
      method = request.method;
    const mutation = !["GET", "HEAD"].includes(method);
    if (
      !mutation &&
      !path.startsWith("/delivery-fee/") &&
      ![
        "/urlorder-v2/hub",
        "/fee/list",
        "/notice/list",
        "/auth/login-popup",
        "/inquiry/unread-count",
        "/inquiry/list",
        "/inquiry/messages",
        "/inquiry/admin/list",
        "/inquiry/admin/messages",
      ].includes(path) &&
      !/^(?:\/session|\/workspace|\/events|\/account\/perms(?:\/mine)?|\/staff|\/shop-setting(?:\/logo(?:\/draft|\/preview-info)?)?|\/urlorders\/setting\/\d+|\/urlorders\/list|\/orders\/(?:url-orders|delivery-methods|pay-methods|compute-delivery-amt|share-link)|\/dashboard\/[a-z-]+|\/customers\/(?:stats|book|search|monthly-sales|month-orders|order-items|block(?:\/setting|\/mobiles)?|(?:point|prepayment)\/(?:history|balance))|\/chat\/(?:settings|unread|quick-replies|rooms(?:\/\d+(?:\/messages)?)?)|\/sms\/(?:history(?:\/\d+)?|stats|info|templates(?:\/\d+)?|block(?:\/log)?|address\/(?:groups|contacts)(?:\/\d+)?|charge\/history)|\/images(?:\/folders)?|\/badges|\/delivery-fee\/(?:fees|shop-city)|\/delivery-route\/(?:setting|teams|origins|progress(?:\/stops)?)|\/recurring-orders\/(?:summary|detail\/\d+|urlorder-items\/\d+)|\/event-calendar)$/u.test(
        path,
      )
    )
      throw new LiveError(
        "이 경로는 조회 요청으로 실행할 수 없습니다.",
        405,
        "method_not_allowed",
      );
    if (mutation) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new LiveError("허용되지 않은 요청 출처입니다.", 403);
      if (request.headers.get("x-orderflow-request") !== "1")
        throw new LiveError("요청 확인 헤더가 필요합니다.", 403);
    }
    if (path === "/logout" || path === "/auth/logout") {
      const ownerToken=cookieValue(request,'orderflow_owner');
      if(ownerToken)await getD1().prepare('DELETE FROM of_owner_sessions WHERE hash=?').bind(await sha256Hex(ownerToken)).run();
      const token = request.headers
        .get("cookie")
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("orderflow_staff="))
        ?.slice(16);
      if (token)
        await getD1()
          .prepare("DELETE FROM of_sessions WHERE hash=?")
          .bind(await sha256Hex(token))
          .run();
      const headers = new Headers({ "Cache-Control": "no-store" });
      headers.append("Set-Cookie", clearedSessionCookie());
      headers.append('Set-Cookie',clearCookie('orderflow_owner'));
      headers.append(
        "Set-Cookie",
        "orderflow_staff=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      );
      return new Response(
        JSON.stringify({ success: true, data: { loggedOut: true } }),
        { headers },
      );
    }
    const isUpload =
      ["/images/upload", "/chat/upload", "/shop-setting/logo"].includes(path) &&
      method === "POST" &&
      request.headers.get("content-type")?.includes("multipart/form-data");
    const raw = mutation && !isUpload ? await readInput(request) : {};
    const data: Doc = { ...Object.fromEntries(url.searchParams), ...obj(raw) };
    if (path === "/login" || path === "/auth/login")
      return await liveLogin(request, data);
    const c = await context(request);
    authorize(c, path, method);
    if (path === "/workspace") {
      const session = await accountsApi(c, "/session", "GET", {});
      return success({
        ...session,
        forms: await formList(c),
        customers: await customerRows(c),
        staff:
          c.role === "OWNER" ? await accountsApi(c, "/staff", "GET", {}) : [],
        plans: await list(c, "delivery-plan"),
        deposits: await list(c, "deposit"),
      });
    }
    if (path === "/workspace/form") {
      const items = text(data.itemsText, 30000)
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => {
          const [iname, unit, cost, stock] = line
            .split("|")
            .map((s) => s.trim());
          return {
            iname,
            unit: unit || "개",
            cost: integer(cost),
            stock: integer(stock, 0, 999999),
            seqno: 0,
            disp_gbn: "Y",
          };
        });
      if (!items.length) throw new LiveError("품목을 입력해 주세요.", 422);
      return success(
        await saveForm(c, {
          title: data.title,
          notice: data.notice,
          shipping_fee: integer(data.shippingFee ?? 0),
          items,
          url_gbn: "V3",
          use_gbn: "Y",
          delivery_deliver: "Y",
          delivery_pickup: "Y",
          pay_tran: "Y",
        }),
      );
    }
    if (isUpload) return success(await upload(c, request));
    if (path === "/events") {
      const after = Number(data.after ?? 0);
      const events = await query(
        c,
        "SELECT id,kind,entity,created_at FROM of_changes WHERE shop=? AND id>? ORDER BY id LIMIT 500",
        c.shop,
        after,
      );
      return success({ events, cursor: events.at(-1)?.id ?? after });
    }
    if (
      /\/cashreceipt|\/sms\/(send|charge)$|\/share\/alimtalk|\/fee\/extend|\/easyfin|\/auth\/(join|reset)|\/config\/telegram/u.test(
        path,
      )
    )
      throw new LiveError(
        "외부 공급자 연결 대기입니다. 실제 발송·발행·결제는 실행되지 않았습니다.",
        503,
        "provider_not_configured",
      );
    if (path === "/fee/list")
      return success({ fees: [], details: [], configured: false });
    if (path.startsWith("/shop-setting/logo")) {
      const value = await first(
        c,
        "SELECT data FROM of_records WHERE shop=? AND kind='image' AND deleted=0 ORDER BY id DESC LIMIT 1",
        c.shop,
      );
      return success({
        url: value ? JSON.parse(String(value.data)).file_name_thumb : null,
      });
    }
    const handlers = [
      accountsApi,
      customerAccessApi,
      formsApi,
      ordersApi,
      customersApi,
      operationsApi,
      communicationsApi,
      mediaApi,
    ];
    for (const handler of handlers) {
      const result = await handler(c, path, method, data, raw);
      if (result !== undefined) return success(result);
    }
    const dashboard = await dashboardApi(c, path, data);
    if (dashboard !== undefined) return success(dashboard);
    throw new LiveError(
      `지원하지 않는 업무 요청입니다: ${text(path, 100)}`,
      404,
      "route_not_found",
    );
  } catch (error) {
    return failure(error);
  }
}
