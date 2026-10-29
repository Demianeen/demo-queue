import { Skeleton } from "@/components/ui/skeleton";

/** The shell's outline while the workspace loads on the server: sidebar, header and a list. */
export function WorkspaceSkeleton() {
  return <div className="dq-app" role="status" aria-label="Loading workspace">
    <div className="dq-skeleton-shell" aria-hidden="true">
      <div className="dq-skeleton-sidebar">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-3 h-3 w-20" />
        <Skeleton className="h-5 w-44" /><Skeleton className="ml-4 h-4 w-28" /><Skeleton className="ml-4 h-4 w-24" /><Skeleton className="ml-4 h-4 w-28" />
        <Skeleton className="mt-3 h-3 w-20" />
        <Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-36" />
      </div>
      <div className="dq-skeleton-panel">
        <div className="dq-header"><Skeleton className="h-4 w-32" /></div>
        <div className="dq-page">
          <Skeleton className="mb-2 h-6 w-40" /><Skeleton className="mb-6 h-4 w-72 max-w-full" />
          <div className="dq-card">{[0, 1, 2, 3, 4].map((row) => <div key={row} className="dq-row"><Skeleton className="size-5" /><Skeleton className="h-4 w-56" /><Skeleton className="ml-auto h-4 w-20" /></div>)}</div>
        </div>
      </div>
    </div>
  </div>;
}
