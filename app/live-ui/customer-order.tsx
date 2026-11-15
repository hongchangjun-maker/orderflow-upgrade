"use client";
import { useEffect, useState } from "react";
import { liveRequest, operationId } from "../modules/live-client/client";
type Form = {
  title: string;
  shopName: string;
  notice: string;
  paymentGuide: string;
  shippingFee: number;
  minOrderAmount: number;
  deliveryOptions: string[];
  items: {
    id: number;
    name: string;
    unit: string;
    price: number;
    stock: number;
    image: string;
    description: string;
  }[];
};
export function CustomerOrder({ token }: { token: string }) {
  const [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(""),
    [cart, setCart] = useState<Record<number, number>>({}),
    [busy, setBusy] = useState(false),
    [key] = useState(operationId),
    [delivery, setDelivery] = useState("direct");
  useEffect(() => {
    let alive = true;
    liveRequest<Form>(`/api/live-public/form/${token}`)
      .then((result) => {
        if (alive) {
          setForm(result);
          setDelivery(result.deliveryOptions[0] ?? "direct");
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [token]);
  if (!form)
    return (
      <main className="live-public">
        <h1>주문서</h1>
        <p role="alert">{error || "주문서를 불러오는 중…"}</p>
      </main>
    );
  const total = form.items.reduce((n, i) => n + i.price * (cart[i.id] ?? 0), 0),
    fee = delivery === "pickup" ? 0 : form.shippingFee;
  return (
    <main className="live-public">
      <header>
        <p>{form.shopName}</p>
        <h1>{form.title}</h1>
        <p className="notice">{form.notice}</p>
      </header>
      <section className="live-products">
        {form.items.map((item) => (
          <article key={item.id}>
            {item.image && <img src={item.image} alt={item.name} />}
            <h2>{item.name}</h2>
            <p>
              {item.price.toLocaleString()}원 / {item.unit}
            </p>
            <p>{item.description}</p>
            <p>
              주문 가능 {item.stock}
              {item.unit}
            </p>
            <label>
              수량{" "}
              <input
                type="number"
                min="0"
                max={Math.min(item.stock, 9999)}
                value={cart[item.id] ?? 0}
                onChange={(e) =>
                  setCart({
                    ...cart,
                    [item.id]: Math.max(
                      0,
                      Math.min(item.stock, Number(e.target.value)),
                    ),
                  })
                }
                aria-label={`${item.name} 수량`}
              />
            </label>
          </article>
        ))}
      </section>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const input = new FormData(e.currentTarget);
          try {
            const result = await liveRequest<{ key: string }>(
              `/api/live-public/form/${token}`,
              {
                cust_name: input.get("name"),
                mobile: input.get("mobile"),
                addr: input.get("addr"),
                addr2: input.get("addr2"),
                delivery_memo: input.get("note"),
                delivery_gbn: delivery,
                consent: input.get("consent") === "on",
                idempotencyKey: key,
                items: Object.entries(cart)
                  .filter(([, q]) => q > 0)
                  .map(([seqno, qty]) => ({ seqno: Number(seqno), qty })),
              },
            );
            window.location.assign(`/receipt/${result.key}`);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "주문을 접수하지 못했습니다.",
            );
            setBusy(false);
          }
        }}
      >
        <h2>주문자 정보</h2>
        <label>
          성함
          <input name="name" autoComplete="name" required maxLength={80} />
        </label>
        <label>
          휴대폰
          <input name="mobile" autoComplete="tel" inputMode="tel" required />
        </label>
        <label>
          받는 방법
          <select
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          >
            {form.deliveryOptions.map((value) => (
              <option key={value} value={value}>
                {value === "pickup"
                  ? "매장 픽업"
                  : value === "parcel"
                    ? "택배"
                    : "배송"}
              </option>
            ))}
          </select>
        </label>
        {delivery !== "pickup" && (
          <>
            <label>
              배송 주소
              <input name="addr" autoComplete="street-address" required />
            </label>
            <label>
              상세 주소
              <input name="addr2" />
            </label>
          </>
        )}
        <label>
          요청사항
          <textarea name="note" maxLength={1000} />
        </label>
        <p>입금 안내: {form.paymentGuide}</p>
        <label>
          <input type="checkbox" name="consent" required /> 주문 이행을 위한
          성함·연락처·배송지 수집 및 이용에 동의합니다.
        </label>
        <strong>
          상품 {total.toLocaleString()}원 + 배송 {fee.toLocaleString()}원 ={" "}
          {(total + fee).toLocaleString()}원
        </strong>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy || total === 0 || total < form.minOrderAmount}>
          {busy ? "중복 없이 접수 중…" : "주문서 제출"}
        </button>
      </form>
    </main>
  );
}
