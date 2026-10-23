@AGENTS.md

# 보육공고 (어린이집 신입·담임교사 공고 모아보기)

기획은 `/Users/minseok/Desktop/md/PRD_어린이집_공고_모아보기.md`를 따른다. 모든 글(주석·문구·커밋)은 한글로 쓴다.

## 명령어

- `npm run dev` 개발 서버, `npm run build` 빌드, `npm test` 단위 테스트(vitest), `npm run typecheck`, `npm run lint`
- `npm test`에는 마이그레이션 SQL을 로컬 Postgres(PGlite)에 적용해 검증하는 `supabase/get-feed.test.ts`가 들어 있다. SQL을 고치면 반드시 돌린다.
- `npm run test:db`는 실제 Supabase DB로 수집 실행기·권한·피드 조회를 시험한다(`lib/collectors/run.db.test.ts`). `set -a; . ./.env.local; set +a; npm run test:db`처럼 키를 환경에 올려서 돌린다. `itest_<무작위>_a/b` 전용 출처의 행만 만들고 끝나면 지운다. 기본 `npm test`에서는 건너뛴다.
- `npm run test:live`는 실제 서울센터·모아맘·한솔·푸르니 사이트로 크롤러 구조가 그대로인지 확인한다(`lib/collectors/*.live.test.ts`). 사이트마다 2~3번(robots.txt 1번, 목록 1~2번)만 요청하고 저장하지 않는다. 수집이 갑자기 실패할 때 사이트 개편인지 가려 볼 때 쓴다. 기본 `npm test`에서는 건너뛴다.

## 구조

