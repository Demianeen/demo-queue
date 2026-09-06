import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceSkeleton() {
  return <div className="workspace" role="status" aria-label="Loading workspace">
    <header className="workspace-header"><span className="workspace-brand">Demo Queue</span></header>
    <main className="workspace-content" aria-hidden="true">
      <Skeleton className="mb-4 h-10 w-72" /><Skeleton className="mb-10 h-5 w-80 max-w-full" />
      <div className="workspace-create-grid"><div className="workspace-fields"><Skeleton className="h-14 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-14 w-full" /></div><Skeleton className="aspect-[1.52] w-full" /></div>
    </main>
  </div>;
}
