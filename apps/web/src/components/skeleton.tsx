export function Shimmer({ className }: { className: string }) {
  return <span className={`block animate-pulse bg-border ${className}`} />
}

export function SkeletonRows({ count, height }: { count: number; height: string }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 border-b border-border/60 px-2 ${height}`}
          style={{ opacity: Math.max(0.15, 1 - i / count) }}
        >
          <Shimmer className="h-2 w-24" />
          <Shimmer className="h-2 w-16" />
          <Shimmer className="h-2 w-32" />
          <Shimmer className="h-2 w-40" />
          <Shimmer className="h-2 w-14" />
          <Shimmer className="ml-auto h-2 w-20" />
        </div>
      ))}
    </div>
  )
}

export function LoadingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="label flex items-center gap-2">
      <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-accent" />
      {children}
    </p>
  )
}
