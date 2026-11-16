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
  paymentOptions?: { value: string; label: string }[];
  options?: {
    usePickupTime: boolean;
    pickupTimes: string[];
    cashReceipt: boolean;
    present: boolean;
    pointEnabled: boolean;
  };
  items: {
    id: number;
    name: string;
    unit: string;
    price: number;
    stock: number;
    image?: string;
    imageUrls?: string[];
    description: string;
    detailHtml?: string;
    minQty?: number;
    maxQty?: number;
    stockVisible?: boolean;
    stockVisibleQty?: number;
    facts?: { label: string; value: string }[];
  }[];
};
type CustomerProfile = {
  authenticated: boolean;
  mobileMasked: string;
  customerName?: string;
  mobile?: string;
  pointBalance?: number;
  prepayBalance?: number;
};
type Quote = {
  amount: number;
  fee: number;
  point_used: number;
  total: number;
  point_earn_potential: number;
};
const noOptions = {
  usePickupTime: false,
  pickupTimes: [],
  cashReceipt: false,
  present: false,
  pointEnabled: false,
};

// Render only this app's opaque product-image route, never a supplied external origin.
function ownImage(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const path = new URL(value, "https://orderflow.invalid").pathname;
    return /^\/live-image\/[a-f\d]{32}$/u.test(path) ? path : "";
  } catch {
    return "";
  }
}
function checkedQuote(value: Quote): Quote {
  if (
    ![
      value.amount,
      value.fee,
      value.point_used,
      value.total,
      value.point_earn_potential,
    ].every((number) => Number.isSafeInteger(number) && number >= 0)
  )
    throw new Error(
      "서버에서 주문 금액을 확인하지 못했습니다. 다시 시도해 주세요.",
    );
  return value;
}
const money = (value: number | undefined) =>
  Number(value ?? 0).toLocaleString();

