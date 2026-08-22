import { realpath } from "node:fs/promises";
import semver from "semver";
import { z } from "zod";
import { getCheckoutRef, runGit } from "@bb/host-workspace";
import type {
  SystemBuildIdentity,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";

const NPM_LATEST_URL = "https://registry.npmjs.org/bb-app/latest";
const NPM_LATEST_TIMEOUT_MS = 5_000;
const NPM_LATEST_CACHE_TTL_MS = 60 * 60 * 1000;
const GIT_IDENTITY_TIMEOUT_MS = 5_000;
const UPGRADE_COMMAND = "npx bb-app@latest";

const npmLatestResponseSchema = z
  .object({
    version: z.string().min(1),
  })
  .passthrough();

export interface AppVersionService {
  getSystemVersion(
    args?: AppVersionGetSystemVersionArgs,
  ): Promise<SystemVersionResponse>;
}

export interface AppVersionGetSystemVersionArgs {
  forceRefresh?: boolean;
}

export interface CreateAppVersionServiceArgs {
  build: SystemBuildIdentity | null;
  config: Pick<ServerRuntimeConfig, "appVersion" | "isDevelopment">;
  fetchImpl?: typeof fetch;
  logger: ServerLogger;
  /** Override the cache TTL. Tests use this; production uses the default. */
  cacheTtlMs?: number;
  /** Inject a custom clock for cache invalidation tests. */
  now?: () => number;
}

interface NpmLatestCacheEntry {
  cachedAt: number;
  latestVersion: string;
}

/**
 * Resolves the source checkout identity once during server startup. The root
 * check prevents an installed package inside somebody else's repository from
 * inheriting that unrelated checkout's identity.
 */
export async function resolveGitBuildIdentity(
  sourceCheckoutRoot: string,
): Promise<SystemBuildIdentity | null> {
  try {
    const [expectedRoot, reportedRoot] = await Promise.all([
      realpath(sourceCheckoutRoot),
      runGit(["rev-parse", "--show-toplevel"], {
        cwd: sourceCheckoutRoot,
        timeoutMs: GIT_IDENTITY_TIMEOUT_MS,
      }).then((result) => realpath(result.stdout.trim())),
    ]);
    if (reportedRoot !== expectedRoot) {
      return null;
    }

    const [checkout, status] = await Promise.all([
      getCheckoutRef(expectedRoot, { timeoutMs: GIT_IDENTITY_TIMEOUT_MS }),
      runGit(
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v1",
          "--untracked-files=no",
          "--ignore-submodules=untracked",
        ],
        { cwd: expectedRoot, timeoutMs: GIT_IDENTITY_TIMEOUT_MS },
      ),
    ]);
    if (checkout.kind !== "branch" && checkout.kind !== "detached") {
      return null;
    }

    const commit = checkout.headSha;
    if (commit === null || !/^[0-9a-f]{40}$/u.test(commit)) {
      return null;
    }

    return {
      branch: checkout.kind === "branch" ? checkout.branchName : "HEAD",
      commit,
      shortCommit: commit.slice(0, 7),
      dirty: status.stdout.trim().length > 0,
    };
  } catch {
    return null;
  }
}

export function createAppVersionService(
  args: CreateAppVersionServiceArgs,
): AppVersionService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const cacheTtlMs = args.cacheTtlMs ?? NPM_LATEST_CACHE_TTL_MS;
  const now = args.now ?? (() => Date.now());
  const logger = args.logger;
  const config = args.config;
  const build = args.build;

  let cache: NpmLatestCacheEntry | null = null;
  let inflight: Promise<string | null> | null = null;

  async function fetchNpmLatest(): Promise<string | null> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      NPM_LATEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(NPM_LATEST_URL, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, url: NPM_LATEST_URL },
          "Failed to fetch latest bb-app version from npm",
        );
        return null;
      }
      const json = await response.json();
      const parsed = npmLatestResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { url: NPM_LATEST_URL, issue: parsed.error.message },
          "npm latest response did not match expected shape",
        );
        return null;
      }
      return parsed.data.version;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { url: NPM_LATEST_URL, error: message },
        "npm latest lookup failed",
      );
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // Per Sawyer's iteration decision (2026-05-20, plan §"Iteration
  // decisions"): once the TTL has expired we always re-fetch, and a failed
  // fetch returns null even if a stale cached value exists. This is choice
  // "A" (null on failure) and overrides the plan body's earlier suggestion
  // to fall back to the stale cached value with a warning.
  async function getLatestVersion(args?: {
    forceRefresh?: boolean;
  }): Promise<string | null> {
    const currentTime = now();
    if (
      args?.forceRefresh !== true &&
      cache !== null &&
      currentTime - cache.cachedAt < cacheTtlMs
    ) {
      return cache.latestVersion;
    }
    if (inflight !== null) {
      return inflight;
    }
    const requestPromise = (async () => {
      const result = await fetchNpmLatest();
      if (result !== null) {
        cache = { cachedAt: now(), latestVersion: result };
      }
      return result;
    })();
    inflight = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (inflight === requestPromise) {
        inflight = null;
      }
    }
  }

  return {
    async getSystemVersion(
      args: AppVersionGetSystemVersionArgs = {},
    ): Promise<SystemVersionResponse> {
      const baseResponse: SystemVersionResponse = {
        build,
        currentVersion: config.appVersion,
        latestVersion: null,
        source: "npm",
        updateAvailable: false,
        isDevelopment: config.isDevelopment,
        upgradeCommand: UPGRADE_COMMAND,
      };

      if (config.isDevelopment) {
        return baseResponse;
      }

      const latestVersion = await getLatestVersion({
        forceRefresh: args.forceRefresh,
      });
      if (latestVersion === null) {
        return baseResponse;
      }

      const parsedCurrent = semver.parse(config.appVersion);
      const parsedLatest = semver.parse(latestVersion);
      if (parsedCurrent === null || parsedLatest === null) {
        logger.warn(
          {
            currentVersion: config.appVersion,
            latestVersion,
          },
          "Skipping update check because a version is not valid semver",
        );
        return { ...baseResponse, latestVersion };
      }

      return {
        ...baseResponse,
        latestVersion,
        updateAvailable: semver.gt(parsedLatest, parsedCurrent),
      };
    },
  };
}
