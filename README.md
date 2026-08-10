# ORDERFLOW

ORDERFLOW는 고객용 사진 주문서와 운영자용 주문·상품·재고·고객·매출 관리 화면을 한 시스템에 담은 Cloudflare 기반 주문 운영 앱입니다.

이 저장소는 기존 사이트, 기존 API, 기존 데이터베이스와 연결하지 않는 완전한 독립 프로젝트입니다. 새 Cloudflare Worker, 새 D1 데이터베이스, 새 관리자 인증 정보만 사용합니다.

## 주요 기능

- 실사 상품 사진, 분류, 검색, 장바구니, 배송·픽업, 결제 방법을 갖춘 모바일 주문서
- 서버 가격·판매 상태·재고 재검증과 데이터베이스 트리거 기반 음수 재고 차단
- 멱등성 키를 통한 중복 주문 방지
- 주문 처리 단계, 고객 이력, 매출, 인기 상품, 재고 경고를 보여주는 관리자 화면
- PBKDF2 비밀번호 검증, HMAC 서명 세션, HttpOnly 쿠키, 관리자 이메일 허용 목록
- 로그인·주문 속도 제한, 요청 크기·Origin 검사, 보안 응답 헤더
- 조회 패턴에 맞춘 D1 인덱스와 대시보드 묶음 조회
- 3D 아이콘, 전용 로고, WebP 실사 이미지를 사용한 반응형 UI

## 기술 구성

- Next.js 15, React 19, TypeScript
- Cloudflare Workers + Static Assets
- Cloudflare D1 + Drizzle ORM
- Cloudflare Vite Plugin + Wrangler

주요 영역은 다음처럼 분리되어 있어 결제, 문자, 배송, 직원 권한, R2 업로드 기능을 독립적으로 확장할 수 있습니다.

- `app/order/[slug]`: 고객 주문서
- `app/admin`: 관리자 UI
- `app/api/public`: 공개 주문서 조회 및 주문 접수 API
- `app/api/admin`: 인증된 관리자 API
- `app/api/auth`: 관리자 로그인·로그아웃
- `app/lib`: 인증, 보안, D1 데이터 접근
- `db`, `drizzle`: 스키마와 순차 마이그레이션
- `worker`: Cloudflare Worker 진입점과 보안 정책

## 로컬 실행

```bash
npm install
npm run db:local
npm run dev
```

개발 중에만 관리자 화면을 바로 확인하려면 `.dev.vars` 또는 로컬 환경에 아래 값을 둘 수 있습니다. 운영 환경에서는 절대로 사용하지 않습니다.

```env
LOCAL_ADMIN_BYPASS=1
```

## 운영 비밀값

운영 환경의 아래 값은 Git에 저장하지 않고 `wrangler secret put`으로 설정합니다.

- `ADMIN_EMAILS`: 쉼표로 구분한 관리자 이메일 허용 목록
- `ADMIN_PASSWORD_HASH`: `pbkdf2_sha256$반복횟수$salt$hash` 형식
- `ADMIN_SESSION_SECRET`: HMAC 세션 서명용 무작위 비밀값

## 데이터베이스와 배포

```bash
npm run cf:types
npm run db:remote
npm run deploy:cloudflare
```

`wrangler.jsonc`의 D1 ID는 이 프로젝트 전용 새 데이터베이스만 가리킵니다. 다른 서비스의 데이터베이스 ID나 도메인을 추가하지 마세요.

## 검증

```bash
npm run lint
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
```

주문 API를 변경할 때는 중복 요청이 주문·재고를 두 번 반영하지 않는지, 동시 주문에서 재고가 음수가 되지 않는지, 익명 사용자가 관리자 API에 접근할 수 없는지 함께 확인해야 합니다.

## 확장 원칙

- 결제: 공급자 Webhook 서명 검증 후에만 결제 상태를 변경합니다.
- 알림: 주문 트랜잭션과 분리된 Queue 소비자로 문자·카카오 발송을 처리합니다.
- 이미지 업로드: 원본은 R2에 저장하고 D1에는 소유자와 경로만 기록합니다.
- 직원 권한: 역할·권한 테이블을 추가하고 모든 관리자 API에서 서버 검증합니다.
- 대량 분석: 실시간 주문 쓰기와 무거운 집계를 분리하고 예약 집계 또는 Analytics Engine을 사용합니다.
