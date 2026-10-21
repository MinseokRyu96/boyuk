import { Suspense } from "react";
import { Feed } from "@/components/Feed";
import { FeedSkeleton } from "@/components/FeedSkeleton";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { ScrollTopButton } from "@/components/ScrollTopButton";
import { getFirstPage } from "@/lib/first-page";

async function FeedLoader() {
  const { page, updatedAt, serverNow, isSample } = await getFirstPage();

  return (
    <>
      <Header freshness={{ updatedAt, serverNow }} />
      <main>
        {isSample && (
          <p role="note" className="mx-4 mt-4 rounded-xl bg-new-bg px-4 py-2.5 text-[14px] font-medium text-new-ink">
            샘플 공고예요. 데이터베이스를 연결하면 실제 공고가 보여요.
          </p>
        )}
        <Feed initial={page} />
      </main>
      <Footer />
      <ScrollTopButton />
    </>
  );
}

/** 화면은 헤더, 공고 카드 리스트, 푸터가 전부인 한 페이지다. 데스크톱에서도 폭 480px 영역을 가운데에 둔다 */
export default function Page() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-surface shadow-[0_0_0_1px_var(--color-line)]">
      <Suspense
        fallback={
          <>
            <Header />
            <main>
              <FeedSkeleton />
            </main>
          </>
        }
      >
        <FeedLoader />
      </Suspense>
    </div>
  );
}
