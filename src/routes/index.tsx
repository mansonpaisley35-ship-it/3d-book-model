import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const BookScene = lazy(() => import("@/components/book/BookScene"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Book Canvas — 3D Hardcover Mockup Studio" },
      {
        name: "description",
        content:
          "Upload your own front, back, spine and page-edge artwork onto a procedurally modelled cloth hardcover and inspect it from every angle in 3D.",
      },
      { property: "og:title", content: "Book Canvas — 3D Hardcover Mockup Studio" },
      {
        property: "og:description",
        content:
          "Upload your own front, back, spine and page-edge artwork onto a procedurally modelled cloth hardcover and inspect it from every angle in 3D.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0e1319]">
      <div className="absolute inset-0">
        <ClientOnly fallback={null}>
          <Suspense fallback={null}>
            <BookScene />
          </Suspense>
        </ClientOnly>
      </div>

      <div className="pointer-events-none relative z-10 flex min-h-screen flex-col justify-between p-8 md:p-14">
        <header>
          <p className="text-[11px] tracking-[0.35em] text-[#8fa3ba] uppercase">Book Canvas</p>
          <h1 className="mt-3 max-w-md font-serif text-3xl leading-tight text-[#e8eef5] md:text-4xl">
            Your artwork, case-bound
          </h1>
        </header>

        <footer className="flex flex-wrap items-end justify-between gap-6">
          <p className="max-w-sm text-sm leading-relaxed text-[#8fa3ba]">
            A blank cloth hardcover modelled procedurally in three.js. Tap the pencil on the
            cover to import images for the front, back, spine and page edges.
          </p>
          <p className="text-[11px] tracking-[0.2em] text-[#5f7387]">
            DRAG TO ORBIT · SCROLL TO ZOOM
          </p>
        </footer>
      </div>
    </main>
  );
}
