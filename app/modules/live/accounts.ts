import {
  allowedAdminEmails,
  clearedSessionCookie,
  createAdminSession,
  sessionCookie,
  verifyAdminPassword,
} from "../../lib/auth";
import { getD1 } from "../../lib/data";
import { scopedFingerprint, sha256Hex } from "../../lib/security";
import { integer, LiveError, required, text, type Doc } from "./domain";
import {
  audit,
  first,
  now,
  parse,
  query,
  setting,
  type LiveContext,
} from "./store";
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function passwordHash(
  password: string,
  salt = crypto.randomUUID(),
) {
  if (password.length < 10 || password.length > 128)
    throw new LiveError("비밀번호는 10~128자로 설정해 주세요.", 422);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  return `${salt}:${hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256))}`;
}
async function verify(password: string, stored: string) {
  try {
    const actual = await passwordHash(password, stored.split(":")[0]);
    if (actual.length !== stored.length) return false;
    let delta = 0;
    for (let i = 0; i < actual.length; i++)
      delta |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
    return delta === 0;
  } catch {
    return false;
  }
}
export async function liveLogin(request: Request, data: Doc) {
  const db = getD1();
  const login = required(
    data.email ?? data.userid,
    "아이디",
    160,
  ).toLowerCase();
  const password = text(data.password, 128);
  const fingerprint = await scopedFingerprint(request, `live-login:${login}`);
  const recent = await db
    .prepare(
      "SELECT COUNT(*) n FROM admin_login_attempts WHERE fingerprint=? AND created_at>?",
    )
    .bind(fingerprint, new Date(Date.now() - 900000).toISOString())
    .first<{
      n: number;
    }>();
  if (Number(recent?.n ?? 0) >= 5)
    throw new LiveError(
      "로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.",
      429,
    );
  const staff = await db
    .prepare("SELECT * FROM of_staff WHERE login=? AND active=1")
    .bind(login)
    .first<Doc>();
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  let valid = false;
  if (staff && (await verify(password, String(staff.password_hash)))) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO of_sessions(hash,staff_id,expires_at) VALUES(?,?,?)",
      )
      .bind(
        await sha256Hex(token),
        staff.id,
        new Date(Date.now() + 12 * 3600000).toISOString(),
      )
      .run();
    headers.append("Set-Cookie", clearedSessionCookie());
    headers.append(
      "Set-Cookie",
      `orderflow_staff=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    );
    valid = true;
  } else if (
    !staff &&
    allowedAdminEmails().includes(login) &&
    (await verifyAdminPassword(password))
  ) {
    headers.append(
      "Set-Cookie",
      sessionCookie(await createAdminSession(login)),
    );
    headers.append(
      "Set-Cookie",
      "orderflow_staff=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    valid = true;
  }
  if (!valid) {
    await db
      .prepare(
        "INSERT INTO admin_login_attempts(fingerprint,created_at) VALUES(?,?)",
      )
      .bind(fingerprint, now())
      .run();
    throw new LiveError("아이디 또는 비밀번호를 확인해 주세요.", 401);
  }
  await db
    .prepare("DELETE FROM admin_login_attempts WHERE fingerprint=?")
    .bind(fingerprint)
    .run();
  return new Response(
    JSON.stringify({ success: true, data: { authenticated: true } }),
    { headers },
  );
}
export const permissionsCatalog = [
  { code: "ORDER_OPS", name: "주문·배송 처리", group: "운영" },
  { code: "CUSTOMER_OPS", name: "고객관리", group: "고객" },
  { code: "PREPAY_POINT", name: "포인트·선결제", group: "돈" },
  { code: "SALES_VIEW", name: "매출 조회", group: "돈" },
  { code: "CHAT_OPS", name: "고객 채팅", group: "고객" },
  { code: "MANAGE", name: "주문서·기본설정", group: "설정" },
];
export async function accountsApi(
  c: LiveContext,
  path: string,
  method: string,
  data: Doc,
) {
  if (path === "/session") {
    const shop = await first(c, "SELECT name FROM of_shops WHERE id=?", c.shop);
    return {
      seller: {
        mcode: c.shop,
        ucode: c.actor,
        mname: shop?.name || "내 상점",
        userName: c.role === "OWNER" ? "사장님" : c.actor,
        userId: c.actor,
        role: c.role,
        userLevel: c.role === "OWNER" ? 40 : 10,
        isAdmin: false,
      },
      providers: {
        sms: false,
        alimtalk: false,
        bank: false,
        cashreceipt: false,
      },
    };
  }
  if (path === "/account/perms/mine")
    return {
      role: c.role,
      userLevel: c.role === "OWNER" ? 40 : 10,
      perms: c.permissions,
    };
  if (path === "/account/perms") {
    const staff = await query(
      c,
      "SELECT id,login,name,role,permissions FROM of_staff WHERE shop=? AND active=1",
      c.shop,
    );
    return {
      accounts: [
        { ucode: "owner", userName: "사장님", userId: c.actor, role: "OWNER" },
        ...staff.map((s) => ({
          ucode: s.id,
          userName: s.name,
          userId: s.login,
          role: s.role,
        })),
      ],
      catalog: permissionsCatalog.map((p, i) => ({
        ...p,
        sortNo: i,
        desc: p.name,
      })),
      cells: staff.flatMap((s) =>
        permissionsCatalog.map((p) => ({
          ucode: s.id,
          code: p.code,
          on: parse(s.permissions)[p.code] === true,
          explicit: true,
          locked: false,
        })),
      ),
    };
  }
  if (path.startsWith("/account/perms/") && method === "PUT") {
    if (c.role !== "OWNER")
      throw new LiveError("사장님만 권한을 변경할 수 있습니다.", 403);
    const [, , , id, code] = path.split("/");
    if (!permissionsCatalog.some((p) => p.code === decodeURIComponent(code)))
      throw new LiveError("알 수 없는 권한입니다.", 422);
    const user = await first(
      c,
      "SELECT * FROM of_staff WHERE shop=? AND id=?",
      c.shop,
      integer(id, 1),
    );
    if (!user || user.role !== "STAFF")
      throw new LiveError("직원 권한만 변경할 수 있습니다.", 403);
    await c.db
      .prepare("UPDATE of_staff SET permissions=? WHERE id=? AND shop=?")
      .bind(
        JSON.stringify({
          ...parse(user.permissions),
          [code]: data.on === true,
        }),
        user.id,
        c.shop,
      )
      .run();
    await audit(c, "permission", user.id);
    return { updated: 1 };
  }
  if (path === "/staff") {
    if (c.role !== "OWNER")
      throw new LiveError("사장님만 사용할 수 있습니다.", 403);
    if (method === "GET")
      return query(
        c,
        "SELECT id,login,name,role,active FROM of_staff WHERE shop=?",
        c.shop,
      );
    const login = required(data.login, "직원 아이디", 160).toLowerCase(),
      name = required(data.name, "직원 이름", 80);
    const hash = await passwordHash(required(data.password, "비밀번호", 128));
    const r = await c.db
      .prepare(
        "INSERT INTO of_staff(shop,login,name,password_hash,permissions) VALUES(?,?,?,?,?)",
      )
      .bind(
        c.shop,
        login,
        name,
        hash,
        JSON.stringify({ ORDER_OPS: true, CUSTOMER_OPS: true, CHAT_OPS: true }),
      )
      .run();
    await audit(c, "staff:create", r.meta.last_row_id);
    return { id: r.meta.last_row_id };
  }
  if (path === "/auth/change-password") {
    const staff = await first(
      c,
      "SELECT * FROM of_staff WHERE shop=? AND login=?",
      c.shop,
      c.actor,
    );
    if (!staff)
      throw new LiveError(
        "마스터 인증은 Cloudflare 보안 설정에서 변경합니다. 직원 비밀번호는 이 화면에서 변경할 수 있습니다.",
        409,
      );
    if (
      !(await verify(
        text(data.oldPassword ?? data.old_password),
        String(staff.password_hash),
      ))
    )
      throw new LiveError("현재 비밀번호를 확인해 주세요.", 401);
    const hash = await passwordHash(
      required(data.newPassword ?? data.new_password, "새 비밀번호", 128),
    );
    await c.db.batch([
      c.db
        .prepare("UPDATE of_staff SET password_hash=? WHERE id=? AND shop=?")
        .bind(hash, staff.id, c.shop),
      c.db.prepare("DELETE FROM of_sessions WHERE staff_id=?").bind(staff.id),
    ]);
    return { changed: true, relogin: true };
  }
  if (path === "/shop-setting") {
    const value = await setting(c, "shop", method === "GET" ? undefined : data);
    if (method !== "GET")
      await c.db
        .prepare("UPDATE of_shops SET name=? WHERE id=?")
        .bind(text(data.kms_sangho, 120), c.shop)
        .run();
    return {
      kms_sangho: "내 상점",
      kms_callback_mobile: "",
      kms_order: "N",
      kms_order_callback_mobile: "",
      new_customer_sms: "N",
      new_customer_sms_mobile: "",
      random_orderno: "N",
      order_fr_no: 1,
      order_to_no: 999,
      ...value,
    };
  }
  return undefined;
}