- `app/page.tsx` 피드(서버에서 첫 20건과 구별·플랫폼별 건수를 `use cache`로 조회), `app/api/jobs` 다음 페이지(`?gu=마포구&gu=서대문구`처럼 서울의 구를 여러 번 쓰면 그 구의 공고만, 서울의 구가 아닌 값은 400. `?src=samsung&src=hansol`처럼 수집 출처 코드를 여러 번 쓰면 그 플랫폼의 공고만, 알 수 없는 출처는 400. 구와 출처를 함께 걸면 둘 다 만족해야 한다. `sort=soon|late`로 마감 임박순·늦은순, 그 밖의 값과 정렬에 맞지 않는 커서는 400. 필터나 정렬이 걸린 응답에는 조건에 맞는 전체 건수 `total`이 들어 있다), `app/api/cron/[source]` 수집 엔드포인트
- **서울 구별 필터**: `components/DistrictFilter.tsx`(SEED `Chip.Toggle`, 헤더 아래에 붙는 가로 스크롤 칩, 여러 구 선택, 칩 높이 44px)와 `components/Feed.tsx`가 상태를 다룬다. 구 이름은 `lib/districts.ts`의 `SEOUL_GU`(25개)이고 공고의 `region`("서울 마포구")과 맞춘다. `get_feed` SQL은 지역·출처 조건과 마감일 정렬을 지원하지 않아서(바꾸면 마이그레이션을 따로 적용해야 한다) 필터나 마감일 정렬이 걸리면 `lib/jobs.ts`의 `scanAll`이 공고 전체를 100건씩(최대 10번, 1,000건) 모아 서버에서 거르고 정렬해 20건씩 자른다(필터·정렬이 없는 기본 화면만 DB에서 한 쪽을 바로 읽는 빠른 길). 칩의 숫자는 `fetchFeedCounts`가 같은 방식으로 센 것이고 첫 화면 캐시에 함께 들어간다. 구를 모르는 공고(region이 "서울"뿐)는 "전체"에서만 보인다. 고른 구는 `localStorage`(`boyuk:districts`)에 기억했다가 열 때 다시 건다(서버가 그린 첫 화면 뒤에 적용해 잠깐 전체가 보일 수 있다). 필터와 정렬을 모두 풀면 서버가 만든 첫 화면으로 돌아간다.
- **정렬(최신순·마감 임박순·마감 늦은순)**: 화면 위쪽의 SEED `SegmentedControl`(`components/Feed.tsx`)이고, 정렬 규칙은 `lib/sort.ts`(`compareByDeadline`, `paginateByDeadline`)다. 최신순은 `get_feed`가 주는 순서 그대로지만 마감일 순은 SQL이 지원하지 않아서 `lib/jobs.ts`의 `scanAll`이 조건에 맞는 공고 전체를 모아(최대 1,000건) 서버에서 정렬하고 20건씩 자른다. 마감일이 없는 상시채용은 D-day를 비교할 수 없어서 임박순·늦은순 모두 맨 뒤에 두고, 같은 마감일끼리는 최신순이다. 마감일 정렬의 커서는 `[마감일, 수집 시각, 키]` 세 값이라(`lib/cursor.ts`) 페이지 사이에 공고가 늘거나 줄어도 겹치거나 빠지지 않고, 최신순 커서(두 값)와 섞어 쓸 수 없다(구·정렬을 바꾸면 커서 없이 처음부터 받는다). 정렬은 고른 구·플랫폼과 함께 쓸 수 있고 저장하지 않는다.
- **플랫폼(수집 출처) 필터**: 목록·지도 위의 가로 스크롤 칩 `components/SourceFilter.tsx`("모든 플랫폼" + 서울시센터·한솔·푸르니·삼성 …, 여러 개 선택, 선택하지 않은 필터는 걸지 않는다)와 `lib/filters.ts`(`matchesFilters`)다. 같은 공고가 여러 출처에 올라와 한 카드로 묶여 있으면 그중 하나라도 고른 출처이면 통과한다(그래서 칩 숫자의 합이 전체보다 클 수 있다). 지금 크론이 수집하는 출처(`lib/sources.ts`의 `ACTIVE_SOURCES`)는 공고가 0건이어도 칩을 보여 주되 누를 수 없게 해서 "수집은 하는데 지금 공고가 없는 것"과 "수집하지 않는 것"을 구분한다(크론을 바꾸면 이 목록도 맞춘다). 지도 보기에도 같은 조건이 `/api/jobs/map?src=…`로 전달된다. 플랫폼 선택은 저장하지 않는다.
- **지도 보기(카카오맵)**: 맨 위 "목록 | 지도" 전환(`components/Feed.tsx`)과 `components/MapView.tsx`가 그린다. `NEXT_PUBLIC_KAKAO_MAP_KEY`(JavaScript 키)가 없으면 전환 자체가 숨겨져 사이트는 예전 그대로다. SDK는 `lib/kakao-sdk.ts`가 브라우저에서 불러오고(가까운 마커는 숫자로 묶는 clusterer 포함), 마커를 누르면 그 공고 카드가 지도 아래에 뜨고 지도를 누르면 닫힌다. 지도에 찍는 공고는 `/api/jobs/map`(`?gu=`로 구 필터 적용, 구 필터가 같이 걸린다)이 돌려주는 위치를 찾은 공고이고, 위치를 못 찾은 공고는 "N건은 지도에 없어요"로 알리며 목록으로 안내한다. JavaScript 키는 도메인 등록으로 보호한다: 카카오 개발자 사이트의 앱 > 플랫폼 > Web에 `https://boyuk.vercel.app`와 `http://localhost:3000`을 등록해야 지도가 뜬다.
- **위치 찾기**: 공고에는 어린이집 이름과 구만 있어서 `lib/geo/kakao-places.ts`가 카카오 로컬 API(키워드 장소 검색, `KAKAO_REST_API_KEY`, 서버 전용)로 "마포구 가나다어린이집"을 검색해 좌표를 얻는다. 결과가 정말 그 어린이집인지는 우리가 확인한다: 이름의 알맹이(설립 형태·법인 표기·끝의 "어린이집"을 뗀 글자)가 같거나 한쪽이 다른 쪽을 포함하되 짧은 쪽이 3글자 이상이어야 하고, 주소가 서울이며(구를 알면 그 구) 좌표가 한반도 안이어야 한다. 아니면 못 찾은 것으로 두어 틀린 곳에 핀을 꽂지 않는다. 같은 어린이집(이름+구)은 한 번만 찾고 공고 전체에 재사용한다(`lib/geo/geocode.ts`). 수집 직후 새 어린이집 40곳까지 자동으로 채우고(`runCollector`, 실패해도 수집은 성공), 처음 켤 때 기존 공고를 채우거나 수동으로 다시 돌릴 때는 `GET /api/cron/geocode`(CRON_SECRET 필요, 150곳까지, 스케줄에는 넣지 않았다)를 부른다. 못 찾은 공고는 7일 뒤에 다시 찾아본다. 카카오 앱에서 카카오맵(로컬) 사용 설정을 켜야 할 수 있다(403이면 그 안내가 오류 문구에 나온다).
- `lib/collectors/` 소스별 수집기. 고용24(`work24.ts`, XML)와 사람인(`saramin.ts`, JSON), 서울시육아종합지원센터(`seoul-center.ts`)·모아맘(`moamam.ts`)·한솔(`hansol.ts`)·푸르니(`puruni.ts`)·삼성(`samsung.ts`) 크롤러(HTML)까지 일곱 소스가 모두 구현됐다(아직 만들지 못한 소스는 `implemented: false`로 두면 501을 돌려준다). 등록은 `lib/collectors/index.ts`
  - 공통 도구: `http.ts`(시간 초과·재시도·호출 간격·키 가리기), `dates.ts`, `region.ts`, `url.ts`(http(s)만 허용), `config.ts`(검색어·지역·사람인 하루 예산)
  - 크롤러 공통 규칙: 실행할 때마다 `robots.ts`의 `assertRobotsAllows`로 robots.txt를 확인하고, 막혀 있으면 목록을 한 번도 요청하지 않고 `CrawlNotAllowedError`로 실패한다. 요청 사이는 2초, User-Agent는 `boyuk-collector/0.1 (+저장소 주소)`다. 제목·어린이집명·지역·마감일·원문 링크만 저장하고, 담당자 연락처 같은 개인정보는 가져오지 않는다. 상세 페이지는 읽지 않는다(한솔·삼성만 서울 여부를 확인하려고 신입·담임 후보의 상세를 연다). HTML 시험 자료(`__fixtures__/*.html`)는 사이트 내용을 복제하지 않도록 구조만 따른 지어낸 값이다.
  - **서울 공고만 저장한다**(`config.ts`의 `TARGET_PROVINCES`, 실행기 `run.ts`의 `shouldSave`). 지역을 모르는 공고는 서울인지 확인할 수 없어서 저장하지 않는다. 지역 칸이 없는 출처는 글자에서 서울을 읽는다(`region.ts`의 `inferRegion`: 제목·어린이집명에 "서울"이나 서울에만 있는 구 이름이 있으면 서울. 강서구·중구는 다른 도시에도 있어 뺐다). 값을 바꾸면 이미 저장된 행에는 소급되지 않는다. 완전히 읽은 소스는 다음 수집에서 "사라진 공고 숨기기"가 정리하지만, 일부만 읽은 소스(서울센터·모아맘)는 마감일이 지나야 숨겨지므로 필요하면 DB를 직접 정리한다.
  - 서울센터(`seoul-center.ts`): 목록 GET(`JobOfferSlPL.jsp?flag=SlPL&offset=…&endYn=N&schEmpGbCode=32`)을 10건씩 읽는다. 구인 중 보육교사 공고가 1,400건이 넘어(2026-10-23) 최신 40쪽(400건)만 읽고(`SEOUL_CENTER_MAX_PAGES`), 그래서 `complete: false`다. 표의 제목은 길면 "..."로 잘리므로 `<a title>`의 전체 제목을 쓴다. 유형이 "직장"이면 `RawJob.isWorkplace`로 직장어린이집 표시를 한다. 신입 여부는 목록에 없어서 "애매하면 저장" 원칙으로 담임·보육교사 제목만 판별한다. 서울센터 약관(제14조 ④·제16조 ②)은 사전 승낙 없는 복제·상업적 이용을 막는다. 지인끼리만 쓰는 비영리 용도라는 판단으로 수집하고 있으니, 서비스를 공개하거나 수익을 낼 때는 승낙을 받거나 수집을 끄고 링크 안내로 바꾼다.
  - 모아맘(`moamam.ts`): `recruit.moamom.com`의 교직원채용(`staff-list.php`, type=1)과 정기채용(`regular-list.php`, type=2) 목록을 `?offset=10` 단위로 읽는다. 한 줄에 제목("[지역] 제목"), 어린이집명, 경력 구분(신입·경력·무관), 접수 기간이 다 있어서 상세는 읽지 않고, 경력 구분은 `careerHint`로 옮긴다. 마감된 줄(`li.deadline`)은 버리고, 한 쪽이 전부 마감이면 멈춘다(그래서 `complete: false`). `sourceId`는 `type-idx`다. 정기채용은 제목에 직무가 없어서 `rawText`에 "교사 정기채용"을 넣는다(메인 화면의 분류가 "교사"). robots.txt는 전체 허용이다(2026-10-23).
  - 모아맘 사이트는 인증서 체인이 잘못돼 있다: 서버가 구형 중간 인증서만 보내고 발급자(`Sectigo Public Server Authentication CA DV R36`)의 인증서를 보내지 않아서, 브라우저와 curl은 통과하지만 Node `fetch`는 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`로 실패한다. 인증서 검증을 끄지 않는다. 지금은 robots.txt 단계에서 실패로 기록되고 요청은 더 나가지 않는다.
  - 한솔(`hansol.ts`): `docu.hansolhope.or.kr`은 robots.txt가 없다(404). 화면의 목록은 iframe이 불러오는 `/recruit/recruit.do`이고, 사이트 폼은 POST지만 GET으로도 똑같이 동작한다(`flg=list&mCurrent=2&sCurrent=1&pageNum=N&listNum=10&STTUS=001`, STTUS=001이 "접수중 보기"). 접수 중 공고는 마흔 건 남짓(네다섯 쪽)이라 `complete: true`로 처리한다. 목록에는 제목·접수 기간·상태뿐이라 어린이집 이름은 제목에서 "…어린이집"까지를 떼어 쓰고(`orgNameFromTitle`), 지역은 제목 대괄호·글자에서 읽고, 못 읽은 신입·담임 후보는 상세 본문의 "근무지 : 경북 포항" 한 줄에서 읽는다(`parseHansolWorkplace`, 후보당 요청 1번). 경력 구분이 없어 "애매하면 저장" 원칙을 따르고, 보조·대체·연장교사와 조리사 같은 공고는 제목으로 거른다. 원문 링크는 바깥 틀에 상세를 넣어 보여 주는 `index.do?flg=view&…&empmn_sn=번호`다.
  - 푸르니(`puruni.ts`): `recruit.puruni.com/recruit/notice`는 접수 중 공고만 올라오는 작은 게시판이다(2026-10-23에 두 건). `?page=N`으로 읽고, 상세는 `/recruit/notice/view?page=&idx=`가 GET으로 열린다. 목록에 어린이집 이름 칸이 없어서 제목에서 뗀다(`title.ts`의 `orgNameFromTitle`, 한솔과 공유). **robots.txt가 전체 금지(`Disallow: /`)인데 사용자가 소수 지인용 비영리 서비스라는 이유로 이 사이트만 무시하기로 했다.** `index.ts`에서 `ignoreRobotsTxt: true`로 켜 두었고(그때는 robots.txt 요청도 보내지 않는다), 지우면 수집이 `CrawlNotAllowedError`로 멈춘다. 이용약관(`/recruit/use`)에는 수집·복제를 막는 문구가 없다. 요청은 목록 한두 쪽, 하루 한 번, 식별 가능한 User-Agent를 쓰고, 403 같은 기술적 차단은 우회하지 않고 실패로 기록한다. 공고가 0건인 날은 수집 실행기의 "0건은 실패" 규칙에 걸려 실패로 기록된다(작은 게시판이라 있을 수 있다). 서비스를 공개하거나 수익을 낼 때는 사이트의 승낙을 받거나 이 옵션을 끈다.
  - 삼성(`samsung.ts`): `samsungwelfare.org/html/welfare/nursery/recruit.asp`. 표의 어린이집명 옆 진행중 아이콘(`img.ico-ing`)이 있는 줄만 읽고, 표 위의 "진행중인 모집 공고 : 총 N건"만큼 읽으면 멈춘다(`?page=N`, 상세 `recruit_view.asp?seq=&page=&prc_seq=view`도 GET으로 열린다). 목록에 제목 칸이 없어 직종을 제목으로 쓴다. 지역은 목록에도 상세에도 없어서, 신입·담임 후보의 상세에서 연락처 지역번호가 02일 때만 서울로 본다(추정이며 전화번호는 저장하지 않는다). **robots.txt가 전체 금지(`Disallow: /`)이고 이용약관(`/html/terms.asp`)이 회원이 얻은 정보를 사전 승낙 없이 복제·제3자에게 제공하는 것을 금지하는데, 푸르니와 같은 이유로 이 사이트의 robots.txt를 무시한다**(`index.ts`의 `ignoreRobotsTxt: true`). 서비스를 공개하거나 수익을 낼 때는 승낙을 받거나 이 옵션을 끈다.
  - 수집기는 `{ jobs, complete }`를 돌려준다. `complete: false`(호출 한도·쪽 상한)이면 실행기(`run.ts`)가 "사라진 공고 숨기기"를 건너뛴다
  - 범용 채용 소스는 `needsChildcareContext`로 학원·학교의 담임교사 공고를 거른다
  - 고용24 성공 응답 샘플(`__fixtures__/work24-list.xml`)은 값 형식을 가정한 것이다. 키가 채용정보 API로 승인되면 실제 응답으로 날짜·경력·지역 표기를 확인한다
  - 고용24 오류는 HTTP 200으로 `<GO24><error>…</error></GO24>`가 온다(실제 호출로 확인). "신청하신 OpenApi 서비스가 존재하지 않습니다"는 키를 모르거나 이 서비스로 승인되지 않았다는 뜻이고(틀린 키와 응답이 같다), "개인회원은 사용할 수 없는 OPEN-API입니다."는 키는 알아봤지만 계정이 개인회원이라는 뜻이다. 이 API는 기업회원 전용이다(2026-10-21 실제 호출로 확인)
  - 사람인 이용신청 양식: 이메일 인증, 이름, 회사명/학교명, 부서명/전공명, 전화번호, "API 사용할 곳 URL", 이용목적(50자 이상). 승인 메일 후 앱 등록 → access-key. 이용요금 발생·대가 수취·제휴 오인 행위 금지, 일 500건
- `lib/normalize.ts` 신입·담임 판별, `lib/dedupe.ts` 중복 키, `supabase/migrations/` 스키마와 조회 함수

## 알아둘 것

- `SUPABASE_URL`·`SUPABASE_ANON_KEY`가 없으면 피드는 샘플 데이터(`lib/sample-jobs.ts`)로 동작하고 화면에 안내가 뜬다.
- 키는 `.env.local`(git 무시)에만 둔다. 키를 적어 둔 파일이 `supabase/` 폴더에 있어도 `.gitignore`(`supabase/*key*`, `supabase/*.rtf`)가 막는다. 키 값을 채팅이나 커밋에 남기지 않는다.
- `.env.local`에 Supabase 키가 있으면 `next build`가 `/`를 미리 만들면서 실제 DB를 읽는다. DB에 `supabase/migrations/0001_init.sql`이 적용되어 있지 않거나 DB에 닿지 않으면 빌드가 실패한다. DB 없이 빌드하려면 `SUPABASE_URL= SUPABASE_ANON_KEY= npm run build`처럼 빈 값으로 덮어쓴다.
- 마이그레이션은 아직 자동 적용 도구가 없다. Supabase 대시보드 SQL Editor에서 `supabase/migrations/NNNN_*.sql` 내용을 실행한다. 0001은 적용되어 있다(2026-10-21). 새 마이그레이션은 0001을 고치지 말고 새 번호로 추가한다. **0002_locations.sql(공고 위치 열 추가, `get_feed`가 위도·경도를 함께 돌려주도록 확장)은 아직 실제 DB에 적용하지 않았다.** 적용하기 전에는 지도에 찍을 위치가 없고, 위치 채우기(`geocode`)는 열이 없어 실패해 로그만 남긴다(수집은 영향 없음). 앱 코드는 두 상태 모두에서 동작한다.
- 첫 화면(`/`)은 5분 캐시다. 수집이 성공하면 크론 경로가 `revalidateTag(FEED_TAG, { expire: 0 })`로 즉시 무효화한다. `"max"`를 쓰면 갱신이 끝날 때까지 오래된 화면을 먼저 내줘서, 수집 직후 첫 방문자가 이전 데이터를 본다(실제로 재현했다). 크론이 아닌 방법으로 DB를 바꾸면 최대 5분 동안 첫 화면에 반영되지 않는다. "다시 불러오기"와 스크롤 이어 불러오기는 `/api/jobs`를 거쳐 캐시와 무관하다.
- 실제 DB에서 공개 사용자(anon)가 `collector_runs`를 읽으면 오류가 아니라 빈 목록이 나온다(Supabase 기본 권한 + 행 단위 보안). 로컬 Postgres 에뮬레이터(PGlite)에서는 오류가 나므로 둘의 동작이 다르다.
- PRD와 다르게 한 곳: 같은 출처의 서로 다른 공고는 합치지 않고(출처별 순번으로 묶음), 커서는 `(first_seen_at, group_key)` 쌍이며, 마감일이 없으면 `dedupe_key`가 null이다. D-day 칩은 카드 오른쪽 위에 두고 오늘 마감은 "오늘마감"으로 쓴다.
- Tailwind 새 클래스가 개발 서버에서 안 보이면 서버를 다시 띄운다(운영 빌드에는 영향 없음).

## 배포 (Vercel)

- 프로젝트 `minseoks/boyuk`, 주소 `https://boyuk.vercel.app`. GitHub `main`에 푸시하면 자동 배포된다. 로컬에는 `.vercel` 연결이 없어서 CLI는 `--project boyuk --scope minseoks`를 붙인다.
- **Vercel에 환경변수를 넣어야 실제 공고가 보인다.** 없으면 피드가 샘플 데이터로 동작하고 화면에 "샘플 공고예요" 안내가 뜬다(2026-10-23에 이 상태로 배포되어 있었다). 필요한 것: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`(Production). 지도 보기를 켜려면 `NEXT_PUBLIC_KAKAO_MAP_KEY`(JavaScript 키)와 `KAKAO_REST_API_KEY`(REST API 키)도 넣고, 위치 열을 만드는 0002 마이그레이션을 먼저 적용한다. 고용24·사람인 키는 쓸 수 있게 되면 `WORK24_API_KEY`·`SARAMIN_API_KEY`를 더한다. 환경변수를 바꾼 뒤에는 다시 배포해야 반영된다.
- `vercel.json`의 `crons`가 **하루 두 번** 수집 엔드포인트를 부른다. 새벽(UTC 21:00~21:30 = 한국 시간 6:00~6:30)과 점심(UTC 03:00~03:30 = 한국 시간 12:00~12:30)이고, 각각 서울센터 → 한솔 → 푸르니 → 삼성 순으로 10분 간격이다. 점심 줄은 `?slot=noon`을 붙인 같은 경로다(Hobby는 한 줄이 하루 한 번만 돌 수 있어서 시각만 다른 줄을 하나 더 둔다. 경로 처리기는 쿼리를 쓰지 않는다). Hobby는 정확한 시각이 아니라 그 시각이 속한 시간대 안에서 ±59분 오차로 실행된다. Vercel이 `CRON_SECRET`을 `Authorization: Bearer`로 붙여 주고, 경로 처리기(`app/api/cron/[source]/route.ts`)가 확인한다. 수집이 성공하면 첫 화면 캐시를 바로 무효화하므로 새 공고는 수집 직후 첫 방문부터 보인다. 고용24·사람인은 키를 쓸 수 있게 되면, 모아맘은 인증서 문제를 풀면 두 번 모두 더한다. 시각을 바꾸거나 소스를 더할 때는 `vercel.json`의 줄을 고친다(크론은 하루 한 번보다 촘촘히 돌릴 수 없고, 더 자주 돌리려면 Pro가 필요하다). 지금 바로 한 번 돌리려면 `CRON_SECRET`을 붙여 엔드포인트를 직접 부른다.

## SEED Design

UI는 SEED Design(React, Tailwind 4 테마)을 쓴다. 공식 문서는 `seed-design` 스킬로 읽는다.

- `seed-design/ui/*`는 CLI가 만든 스니펫이라 직접 고치지 않고 린트에서도 뺐다. 컴포넌트 추가는 `npx @seed-design/cli@latest add ui:<이름>`이다.
- 브랜드 색은 SEED의 carrot(주황) 팔레트 10개를 `app/globals.css`에서 청록으로 덮어쓴 것이다. 밝은 테마 전용이다.
- `next.config.ts`의 `resolveAlias`가 SEED recipe를 `@layer` 버전으로 연결한다(Turbopack에는 SEED의 `seed-layered` 조건 옵션이 없다). 이게 있어야 Tailwind 클래스로 SEED 컴포넌트를 덮어쓸 수 있다. SEED를 올릴 때 이 연결이 아직 맞는지 확인한다.
- 간격 토큰 클래스 중 `p-x4`, `gap-x3`, `mt-x2`는 되지만 `bottom-x5` 같은 inset 클래스는 없다. 그럴 땐 Tailwind 기본 값(`bottom-5`)을 쓴다.
- SEED 기본 조합 중 PRD 대비 기준(4.5:1)에 못 미치는 것을 고쳐 썼다: `critical` solid 뱃지(흰 글자 3.76:1)는 `bg-palette-red-800`으로 덮어썼고, TagGroup은 `tone="neutral"`을 쓴다(기본 `neutralSubtle`은 3.42:1). Badge는 `size="large"`(12px)를 쓴다. 새 조합을 쓸 때는 실제 색으로 대비를 잰다.
- SEED 컴포넌트의 기본 크기는 터치 영역 기준(44px)보다 작은 것이 있다(맨 위로 버튼 36px, 기본 크기 ActionButton 40px). 눌러야 하는 것은 `min-h-11`이나 `size="large"`로 44px 이상으로 맞춘다.
