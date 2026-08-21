import type { SystemBuildIdentity } from "@bb/server-contract";

export interface SidebarBuildIdentityProps {
  build: SystemBuildIdentity | null;
}

/** Quiet, non-interactive source-checkout identity ribbon for the app footer. */
export function SidebarBuildIdentity({ build }: SidebarBuildIdentityProps) {
  if (build === null) {
    return null;
  }

  return (
    <div
      data-testid="sidebar-build-identity"
      title={`${build.branch}@${build.commit}${build.dirty ? " (dirty)" : ""}`}
      className="-mx-2 flex min-w-0 items-center justify-center border-y border-sidebar-border bg-sidebar-accent/50 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
    >
      <span className="min-w-0 truncate">{build.branch}</span>
      <span className="shrink-0">
        @{build.shortCommit}
        {build.dirty ? "•" : null}
      </span>
    </div>
  );
}
