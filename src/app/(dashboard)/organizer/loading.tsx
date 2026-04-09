import DashboardPageWrapper from "@/components/DashboardPageWrapper"

function SignalCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/10 bg-black/65 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="h-3 w-14 skeleton" />
        <div className="size-6 skeleton !rounded-md" />
      </div>
      <div className="mt-2 h-4 w-11/12 skeleton" />
      <div className="mt-2 h-3 w-full skeleton" />
    </div>
  )
}

export default function OrganizerLoading() {
  return (
    <DashboardPageWrapper>
      <div className="relative min-h-screen">
        <div className="fixed left-0 right-0 top-0 h-screen -z-10 bg-black pointer-events-none" />

        <section className="w-full max-w-7xl mx-auto py-8 space-y-6 px-2 xs2:px-4 md:px-6">
          <div className="flex flex-col gap-5 md:gap-1.5 mb-3 md:mb-8">
            <div className="self-end flex gap-3 mr-2 md:mr-0">
              <div className="h-9 w-20 skeleton !rounded-md" />
              <div className="h-10 w-24 skeleton !rounded-md" />
            </div>

            <div className="h-10 w-56 skeleton" />
            <div className="h-4 w-72 max-w-full skeleton" />
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <SignalCardSkeleton key={`signal-card-skeleton-${index}`} />
              ))}
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
              <article className="rounded-2xl border border-white/10 bg-black/70 p-4 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="h-3 w-20 skeleton" />
                    <div className="h-5 w-56 max-w-full skeleton" />
                  </div>
                  <div className="h-3 w-20 skeleton" />
                </div>

                <div className="mt-4 space-y-2.5">
                  <div className="h-6 w-3/4 skeleton" />
                  <div className="h-3 w-1/2 skeleton" />
                  <div className="h-3 w-2/3 skeleton" />
                  <div className="h-8 w-24 skeleton !rounded-md" />
                </div>
              </article>

              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/70 px-3 py-3 md:px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-2 w-full">
                      <div className="h-4 w-24 skeleton" />
                      <div className="h-3 w-11/12 skeleton" />
                    </div>
                    <div className="h-8 w-16 skeleton !rounded-md" />
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/70 px-3 py-3 md:px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-2 w-full">
                      <div className="h-4 w-20 skeleton" />
                      <div className="h-3 w-11/12 skeleton" />
                    </div>
                    <div className="h-8 w-16 skeleton !rounded-md" />
                  </div>
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-white/10 bg-black/70 p-3.5 md:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-2">
                  <div className="h-4 w-32 skeleton" />
                  <div className="h-3 w-60 max-w-full skeleton" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-24 skeleton" />
                  <div className="h-3 w-28 skeleton" />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="h-7 w-20 skeleton !rounded-md" />
                <div className="h-7 w-[126px] skeleton !rounded-md" />
                <div className="h-7 w-[100px] skeleton !rounded-md" />
              </div>

              <div className="mt-3 h-36 w-full rounded-md border border-white/10 bg-black/30 p-2">
                <div className="h-full w-full skeleton" />
              </div>
            </section>

            <div className="h-11 w-full md:w-[410px] skeleton" />
            <div className="h-7 w-44 skeleton" />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`events-skeleton-${index}`}
                  className="rounded-2xl border border-white/10 bg-black/60 p-3"
                >
                  <div className="h-40 w-full skeleton" />
                  <div className="mt-3 h-4 w-3/4 skeleton" />
                  <div className="mt-2 h-3 w-2/3 skeleton" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </DashboardPageWrapper>
  )
}
