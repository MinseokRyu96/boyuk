@AGENTS.md

# 보육공고 (어린이집 신입·담임교사 공고 모아보기)

기획은 `/Users/minseok/Desktop/md/PRD_어린이집_공고_모아보기.md`를 따른다. 모든 글(주석·문구·커밋)은 한글로 쓴다.

## 명령어

- `npm run dev` 개발 서버, `npm run build` 빌드, `npm test` 단위 테스트(vitest), `npm run typecheck`, `npm run lint`
- `npm test`에는 마이그레이션 SQL을 로컬 Postgres(PGlite)에 적용해 검증하는 `supabase/get-feed.test.ts`가 들어 있다. SQL을 고치면 반드시 돌린다.
- `npm run test:db`는 실제 Supabase DB로 수집 실행기·권한·피드 조회를 시험한다(`lib/collectors/run.db.test.ts`). `set -a; . ./.env.local; set +a; npm run test:db`처럼 키를 환경에 올려서 돌린다. `itest_<무작위>_a/b` 전용 출처의 행만 만들고 끝나면 지운다. 기본 `npm test`에서는 건너뛴다.

## 구조

- `app/page.tsx` 피드(서버에서 첫 20건을 `use cache`로 조회), `app/api/jobs` 다음 페이지, `app/api/cron/[source]` 수집 엔드포인트
- `lib/collectors/` 소스별 수집기. 고용24(`work24.ts`, XML)와 사람인(`saramin.ts`, JSON)은 구현됐고, 나머지 5개는 `pending(...)`이라 501을 돌려준다. 등록은 `lib/collectors/index.ts`
  - 공통 도구: `http.ts`(시간 초과·재시도·호출 간격·키 가리기), `dates.ts`, `region.ts`, `url.ts`(http(s)만 허용), `config.ts`(검색어·지역·사람인 하루 예산)
  - 수집기는 `{ jobs, complete }`를 돌려준다. `complete: false`(호출 한도·쪽 상한)이면 실행기(`run.ts`)가 "사라진 공고 숨기기"를 건너뛴다
  - 범용 채용 소스는 `needsChildcareContext`로 학원·학교의 담임교사 공고를 거른다
  - 고용24 응답 샘플(`__fixtures__`)은 값 형식을 가정한 것이다. 키를 받으면 실제 응답으로 날짜·경력·지역 표기를 확인한다
- `lib/normalize.ts` 신입·담임 판별, `lib/dedupe.ts` 중복 키, `supabase/migrations/` 스키마와 조회 함수

## 알아둘 것

- `SUPABASE_URL`·`SUPABASE_ANON_KEY`가 없으면 피드는 샘플 데이터(`lib/sample-jobs.ts`)로 동작하고 화면에 안내가 뜬다.
- 키는 `.env.local`(git 무시)에만 둔다. 키를 적어 둔 파일이 `supabase/` 폴더에 있어도 `.gitignore`(`supabase/*key*`, `supabase/*.rtf`)가 막는다. 키 값을 채팅이나 커밋에 남기지 않는다.
- `.env.local`에 Supabase 키가 있으면 `next build`가 `/`를 미리 만들면서 실제 DB를 읽는다. DB에 `supabase/migrations/0001_init.sql`이 적용되어 있지 않거나 DB에 닿지 않으면 빌드가 실패한다. DB 없이 빌드하려면 `SUPABASE_URL= SUPABASE_ANON_KEY= npm run build`처럼 빈 값으로 덮어쓴다.
- 마이그레이션은 아직 자동 적용 도구가 없다. Supabase 대시보드 SQL Editor에서 `supabase/migrations/NNNN_*.sql` 내용을 실행한다. 0001은 적용되어 있다(2026-10-21). 새 마이그레이션은 0001을 고치지 말고 새 번호로 추가한다.
- 첫 화면(`/`)은 5분 캐시다. 수집이 성공하면 크론 경로가 `revalidateTag(FEED_TAG, { expire: 0 })`로 즉시 무효화한다. `"max"`를 쓰면 갱신이 끝날 때까지 오래된 화면을 먼저 내줘서, 수집 직후 첫 방문자가 이전 데이터를 본다(실제로 재현했다). 크론이 아닌 방법으로 DB를 바꾸면 최대 5분 동안 첫 화면에 반영되지 않는다. "다시 불러오기"와 스크롤 이어 불러오기는 `/api/jobs`를 거쳐 캐시와 무관하다.
- 실제 DB에서 공개 사용자(anon)가 `collector_runs`를 읽으면 오류가 아니라 빈 목록이 나온다(Supabase 기본 권한 + 행 단위 보안). 로컬 Postgres 에뮬레이터(PGlite)에서는 오류가 나므로 둘의 동작이 다르다.
- PRD와 다르게 한 곳: 같은 출처의 서로 다른 공고는 합치지 않고(출처별 순번으로 묶음), 커서는 `(first_seen_at, group_key)` 쌍이며, 마감일이 없으면 `dedupe_key`가 null이다. D-day 칩은 카드 오른쪽 위에 두고 오늘 마감은 "오늘마감"으로 쓴다.
- Tailwind 새 클래스가 개발 서버에서 안 보이면 서버를 다시 띄운다(운영 빌드에는 영향 없음).

## SEED Design

UI는 SEED Design(React, Tailwind 4 테마)을 쓴다. 공식 문서는 `seed-design` 스킬로 읽는다.

- `seed-design/ui/*`는 CLI가 만든 스니펫이라 직접 고치지 않고 린트에서도 뺐다. 컴포넌트 추가는 `npx @seed-design/cli@latest add ui:<이름>`이다.
- 브랜드 색은 SEED의 carrot(주황) 팔레트 10개를 `app/globals.css`에서 청록으로 덮어쓴 것이다. 밝은 테마 전용이다.
- `next.config.ts`의 `resolveAlias`가 SEED recipe를 `@layer` 버전으로 연결한다(Turbopack에는 SEED의 `seed-layered` 조건 옵션이 없다). 이게 있어야 Tailwind 클래스로 SEED 컴포넌트를 덮어쓸 수 있다. SEED를 올릴 때 이 연결이 아직 맞는지 확인한다.
- 간격 토큰 클래스 중 `p-x4`, `gap-x3`, `mt-x2`는 되지만 `bottom-x5` 같은 inset 클래스는 없다. 그럴 땐 Tailwind 기본 값(`bottom-5`)을 쓴다.
- SEED 기본 조합 중 PRD 대비 기준(4.5:1)에 못 미치는 것을 고쳐 썼다: `critical` solid 뱃지(흰 글자 3.76:1)는 `bg-palette-red-800`으로 덮어썼고, TagGroup은 `tone="neutral"`을 쓴다(기본 `neutralSubtle`은 3.42:1). Badge는 `size="large"`(12px)를 쓴다. 새 조합을 쓸 때는 실제 색으로 대비를 잰다.
- SEED 컴포넌트의 기본 크기는 터치 영역 기준(44px)보다 작은 것이 있다(맨 위로 버튼 36px, 기본 크기 ActionButton 40px). 눌러야 하는 것은 `min-h-11`이나 `size="large"`로 44px 이상으로 맞춘다.
