import type { SystemBuildIdentity } from "@bb/server-contract";
import { SidebarMenuItem } from "@/components/ui/sidebar.js";

export interface SidebarBuildIdentityProps {
  build: SystemBuildIdentity | null;
}

/** Quiet, non-interactive source-checkout identity for the app footer. */
export function SidebarBuildIdentity({ build }: SidebarBuildIdentityProps) {
  if (build === null) {
    return null;
  }

  return (
    <SidebarMenuItem
      data-testid="sidebar-build-identity"
      title={`${build.branch}@${build.commit}${build.dirty ? " (dirty)" : ""}`}
      className="flex min-w-0 flex-1 items-center justify-end text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
    >
      <span className="min-w-0 truncate">{build.branch}</span>
      <span className="shrink-0">
        @{build.shortCommit}
        {build.dirty ? "•" : null}
      </span>
    </SidebarMenuItem>
  );
}
