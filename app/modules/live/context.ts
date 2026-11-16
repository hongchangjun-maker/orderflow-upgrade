import { getAdminUser } from "../../lib/auth";
import { getD1 } from "../../lib/data";
import { sha256Hex } from "../../lib/security";
import { LiveError } from "./domain";
import { parse, type LiveContext } from "./store";
import {ownerSession} from './owner-auth';
import {publicTestEnabled} from './test-mode';
const initializedShops = new Set<string>();
export async function context(request: Request): Promise<LiveContext> {
  const db = getD1();
  const staffToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("orderflow_staff="))
    ?.slice(16);
  if (staffToken) {
    const user = await db
      .prepare(
        "SELECT u.shop,u.login,u.role,u.permissions FROM of_sessions s JOIN of_staff u ON s.staff_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.active=1",
      )
      .bind(await sha256Hex(staffToken), new Date().toISOString())
      .first<{
        shop: string;
        login: string;
        role: string;
        permissions: string;
      }>();
    if(user&&parse(user.permissions).testMode===true&&!publicTestEnabled())throw new LiveError('테스트 접속이 종료되었습니다.',401,'unauthenticated');
    if (user)
      return {
        db,
        shop: user.shop,
        actor: user.login,
        role: user.role,
        permissions: parse(user.permissions),
        origin: new URL(request.url).origin,
      };
    throw new LiveError("직원 세션이 만료되었습니다.", 401);
  }
  const owner=await ownerSession(request,db);if(owner)return owner;
  const admin = await getAdminUser();
  if (admin) {
    if(await db.prepare('SELECT email FROM of_owner_credentials WHERE email=?').bind(admin.email).first())throw new LiveError('새 운영 비밀번호로 다시 로그인해 주세요.',401);
    const shop = (await sha256Hex(`orderflow-live-shop:${admin.email}`)).slice(
      0,
      32,
    );
    if (!initializedShops.has(shop)) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO of_shops(id,owner,name,created_at) VALUES(?,?,?,?)",
        )
        .bind(shop, admin.email, "내 상점", new Date().toISOString())
        .run();
      initializedShops.add(shop);
      if (initializedShops.size > 1000) initializedShops.clear();
    }
    return {
      db,
      shop,
      actor: admin.email,
      role: "OWNER",
      permissions: {},
      origin: new URL(request.url).origin,
    };
  }
  throw new LiveError("로그인이 필요합니다.", 401, "unauthenticated");
}
export function authorize(c: LiveContext, path: string, method: string) {
  if (c.role === "OWNER") return;
  if (
    path === "/session" ||
    path === "/auth/change-password" ||
    path === "/account/perms/mine" ||
    path === "/events"
  )
    return;
  if (path === "/workspace" || path === "/workspace/form")
    throw new LiveError("사장님 전용 업무 설정입니다.", 403);
  const permission = /ledger|prepayment|\/point\/|prepay-deduct|\/customers\/access-link/u.test(path)
    ? "PREPAY_POINT"
    : path.startsWith("/orders") || path.startsWith("/delivery-route")
      ? "ORDER_OPS"
      : path.startsWith("/customers")
        ? "CUSTOMER_OPS"
        : path.startsWith("/dashboard")
          ? "SALES_VIEW"
          : path.startsWith("/chat")
            ? "CHAT_OPS"
            : "MANAGE";
  if (c.permissions[permission] !== true)
    throw new LiveError("이 기능을 사용할 권한이 없습니다.", 403);
  if (
    (path.startsWith("/account") ||
      path.startsWith("/staff") ||
      path.startsWith("/shop-setting")) &&
    method !== "GET"
  )
    throw new LiveError("사장님만 변경할 수 있습니다.", 403);
}
