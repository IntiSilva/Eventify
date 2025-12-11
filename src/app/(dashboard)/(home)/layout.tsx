import ThreadsBackground from "@/components/AnimatedBackgrounds/ThreadsBackground";

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
   <div className="relative min-h-screen">
      {/* Background top level so it doesn't interact with page logic */}
      <div
        className="
          fixed left-0 right-0
          top-[-40px] h-[calc(100vh+80px)]
          md:top-0 md:h-screen
          -z-10 bg-black
          pointer-events-none
        "
      >
        <ThreadsBackground
          scrollSensitivity={0.8}
        />
      </div>
      {children}
    </div>
  );
}