export function CustomerOrder({ token }: { token: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [photos, setPhotos] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [key] = useState(operationId);
  const [delivery, setDelivery] = useState("direct");
  const [payment, setPayment] = useState("transfer");
  const [address, setAddress] = useState("");
  const [addressDetail,setAddressDetail]=useState("");
  const [pickupTime,setPickupTime]=useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [points, setPoints] = useState(0);
  const [gift, setGift] = useState(false);
  const [receiptRequested, setReceiptRequested] = useState(false);
  const [customerToken, setCustomerToken] = useState("");
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [quote, setQuote] = useState<{ request: string; value: Quote } | null>(
    null,
  );
  const [quoteError, setQuoteError] = useState<{
    request: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    liveRequest<Form>(`/api/live-public/form/${token}`)
      .then((result) => {
        if (!alive) return;
        setForm(result);
        setDelivery(result.deliveryOptions[0] ?? "direct");
        setPayment(
          result.paymentOptions
            ? (result.paymentOptions.find((option) => option.value !== "prepay")
                ?.value ?? "")
            : "transfer",
        );
      })
      .catch((reason) => alive && setError(reason.message));
    const customer = new URLSearchParams(window.location.search);
    const reference =
      customer.get("customer") ??
      customer.get("customerToken") ??
      customer.get("customer_token") ??
      "";
    const timer = setTimeout(() => {
      if (
        !reference ||
        reference.length > 160 ||
        !/^[a-zA-Z\d_-]+$/u.test(reference)
      )
        return;
      setCustomerToken(reference);
      setProfileBusy(true);
      liveRequest<CustomerProfile>(
        `/api/live-public/customer/${encodeURIComponent(reference)}`,
      )
        .then((result) => {
          if (!alive) return;
          setProfile(result);
          if (result.authenticated) {
            if (result.customerName)
              setName((current) => current || result.customerName!);
            if (result.mobile) setMobile(result.mobile);
          }
        })
        .catch((reason) => alive && setProfileError(reason.message))
        .finally(() => alive && setProfileBusy(false));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token]);

  const options = form?.options ?? noOptions;
  const payments = (
    form?.paymentOptions ?? [{ value: "transfer", label: "계좌이체" }]
  ).filter(
    (option) => option.value !== "prepay" || profile?.authenticated === true,
  );
  const paymentValues = payments.map((option) => option.value).join("\u0000");
  useEffect(() => {
    const values = paymentValues ? paymentValues.split("\u0000") : [];
    if (values.includes(payment)) return;
    const timer = setTimeout(() => setPayment(values[0] ?? ""), 0);
    return () => clearTimeout(timer);
  }, [paymentValues, payment]);
  const selectedItems = Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([seqno, qty]) => ({ seqno: Number(seqno), qty }));
  const requestedPoints =
    profile?.authenticated && options.pointEnabled ? points : 0;
  const quoteRequest =
    form && selectedItems.length && payment
      ? JSON.stringify({
          items: selectedItems,
          delivery_gbn: delivery,
          pay_gbn: payment,
          addr: address,
          addr2:delivery==='pickup'?'':addressDetail,
          pickup_time:delivery==='pickup'?pickupTime:'',
          point_used: requestedPoints,
          mobile: profile?.authenticated ? profile.mobile : /^0\d{8,10}$/u.test(mobile.replace(/\D/gu,''))?mobile:undefined,
        })
      : "";

  useEffect(() => {
    if (!quoteRequest) return;
    let alive = true;
    const timer = setTimeout(() => {
      liveRequest<Quote>(
        `/api/live-public/form/${token}/quote`,
        JSON.parse(quoteRequest),
      )
        .then((result) => {
          if (alive) {
            setQuote({ request: quoteRequest, value: checkedQuote(result) });
            setQuoteError(null);
          }
        })
        .catch((reason) => {
          if (alive)
            setQuoteError({ request: quoteRequest, message: reason.message });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, quoteRequest]);

  const currentQuoteError =
    quoteError?.request === quoteRequest ? quoteError.message : "";
  const currentQuote =
    quote?.request === quoteRequest && !currentQuoteError ? quote.value : null;
  const quoteLoading = Boolean(
    quoteRequest && !currentQuote && !currentQuoteError,
  );

  if (!form)
    return (
      <main className="live-public">
        <h1>주문서</h1>
        <p role="alert">{error || "주문서를 불러오는 중…"}</p>
      </main>
    );

  return (
    <main className="live-public">
      <header>
        <p>{form.shopName}</p>
        <h1>{form.title}</h1>
        <p className="notice">{form.notice}</p>
      </header>

      {customerToken && (
        <section aria-labelledby="customer-profile-title">
          <h2 id="customer-profile-title">고객전용 잔액 확인</h2>
          {profileBusy && <p role="status">고객전용 링크를 확인하는 중…</p>}
          {profile?.authenticated ? (
            <p role="status">
              인증된 고객 · {profile.mobileMasked}
              <br />
              포인트 {money(profile.pointBalance)}점 · 선결제 잔액{" "}
              {money(profile.prepayBalance)}원
            </p>
          ) : (
            profile && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (profileBusy) return;
                  const input = new FormData(event.currentTarget);
                  setProfileBusy(true);
                  setProfileError("");
                  try {
                    const result = await liveRequest<CustomerProfile>(
                      `/api/live-public/customer/${encodeURIComponent(customerToken)}`,
                      { last4: String(input.get("last4") ?? "").trim() },
                    );
                    setProfile(result);
                    if (!result.authenticated)
                      throw new Error(
                        "고객전용 링크 인증을 완료하지 못했습니다.",
                      );
                    if (result.customerName)
                      setName((current) => current || result.customerName!);
                    if (result.mobile) setMobile(result.mobile);
                  } catch (reason) {
                    setProfileError(
                      reason instanceof Error
                        ? reason.message
                        : "고객 확인에 실패했습니다.",
                    );
                  } finally {
                    setProfileBusy(false);
                  }
                }}
              >
                <p>
                  {profile.mobileMasked} 고객전용 링크입니다. 휴대폰 뒤 4자리를
                  확인해 주세요.
                </p>
                <label>
                  휴대폰 뒤 4자리
                  <input
                    name="last4"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]{4}"
                    minLength={4}
                    maxLength={4}
                    required
                  />
                </label>
                <button disabled={profileBusy}>고객 확인</button>
              </form>
            )
          )}
          {profileError && <p role="alert">{profileError}</p>}
        </section>
      )}

      <section className="live-products" aria-label="주문 상품">
        {form.items.map((item) => {
          const images = [
            ...new Set(
              [...(item.imageUrls ?? []), item.image]
                .map(ownImage)
                .filter(Boolean),
            ),
          ];
          const picture = images.includes(photos[item.id])
            ? photos[item.id]
            : images[0];
          const maxQty = Math.min(
            item.stock,
            item.maxQty && item.maxQty > 0 ? item.maxQty : 9999,
          );
          const limits = [
            item.minQty && item.minQty > 0
              ? `최소 ${item.minQty}${item.unit}`
              : "",
            item.maxQty && item.maxQty > 0
              ? `최대 ${item.maxQty}${item.unit}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <article key={item.id}>
              {picture && (
                <div role="group" aria-label={`${item.name} 상품 사진`}>
                  <img src={picture} alt={item.name} loading="lazy" />
                  {images.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        marginTop: 6,
                      }}
                    >
                      {images.map((image, index) => (
                        <button
                          key={image}
                          type="button"
                          aria-label={`${item.name} 사진 ${index + 1}`}
                          aria-pressed={picture === image}
                          onClick={() =>
                            setPhotos((current) => ({
                              ...current,
                              [item.id]: image,
                            }))
                          }
                          style={{ width: 64, height: 64, padding: 4 }}
                        >
                          <img
                            src={image}
                            alt=""
                            loading="lazy"
                            style={{
                              width: 56,
                              height: 56,
                              aspectRatio: "1",
                              objectFit: "cover",
                              borderRadius: 4,
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <h2>{item.name}</h2>
              <p>
                {money(item.price)}원 / {item.unit}
              </p>
              {item.description && <p>{item.description}</p>}
              {item.detailHtml && (
                <details>
                  <summary>상품 상세 안내</summary>
                  <div
                    style={{
                      overflowWrap: "anywhere",
                      maxWidth: "100%",
                      overflowX: "auto",
                    }}
                    dangerouslySetInnerHTML={{ __html: item.detailHtml }}
                  />
                </details>
              )}
              {Boolean(item.facts?.length) && (
                <dl>
                  {item.facts!.map((fact, index) => (
                    <div key={`${fact.label}-${index}`}>
                      <dt>{fact.label}</dt>
                      <dd
                        style={{
                          marginInlineStart: 0,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {item.stockVisible === true && (
                <p>
                  품절 임박
                </p>
              )}
              {limits && <p id={`item-${item.id}-limits`}>{limits}</p>}
              <label>
                수량{" "}
                <input
                  type="number"
                  min="0"
                  step="1"
                  max={maxQty}
                  value={cart[item.id] ?? 0}
                  onChange={(event) => {
                    const quantity = Number(event.target.value);
                    setCart((current) => ({
                      ...current,
                      [item.id]: Number.isFinite(quantity)
                        ? Math.max(0, Math.min(maxQty, Math.floor(quantity)))
                        : 0,
                    }));
                  }}
                  aria-label={`${item.name} 수량`}
                  aria-describedby={
                    limits ? `item-${item.id}-limits` : undefined
                  }
                />
              </label>
            </article>
          );
        })}
      </section>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            busy ||
            !currentQuote ||
            currentQuoteError ||
            !selectedItems.length
          )
            return;
          setBusy(true);
          setError("");
          const input = new FormData(event.currentTarget);
          try {
            const result = await liveRequest<{ key: string }>(
              `/api/live-public/form/${token}`,
              {
                cust_name: name,
                mobile,
                addr: input.get("addr"),
                addr2: input.get("addr2"),
                delivery_memo: input.get("note"),
                delivery_gbn: delivery,
                pay_gbn: payment,
                pickup_time: input.get("pickup_time"),
                cash_receipt: receiptRequested ? "Y" : "N",
                cash_receipt_no: input.get("cash_receipt_no"),
                ispresent: gift ? "Y" : "N",
                present_receiver: input.get("present_receiver"),
                present_mobile: input.get("present_mobile"),
                point_used: requestedPoints,
                consent: input.get("consent") === "on",
                idempotencyKey: key,
                items: selectedItems,
              },
            );
            window.location.assign(`/receipt/${result.key}`);
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "주문을 접수하지 못했습니다.",
            );
            setBusy(false);
          }
        }}
      >
        <h2>주문자 정보</h2>
        <label>
          성함
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          휴대폰
          <input
            name="mobile"
            autoComplete="tel"
            inputMode="tel"
            required
            value={mobile}
            readOnly={Boolean(profile?.authenticated && profile.mobile)}
            onChange={(event) => setMobile(event.target.value)}
          />
        </label>
        <label>
          받는 방법
          <select
            value={delivery}
            onChange={(event) => setDelivery(event.target.value)}
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
              <input
                name="addr"
                autoComplete="street-address"
                required
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            <label>
              상세 주소
              <input name="addr2" autoComplete="address-line2" value={addressDetail} onChange={event=>setAddressDetail(event.target.value)}/>
            </label>
          </>
        )}
        {delivery === "pickup" && options.usePickupTime && (
          <label>
            픽업 시간
            {options.pickupTimes.length ? (
              <select name="pickup_time" required value={pickupTime} onChange={event=>setPickupTime(event.target.value)}>
                <option value="" disabled>
                  픽업 시간을 선택해 주세요
                </option>
                {options.pickupTimes.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : (
              <input name="pickup_time" type="time" required value={pickupTime} onChange={event=>setPickupTime(event.target.value)}/>
            )}
          </label>
        )}
        <label>
          결제 방법
          <select
            value={payment}
            required
            onChange={(event) => setPayment(event.target.value)}
          >
            {!payments.length && (
              <option value="">고객전용 링크 인증이 필요합니다</option>
            )}
            {payments.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {(options.pointEnabled ||
          form.paymentOptions?.some((option) => option.value === "prepay")) && (
          <p>매장이 제공한 고객전용 링크에서 잔액을 사용할 수 있습니다.</p>
        )}
        {profile?.authenticated && options.pointEnabled && (
          <label>
            사용할 포인트 (보유 {money(profile.pointBalance)}점)
            <input
              name="point_used"
              type="number"
              inputMode="numeric"
              min="0"
              max={Math.max(0, profile.pointBalance ?? 0)}
              step="1"
              value={points}
              onChange={(event) =>
                setPoints(
                  Math.max(0, Math.floor(Number(event.target.value) || 0)),
                )
              }
            />
          </label>
        )}
        {payment === "prepay" && profile?.authenticated && (
          <p>사용 가능한 선결제 잔액: {money(profile.prepayBalance)}원</p>
        )}
        {options.present && (
          <>
            <label>
              <input
                type="checkbox"
                name="ispresent"
                checked={gift}
                onChange={(event) => setGift(event.target.checked)}
              />{" "}
              선물로 보내기
            </label>
            {gift && (
              <>
                <label>
                  선물 받는 분
                  <input name="present_receiver" maxLength={80} required />
                </label>
                <label>
                  선물 받는 분 연락처
                  <input
                    name="present_mobile"
                    inputMode="tel"
                    type="tel"
                    required
                  />
                </label>
              </>
            )}
          </>
        )}
        {options.cashReceipt && (
          <>
            <label>
              <input
                type="checkbox"
                name="cash_receipt"
                checked={receiptRequested}
                onChange={(event) => setReceiptRequested(event.target.checked)}
              />{" "}
              현금영수증 정보 남기기
            </label>
            {receiptRequested && (
              <label>
                발행 정보 (휴대폰 또는 사업자번호)
                <input
                  name="cash_receipt_no"
                  inputMode="numeric"
                  maxLength={30}
                  required
                />
              </label>
            )}
            <p>
              발행 정보만 주문에 저장됩니다. 실제 현금영수증 발행 연동은 연결
              대기입니다.
            </p>
          </>
        )}
        <label>
          요청사항
          <textarea name="note" maxLength={1000} />
        </label>
        {payment === "transfer" && <p>입금 안내: {form.paymentGuide}</p>}
        <label>
          <input type="checkbox" name="consent" required /> 주문 이행을 위한
          성함·연락처·배송지 및 선택 입력 정보 수집·이용에 동의합니다.
        </label>
        <section aria-live="polite" aria-busy={quoteLoading}>
          {!selectedItems.length ? (
            <p>상품 수량을 선택하면 서버에서 주문 금액을 계산합니다.</p>
          ) : quoteLoading ? (
            <p role="status">배송비와 할인 금액을 확인하는 중…</p>
          ) : currentQuoteError ? (
            <p role="alert">{currentQuoteError}</p>
          ) : (
            currentQuote && (
              <>
                <p>
                  상품 {money(currentQuote.amount)}원 + 배송{" "}
                  {money(currentQuote.fee)}원 − 포인트{" "}
                  {money(currentQuote.point_used)}점
                </p>
                <strong>총 결제 금액 {money(currentQuote.total)}원</strong>
                {currentQuote.point_earn_potential > 0 && (
                  <p>
                    주문 처리에 따른 적립 예정{" "}
                    {money(currentQuote.point_earn_potential)}점
                  </p>
                )}
              </>
            )
          )}
        </section>
        {error && <p role="alert">{error}</p>}
        <button
          disabled={
            busy ||
            profileBusy ||
            !currentQuote ||
            quoteLoading ||
            !selectedItems.length ||
            !payment
          }
        >
          {busy ? "중복 없이 접수 중…" : "주문서 제출"}
        </button>
      </form>
    </main>
  );
}
