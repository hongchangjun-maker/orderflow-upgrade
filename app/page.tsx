import Link from "next/link";

const features = [
  { icon: "orders", eyebrow: "ORDER CONTROL", title: "수천 건도 흐름대로", copy: "새 주문부터 확인·포장·배송·완료까지 담당자가 놓치지 않도록 한 화면에 정리합니다." },
  { icon: "inventory", eyebrow: "LIVE INVENTORY", title: "주문과 동시에 재고 반영", copy: "서버 가격과 실제 재고를 다시 검증하고, 동시 주문에서도 음수 재고를 데이터베이스가 차단합니다." },
  { icon: "customers", eyebrow: "CUSTOMER CARE", title: "고객 이력을 자동으로", copy: "휴대폰 기준으로 주문 횟수와 누적 금액을 정리해 반복 주문과 고객 응대를 더 쉽게 만듭니다." },
  { icon: "analytics", eyebrow: "REAL INSIGHT", title: "오늘의 숫자를 즉시", copy: "주문량, 매출, 미처리 주문, 재고 경고와 인기 상품을 운영 시작 화면에서 바로 확인합니다." },
];

const productPhotos = ["peach", "egg", "chicken", "melon", "kimchi", "curry", "pancake", "noodle"];

export default function Home() {
  return <main className="landing-shell premium-landing">
    <nav className="landing-nav">
      <Link href="/" className="brand-lockup" aria-label="오더플로우 홈"><img src="/visuals/orderflow-mark.webp" alt="" /><span>ORDERFLOW</span></Link>
      <div className="landing-nav-actions"><span className="system-chip"><i /> 운영 준비 완료</span><Link href="/admin" className="button button-ghost">관리자 로그인</Link></div>
    </nav>

    <section className="premium-hero">
      <img className="premium-hero-photo" src="/visuals/operations-hero.webp" alt="신선식품 주문을 확인하고 포장하는 운영 현장" />
      <div className="premium-hero-overlay" />
      <div className="premium-hero-copy">
        <p className="eyebrow gold">THE NEW STANDARD OF ORDER OPERATIONS</p>
        <h1>주문은 더 쉽게.<br /><em>운영은 더 우아하게.</em></h1>
        <p>사진을 보고 바로 주문하는 고객 경험부터 실시간 재고, 주문 처리, 고객과 매출 관리까지. 성장하는 판매자를 위해 완성한 프리미엄 주문 운영 플랫폼입니다.</p>
        <div className="hero-actions"><Link href="/order/fresh-market" className="button button-gold button-large">실사 주문서 열기 <span>→</span></Link><Link href="/admin" className="button button-glass button-large">운영 화면 보기</Link></div>
        <div className="hero-proof"><div><strong>EDGE</strong><span>전 세계 빠른 응답</span></div><div><strong>D1</strong><span>안전한 주문 저장</span></div><div><strong>24/7</strong><span>실시간 상태 확인</span></div></div>
      </div>
    </section>

    <section className="operations-showcase">
      <div className="section-heading"><div><p className="eyebrow">OPERATION COCKPIT</p><h2>오늘 해야 할 일이<br />먼저 보입니다.</h2></div><p>복잡한 메뉴를 뒤지는 대신 중요한 주문과 재고 위험을 첫 화면에서 바로 판단합니다.</p></div>
      <div className="cockpit-frame">
        <aside><img src="/visuals/orderflow-mark.webp" alt="" /><b>ORDERFLOW</b>{["dashboard", "orders", "products", "customers", "analytics"].map((icon) => <span key={icon}><img src={`/visuals/icons/${icon}.webp`} alt="" /></span>)}</aside>
        <div className="cockpit-main">
          <div className="cockpit-top"><div><small>2026년 8월 10일 월요일</small><h3>오늘의 운영</h3></div><span className="live-chip"><i /> LIVE</span></div>
          <div className="cockpit-metrics"><article><img src="/visuals/icons/orders.webp" alt="" /><span>오늘 주문</span><strong>2,481</strong><small>실시간 접수</small></article><article><img src="/visuals/icons/payment.webp" alt="" /><span>오늘 매출</span><strong>₩42.8M</strong><small>+12.8%</small></article><article><img src="/visuals/icons/delivery.webp" alt="" /><span>처리 중</span><strong>184</strong><small>배송 포함</small></article><article className="warning"><img src="/visuals/icons/inventory.webp" alt="" /><span>재고 주의</span><strong>4</strong><small>확인 필요</small></article></div>
          <div className="cockpit-flow"><div className="panel-head"><div><p className="eyebrow">ORDER PIPELINE</p><h3>주문 처리 흐름</h3></div><span>실시간 동기화</span></div><div className="status-pipeline demo"><div><span>01</span><strong>86</strong><small>새 주문</small><i /></div><div><span>02</span><strong>52</strong><small>확인</small><i /></div><div><span>03</span><strong>31</strong><small>포장</small><i /></div><div><span>04</span><strong>15</strong><small>배송</small><i /></div><div><span>05</span><strong>2,297</strong><small>완료</small></div></div></div>
        </div>
      </div>
    </section>

    <section className="visual-ordering">
      <div className="section-heading inverse"><div><p className="eyebrow gold">VISUAL ORDERING</p><h2>이름보다 사진이<br />먼저 이해되도록.</h2></div><p>고객은 실사 이미지를 보고 원하는 상품을 빠르게 고르고, 모바일에서도 몇 번의 터치로 주문을 끝냅니다.</p></div>
      <div className="photo-ribbon">{productPhotos.map((name, index) => <figure key={name}><img src={`/visuals/products/${name}.webp`} alt="신선식품 실사 상품" loading="lazy" /><figcaption><span>0{index + 1}</span><b>{["햇살 복숭아", "목초 유정란", "춘천식 닭갈비", "머스크 멜론", "여수 파김치", "삼일 숙성 카레", "고기 빈대떡", "가평 잣막국수"][index]}</b></figcaption></figure>)}</div>
      <Link href="/order/fresh-market" className="button button-gold button-large visual-cta">사진으로 주문해 보기 <span>→</span></Link>
    </section>

    <section className="feature-gallery">
      <div className="section-heading"><div><p className="eyebrow">BUILT TO GROW</p><h2>매일의 운영부터<br />다음 성장까지.</h2></div><p>기능을 독립된 영역으로 나눠 결제, 문자, 배송, 권한과 같은 다음 기능을 흔들림 없이 확장할 수 있습니다.</p></div>
      <div className="premium-feature-grid">{features.map((feature, index) => <article key={feature.title}><div className="feature-image"><img src={`/visuals/icons/${feature.icon}.webp`} alt="" /><span>0{index + 1}</span></div><p className="eyebrow">{feature.eyebrow}</p><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
    </section>

    <section className="final-cta"><img src="/visuals/orderflow-mark.webp" alt="" /><p className="eyebrow gold">READY FOR YOUR NEXT ORDER</p><h2>오늘 들어오는 주문부터<br />더 좋은 흐름으로 바꾸세요.</h2><div><Link href="/admin" className="button button-gold button-large">운영 시작하기</Link><Link href="/order/fresh-market" className="button button-glass button-large">고객 주문서 보기</Link></div></section>
  </main>;
}
