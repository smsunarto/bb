import type { SystemBuildIdentity } from "@bb/server-contract";
import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";

export interface SidebarBuildIdentityProps {
  build: SystemBuildIdentity | null;
}

/** Quiet, non-interactive source-checkout identity ribbon for the app footer. */
export function SidebarBuildIdentity({ build }: SidebarBuildIdentityProps) {
  if (build === null) {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      data-testid="sidebar-build-identity"
      title={`${build.branch}@${build.commit}${build.dirty ? " (dirty)" : ""}`}
      className="-mx-2 flex w-auto min-w-0 gap-2 rounded-none border-x-0 border-y border-sidebar-border bg-sidebar-accent/60 px-2.5 py-1.5 font-normal text-muted-foreground shadow-none group-data-[collapsible=icon]:hidden"
    >
      <Icon
        name="GitBranch"
        aria-hidden
        className="size-3.5 shrink-0 text-sidebar-foreground/60"
      />
      <span className="min-w-0 flex-1 truncate">{build.branch}</span>
      <span className="shrink-0 rounded-sm border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-mono text-sidebar-foreground/80">
        @{build.shortCommit}
        {build.dirty ? "•" : null}
      </span>
    </Badge>
  );
}
