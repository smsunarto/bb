import type { SystemBuildIdentity } from "@bb/server-contract";

export function formatBuildIdentity(build: SystemBuildIdentity): string {
  return `${build.branch}@${build.shortCommit}`;
}

export function formatBuildDomIdentity(build: SystemBuildIdentity): string {
  return `${formatBuildIdentity(build)}${build.dirty ? "+dirty" : ""}`;
}
