"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product, PublicOrderForm } from "../../lib/types";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const productImage = (id: string) => `/visuals/products/${id.replace("prod-", "")}.webp`;

type Checkout = { name: string; phone: string; deliveryMethod: "delivery" | "pickup"; postalCode: string; address: string; addressDetail: string; requestNote: string; paymentMethod: "bank" | "pickup"; agreed: boolean; website: string };
const EMPTY_CHECKOUT: Checkout = { name: "", phone: "", deliveryMethod: "delivery", postalCode: "", address: "", addressDetail: "", requestNote: "", paymentMethod: "bank", agreed: false, website: "" };

export function OrderFormApp({ slug }: { slug: string }) {
  const [form, setForm] = useState<PublicOrderForm | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [checkout, setCheckout] = useState<Checkout>(EMPTY_CHECKOUT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ orderNo: string; total: number } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  const loadForm = async () => {
    const response = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`, { cache: "no-store" });
    const data = await response.json() as { form?: PublicOrderForm; error?: string };
    if (!response.ok || !data.form) throw new Error(data.error ?? "주문서를 불러오지 못했습니다.");
    setForm(data.form);
    setQuantities((current) => Object.fromEntries(Object.entries(current).map(([id, quantity]) => {
      const product = data.form?.products.find((item) => item.id === id);
      return [id, Math.min(quantity, product?.stock ?? 0)];
    })));
    return data.form;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadForm().catch((reason) => setError(reason.message || "주문서를 불러오지 못했습니다."));
      const saved = sessionStorage.getItem(`orderflow-draft:${slug}`);
      if (saved) {
        try {
          const draft = JSON.parse(saved) as { checkout?: Partial<Checkout>; quantities?: Record<string, number> };
          setCheckout({ ...EMPTY_CHECKOUT, ...draft.checkout, website: "", agreed: false });
          if (draft.quantities) setQuantities(draft.quantities);
        } catch { sessionStorage.removeItem(`orderflow-draft:${slug}`); }
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // loadForm is intentionally scoped to the current slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!form || success) return;
    sessionStorage.setItem(`orderflow-draft:${slug}`, JSON.stringify({ checkout: { ...checkout, website: "", agreed: false }, quantities }));
  }, [checkout, form, quantities, slug, success]);

  const items = useMemo(() => form?.products.filter((product) => (quantities[product.id] ?? 0) > 0).map((product) => ({ product, quantity: quantities[product.id] })) ?? [], [form, quantities]);
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shippingFee = !form || checkout.deliveryMethod === "pickup" || (form.freeShippingAt > 0 && subtotal >= form.freeShippingAt) ? 0 : form.shippingFee;
  const total = subtotal + shippingFee;
  const categories = useMemo(() => ["전체", ...new Set(form?.products.map((product) => product.category) ?? [])], [form]);
  const visibleProducts = form?.products.filter((product) => (category === "전체" || product.category === category) && product.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  const adjust = (product: Product, delta: number) => {
    setIdempotencyKey(crypto.randomUUID());
    setQuantities((current) => ({ ...current, [product.id]: Math.max(0, Math.min(product.stock, (current[product.id] ?? 0) + delta)) }));
  };
  const change = <K extends keyof Checkout>(key: K, value: Checkout[K]) => {
    setIdempotencyKey(crypto.randomUUID());
    setCheckout((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    if (!form) return { message: "주문서를 불러온 뒤 다시 시도해 주세요." };
    if (!items.length) return { message: "주문할 상품을 먼저 담아 주세요." };
    if (subtotal < form.minOrderAmount) return { message: `최소 주문금액까지 ${won(form.minOrderAmount - subtotal)} 더 담아 주세요.` };
    if (!checkout.name.trim()) return { message: "주문자 이름을 입력해 주세요.", ref: nameRef };
    if (!/^01[0-9]{8,9}$/.test(checkout.phone)) return { message: "휴대폰 번호를 숫자 10~11자리로 입력해 주세요.", ref: phoneRef };
    if (checkout.deliveryMethod === "delivery" && !checkout.address.trim()) return { message: "배송 주소를 입력해 주세요.", ref: addressRef };
    if (!checkout.agreed) return { message: "개인정보 수집·이용 동의가 필요합니다.", ref: consentRef };
    return null;
  };

  const submit = async () => {
    if (!form) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid.message);
      setCartOpen(true);
      window.setTimeout(() => invalid.ref?.current?.focus(), 80);
      return;
    }
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/public/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formSlug: slug, idempotencyKey, ...checkout, items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })) }) });
      const data = await response.json() as { error?: string; code?: string; order?: { orderNo: string; total: number } };
      if (!response.ok) throw new Error(data.error ?? "주문을 접수하지 못했습니다.");
      if (!data.order) throw new Error("주문 결과를 확인하지 못했습니다.");
      setSuccess({ orderNo: data.order.orderNo, total: data.order.total });
      sessionStorage.removeItem(`orderflow-draft:${slug}`);
      setCartOpen(false);
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      if (/재고|판매가 종료/.test(message)) await loadForm().catch(() => undefined);
    }
    finally { setSubmitting(false); }
  };

  if (success) return <main className="success-shell"><section className="success-card"><img className="success-icon" src="/visuals/icons/orders.webp" alt="주문 접수 완료" /><p className="eyebrow">ORDER RECEIVED</p><h1>주문이 접수됐어요.</h1><p>{form?.shop.orderCompleteMessage || "운영자가 주문을 확인한 뒤 안내드릴게요."}</p><dl><div><dt>주문번호</dt><dd>{success.orderNo}</dd></div><div><dt>결제 예정금액</dt><dd>{won(success.total)}</dd></div></dl><Link href="/" className="button button-primary button-full">처음으로</Link></section></main>;
  if (!form && error) return <main className="success-shell"><section className="success-card"><span className="success-mark error">!</span><h1>주문서를 열 수 없어요.</h1><p>{error}</p><Link href="/" className="button button-ghost">처음으로</Link></section></main>;
  if (!form) return <main className="store-loading"><img src="/visuals/orderflow-mark.webp" alt="" /><p>신선한 상품을 준비하고 있어요.</p></main>;

  return <div className="store-shell">
    <header className="store-header"><div className="store-header-inner"><Link href="/" className="brand-lockup"><img src="/visuals/orderflow-mark.webp" alt="" /><span>{form.shop.name}</span></Link><button className="cart-pill" onClick={() => setCartOpen(true)}><img src="/visuals/icons/cart.webp" alt="" /><span>장바구니</span><b>{itemCount}</b><em>{won(subtotal)}</em></button></div></header>

    <main className="store-main">
      <section className="store-hero"><div><p className="eyebrow">WEEKLY MARKET · 바로 주문</p><h1>{form.title}</h1><p>{form.shop.tagline}</p></div><div className="store-notice"><span>안내</span><p>{form.notice}</p></div></section>
      <div className="store-layout">
        <section className="catalog-section">
          <div className="catalog-toolbar"><div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="catalog-search"><img src="/visuals/icons/search.webp" alt="" /><input aria-label="상품 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품 검색" /></label></div>
          <div className="product-grid">{visibleProducts.map((product) => { const quantity = quantities[product.id] ?? 0; const soldOut = product.stock === 0; return <article className={`store-product ${soldOut ? "sold-out" : ""}`} key={product.id}>
            <div className="product-visual"><img src={productImage(product.id)} alt={`${product.name} 상품 사진`} loading="lazy" onError={(event) => { event.currentTarget.src = "/visuals/icons/products.webp"; }} />{product.stock <= product.lowStockAt && product.stock > 0 && <em>마감 임박</em>}{soldOut && <em>품절</em>}</div>
            <div className="product-copy"><small>{product.category} · {product.unit}</small><h2>{product.name}</h2><p>{product.description}</p><div className="product-bottom"><strong>{won(product.price)}</strong>{quantity > 0 ? <div className="stepper"><button onClick={() => adjust(product, -1)} aria-label={`${product.name} 수량 줄이기`}>−</button><b>{quantity}</b><button onClick={() => adjust(product, 1)} aria-label={`${product.name} 수량 늘리기`}>+</button></div> : <button className="add-button" onClick={() => adjust(product, 1)} disabled={soldOut}>담기 +</button>}</div></div>
          </article>; })}</div>
          {!visibleProducts.length && <div className="empty-state"><span>⌕</span><p>조건에 맞는 상품이 없습니다.</p></div>}
        </section>

        <aside className={`checkout-panel ${cartOpen ? "open" : ""}`}>
          <div className="mobile-sheet-head"><b>내 주문</b><button onClick={() => setCartOpen(false)}>×</button></div>
          <div className="checkout-head"><p className="eyebrow">MY ORDER</p><h2>주문 요약</h2><span>{itemCount}개</span></div>
          <div className="cart-items">{items.length ? items.map((item) => <div key={item.product.id}><p><b>{item.product.name}</b><small>{item.product.unit}</small></p><div className="cart-stepper"><button type="button" onClick={() => adjust(item.product, -1)} aria-label={`${item.product.name} 수량 줄이기`}>−</button><span>{item.quantity}</span><button type="button" onClick={() => adjust(item.product, 1)} aria-label={`${item.product.name} 수량 늘리기`}>+</button></div><strong>{won(item.product.price * item.quantity)}</strong></div>) : <div className="empty-cart"><span>+</span><p>마음에 드는 상품을 담아보세요.</p></div>}</div>
          <div className="checkout-form">
            <h3><span>01</span> 주문자 정보</h3><div className="form-row"><label><span>이름 *</span><input ref={nameRef} autoComplete="name" value={checkout.name} onChange={(e) => change("name", e.target.value)} placeholder="홍길동" /></label><label><span>휴대폰 *</span><input ref={phoneRef} type="tel" inputMode="numeric" autoComplete="tel" value={checkout.phone} onChange={(e) => change("phone", e.target.value.replace(/[^0-9]/g, "").slice(0, 11))} placeholder="01012345678" /></label></div>
            <h3><span>02</span> 받는 방법</h3><div className="choice-grid"><button className={checkout.deliveryMethod === "delivery" ? "active" : ""} onClick={() => { change("deliveryMethod", "delivery"); change("paymentMethod", "bank"); }}>문 앞 배송<small>{shippingFee ? won(shippingFee) : "무료"}</small></button><button className={checkout.deliveryMethod === "pickup" ? "active" : ""} onClick={() => { change("deliveryMethod", "pickup"); change("paymentMethod", "pickup"); }}>매장 픽업<small>배송비 없음</small></button></div>
            {checkout.deliveryMethod === "delivery" && <><label><span>주소 *</span><input ref={addressRef} autoComplete="street-address" value={checkout.address} onChange={(e) => change("address", e.target.value)} placeholder="도로명 주소" /></label><label><span>상세주소</span><input autoComplete="address-line2" value={checkout.addressDetail} onChange={(e) => change("addressDetail", e.target.value)} placeholder="동·호수 / 공동현관 안내" /></label></>}
            <label><span>요청사항</span><textarea value={checkout.requestNote} onChange={(e) => change("requestNote", e.target.value)} placeholder="배송 시 참고할 내용을 적어주세요." /></label>
            <h3><span>03</span> 결제</h3><div className="choice-grid"><button className={checkout.paymentMethod === "bank" ? "active" : ""} onClick={() => change("paymentMethod", "bank")} disabled={checkout.deliveryMethod === "pickup"}>계좌이체<small>확인 후 안내</small></button><button className={checkout.paymentMethod === "pickup" ? "active" : ""} onClick={() => change("paymentMethod", "pickup")} disabled={checkout.deliveryMethod !== "pickup"}>현장결제<small>픽업 시 결제</small></button></div>
            <p className="payment-guide">{form.shop.paymentGuide}</p>
            <input className="honeypot" tabIndex={-1} autoComplete="off" value={checkout.website} onChange={(e) => change("website", e.target.value)} aria-hidden="true" />
            <label className="consent-row"><input ref={consentRef} type="checkbox" checked={checkout.agreed} onChange={(e) => change("agreed", e.target.checked)} /><span>주문 처리에 필요한 개인정보 수집·이용에 동의합니다.</span></label>
          </div>
          <div className="totals"><div><span>상품금액</span><b>{won(subtotal)}</b></div><div><span>배송비</span><b>{shippingFee ? won(shippingFee) : "무료"}</b></div><div className="grand-total"><span>결제 예정금액</span><strong>{won(total)}</strong></div>{form.minOrderAmount > 0 && subtotal < form.minOrderAmount && <p>{won(form.minOrderAmount - subtotal)} 더 담으면 주문할 수 있어요.</p>}</div>
          {error && <p className="form-error" role="alert" aria-live="assertive">{error}</p>}
          <button className="button button-primary button-full button-large" onClick={submit} disabled={submitting}>{submitting ? "안전하게 주문 접수 중..." : `${won(total)} 주문하기`}</button>
        </aside>
      </div>
    </main>
    {cartOpen && <button className="sheet-backdrop" aria-label="장바구니 닫기" onClick={() => setCartOpen(false)} />}
    {itemCount > 0 && <button className="mobile-cart-bar" onClick={() => setCartOpen(true)}><span>{itemCount}개 담김</span><b>주문 확인</b><strong>{won(total)}</strong></button>}
  </div>;
}
