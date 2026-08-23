import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const BookScene = lazy(() => import("@/components/book/BookScene"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Press Book — Three.js Hardcover Study" },
      {
        name: "description",
        content:
          "A procedurally modelled Stripe Press–style hardcover, rebuilt in three.js with true joint grooves, cloth sheen and striated page edges.",
      },
      { property: "og:title", content: "Press Book — Three.js Hardcover Study" },
      {
        property: "og:description",
        content:
          "A procedurally modelled Stripe Press–style hardcover, rebuilt in three.js with true joint grooves, cloth sheen and striated page edges.",
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
          <p className="text-[11px] tracking-[0.35em] text-[#8fa3ba] uppercase">Press</p>
          <h1 className="mt-3 max-w-md font-serif text-3xl leading-tight text-[#e8eef5] md:text-4xl">
            The Origins of Efficiency
          </h1>
        </header>

        <footer className="flex flex-wrap items-end justify-between gap-6">
          <p className="max-w-sm text-sm leading-relaxed text-[#8fa3ba]">
            Case-bound hardcover modelled procedurally in three.js — one extruded profile
            gives symmetric joint grooves on both boards, a rounded spine and smooth,
            continuous normals.
          </p>
          <p className="text-[11px] tracking-[0.2em] text-[#5f7387]">
            DRAG TO ORBIT · SCROLL TO ZOOM
          </p>
        </footer>
      </div>
    </main>
  );
}
