import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Link href="/" className="brand-lockup" aria-label="오더플로우 홈">
          <span className="brand-mark">O</span>
          <span>ORDERFLOW</span>
        </Link>
        <Link href="/admin" className="button button-ghost">관리자 시작</Link>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">주문 링크부터 배송 완료까지</p>
          <h1>주문은 더 짧게.<br />운영은 더 선명하게.</h1>
          <p className="hero-description">
            상품과 재고, 고객, 주문, 매출을 하나의 흐름으로 연결한 모바일 우선 주문 운영 앱입니다.
            고객은 바로 주문하고 운영자는 오늘 할 일을 놓치지 않습니다.
          </p>
          <div className="hero-actions">
            <Link href="/admin" className="button button-primary button-large">운영 화면 열기 <span>→</span></Link>
            <Link href="/order/fresh-market" className="button button-soft button-large">고객 주문서 보기</Link>
          </div>
          <div className="trust-row">
            <span><b>01</b> 로그인 없는 고객 주문</span>
            <span><b>02</b> 실시간 재고 차감</span>
            <span><b>03</b> 개인정보 분리 보호</span>
          </div>
        </div>

        <div className="hero-product" aria-label="운영 현황 미리보기">
          <div className="preview-window">
            <div className="preview-header">
              <span className="preview-brand">OF</span>
              <div><b>오늘 운영</b><small>8월 10일 일요일</small></div>
              <span className="live-chip">실시간</span>
            </div>
            <div className="preview-stats">
              <article><small>오늘 주문</small><strong>24</strong><span>+18%</span></article>
              <article><small>오늘 매출</small><strong>₩842K</strong><span>+12%</span></article>
              <article className="warning"><small>재고 주의</small><strong>4</strong><span>확인 필요</span></article>
            </div>
            <div className="preview-board">
              <div className="board-head"><b>주문 흐름</b><span>전체 보기</span></div>
              <div className="flow-row"><span className="flow-dot blue" /><div><b>OF-0810-A92F</b><small>햇살 복숭아 외 2개</small></div><em>새 주문</em></div>
              <div className="flow-row"><span className="flow-dot amber" /><div><b>OF-0810-F18C</b><small>목초 유정란 외 1개</small></div><em>포장 중</em></div>
              <div className="flow-row"><span className="flow-dot green" /><div><b>OF-0810-C73B</b><small>춘천식 닭갈비 외 3개</small></div><em>배송 완료</em></div>
            </div>
          </div>
          <div className="floating-note note-one"><span>재고 알림</span><b>멜론 4개 남음</b></div>
          <div className="floating-note note-two"><span>새 주문</span><b>방금 접수됨</b></div>
        </div>
      </section>

      <section className="feature-strip" aria-label="주요 기능">
        <article><span>01</span><div><h2>한눈에 보는 오늘</h2><p>새 주문, 미입금, 포장 대기와 재고 위험을 첫 화면에서 바로 확인합니다.</p></div></article>
        <article><span>02</span><div><h2>실수 줄이는 주문 흐름</h2><p>상태 변경, 결제 확인, 상품별 집계를 한 번의 작업 흐름으로 연결합니다.</p></div></article>
        <article><span>03</span><div><h2>계속 자라는 구조</h2><p>결제, 문자, 카카오, 배송 연동을 모듈 단위로 추가할 수 있게 설계했습니다.</p></div></article>
      </section>
    </main>
  );
}
