import { describe, expect, it, vi } from "vitest";
import type { AppSurface } from "@bb/config/app-surface";
import {
  startPwaUpdateRegistration,
  type PwaUpdateDependencies,
} from "./pwa-update";

vi.mock("virtual:pwa-register", () => ({ registerSW: vi.fn() }));

interface RecordedToast {
  options: Parameters<PwaUpdateDependencies["showToast"]>[1];
  title: string;
}

function createHarness(
  overrides: Partial<
    Pick<PwaUpdateDependencies, "appSurface" | "isProduction" | "serviceWorker">
  > = {},
) {
  const controllerChangeListeners = new Set<() => void>();
  let controller: object | null = {};
  const serviceWorker = {
    controller: () => controller,
    onControllerChange: vi.fn((listener: () => void) => {
      controllerChangeListeners.add(listener);
    }),
    dispatchControllerChange: (nextController: object | null = {}) => {
      controller = nextController;
      for (const listener of controllerChangeListeners) listener();
    },
    setController: (nextController: object | null) => {
      controller = nextController;
    },
  };
  const activateUpdate = vi.fn(async () => {});
  const reload = vi.fn();
  const reportError = vi.fn();
  const scheduleUpdateCheck =
    vi.fn<PwaUpdateDependencies["scheduleUpdateCheck"]>();
  const toasts: RecordedToast[] = [];
  let registrationOptions:
    | Parameters<PwaUpdateDependencies["registerServiceWorker"]>[0]
    | undefined;
  const registerServiceWorker = vi.fn(
    (
      options: Parameters<PwaUpdateDependencies["registerServiceWorker"]>[0],
    ) => {
      registrationOptions = options;
      return activateUpdate;
    },
  );
  const dependencies: PwaUpdateDependencies = {
    appSurface: "web",
    isProduction: true,
    registerServiceWorker,
    reload,
    reportError,
    scheduleUpdateCheck,
    serviceWorker,
    showToast: (title, options) => {
      toasts.push({ options, title });
      return options.id;
    },
    ...overrides,
  };

  return {
    activateUpdate,
    dependencies,
    getRegistrationOptions: () => registrationOptions,
    registerServiceWorker,
    reload,
    reportError,
    scheduleUpdateCheck,
    serviceWorker,
    toasts,
  };
}

describe("PWA update registration", () => {
  it.each<{
    appSurface: AppSurface;
    isProduction: boolean;
    serviceWorker: "available" | "missing";
    shouldRegister: boolean;
  }>([
    {
      appSurface: "web",
      isProduction: true,
      serviceWorker: "available",
      shouldRegister: true,
    },
    {
      appSurface: "web",
      isProduction: false,
      serviceWorker: "available",
      shouldRegister: false,
    },
    {
      appSurface: "desktop",
      isProduction: true,
      serviceWorker: "available",
      shouldRegister: false,
    },
    {
      appSurface: "web",
      isProduction: true,
      serviceWorker: "missing",
      shouldRegister: false,
    },
  ])(
    "registers=$shouldRegister for production=$isProduction surface=$appSurface serviceWorker=$serviceWorker",
    ({ appSurface, isProduction, serviceWorker, shouldRegister }) => {
      const harness = createHarness({ appSurface, isProduction });
      if (serviceWorker === "missing") {
        harness.dependencies.serviceWorker = undefined;
      }

      startPwaUpdateRegistration(harness.dependencies);

      expect(harness.registerServiceWorker).toHaveBeenCalledTimes(
        shouldRegister ? 1 : 0,
      );
    },
  );

  it("shows one persistent toast and waits for Reload", () => {
    const harness = createHarness();
    startPwaUpdateRegistration(harness.dependencies);
    const registrationOptions = harness.getRegistrationOptions();
    expect(registrationOptions).toBeDefined();

    registrationOptions?.onNeedRefresh();
    registrationOptions?.onNeedRefresh();

    expect(harness.activateUpdate).not.toHaveBeenCalled();
    expect(harness.toasts).toHaveLength(2);
    expect(harness.toasts[0]).toMatchObject({
      title: "A bb update is ready",
      options: {
        action: { label: "Reload" },
        duration: Infinity,
        id: "bb-pwa-update-ready",
      },
    });
    expect(harness.toasts[1]?.options.id).toBe(harness.toasts[0]?.options.id);
  });

  it("allows one activation request at a time", async () => {
    const harness = createHarness();
    let resolveActivation: (() => void) | undefined;
    const pendingActivation = new Promise<void>((resolve) => {
      resolveActivation = resolve;
    });
    harness.activateUpdate.mockReturnValueOnce(pendingActivation);
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    const reloadAction = harness.toasts[0]?.options.action.onClick;

    reloadAction?.();
    reloadAction?.();

    expect(harness.activateUpdate).toHaveBeenCalledOnce();
    expect(harness.activateUpdate).toHaveBeenCalledWith();
    resolveActivation?.();
    await pendingActivation;
    await Promise.resolve();
    reloadAction?.();
    expect(harness.activateUpdate).toHaveBeenCalledTimes(2);
  });

  it("reloads when an activated update takes control after Reload", () => {
    const harness = createHarness();
    harness.serviceWorker.setController(null);
    startPwaUpdateRegistration(harness.dependencies);

    harness.serviceWorker.dispatchControllerChange();
    expect(harness.reload).not.toHaveBeenCalled();

    harness.getRegistrationOptions()?.onNeedRefresh();
    harness.toasts[0]?.options.action.onClick();
    expect(harness.activateUpdate).toHaveBeenCalledOnce();
    harness.serviceWorker.dispatchControllerChange();

    expect(harness.reload).toHaveBeenCalledOnce();
  });

  it("registers one controller change listener", () => {
    const harness = createHarness();
    startPwaUpdateRegistration(harness.dependencies);
    const registrationOptions = harness.getRegistrationOptions();

    registrationOptions?.onNeedRefresh();
    registrationOptions?.onNeedRefresh();
    harness.toasts[0]?.options.action.onClick();
    harness.toasts[1]?.options.action.onClick();

    expect(harness.serviceWorker.onControllerChange).toHaveBeenCalledOnce();
    expect(harness.serviceWorker.onControllerChange).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("reloads only tabs where the user consented", () => {
    const consentingTab = createHarness();
    const passiveTab = createHarness();
    startPwaUpdateRegistration(consentingTab.dependencies);
    startPwaUpdateRegistration(passiveTab.dependencies);
    consentingTab.getRegistrationOptions()?.onNeedRefresh();
    passiveTab.getRegistrationOptions()?.onNeedRefresh();

    consentingTab.toasts[0]?.options.action.onClick();
    consentingTab.getRegistrationOptions()?.onNeedReload();
    passiveTab.getRegistrationOptions()?.onNeedReload();
    consentingTab.serviceWorker.dispatchControllerChange();
    passiveTab.serviceWorker.dispatchControllerChange();

    expect(consentingTab.reload).toHaveBeenCalledOnce();
    expect(passiveTab.reload).not.toHaveBeenCalled();

    passiveTab.toasts[0]?.options.action.onClick();
    expect(passiveTab.reload).toHaveBeenCalledOnce();
    expect(passiveTab.activateUpdate).not.toHaveBeenCalled();
  });

  it("reloads after a late update prompt follows controller change", () => {
    const harness = createHarness();
    startPwaUpdateRegistration(harness.dependencies);
    const registrationOptions = harness.getRegistrationOptions();

    registrationOptions?.onNeedRefresh();
    registrationOptions?.onNeedReload();
    registrationOptions?.onNeedRefresh();
    harness.toasts[1]?.options.action.onClick();

    expect(harness.reload).toHaveBeenCalledOnce();
    expect(harness.activateUpdate).not.toHaveBeenCalled();
  });

  it("checks for updates every hour after registration", () => {
    const harness = createHarness();
    const update = vi.fn(async () => {});
    startPwaUpdateRegistration(harness.dependencies);

    harness.getRegistrationOptions()?.onRegisteredSW("/sw.js", update);
    expect(harness.scheduleUpdateCheck).toHaveBeenCalledWith(
      expect.any(Function),
      60 * 60 * 1_000,
    );

    const scheduledUpdate = harness.scheduleUpdateCheck.mock.calls[0]?.[0];
    scheduledUpdate?.();
    expect(update).toHaveBeenCalledOnce();
  });

  it("reports periodic update check failures", async () => {
    const harness = createHarness();
    const error = new Error("update check failed");
    const update = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onRegisteredSW("/sw.js", update);

    harness.scheduleUpdateCheck.mock.calls[0]?.[0]?.();

    await vi.waitFor(() => {
      expect(harness.reportError).toHaveBeenCalledWith(
        "Failed to check for a bb service worker update",
        error,
      );
    });
  });

  it("allows an activation retry after a rejected request", async () => {
    const harness = createHarness();
    harness.activateUpdate.mockRejectedValueOnce(
      new Error("activation failed"),
    );
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    const reloadAction = harness.toasts[0]?.options.action.onClick;

    reloadAction?.();
    await vi.waitFor(() => {
      expect(harness.activateUpdate).toHaveBeenCalledOnce();
      expect(harness.reportError).toHaveBeenCalledWith(
        "Failed to activate the bb service worker update",
        expect.any(Error),
      );
    });
    reloadAction?.();

    expect(harness.activateUpdate).toHaveBeenCalledTimes(2);
    harness.serviceWorker.dispatchControllerChange();
    expect(harness.reload).toHaveBeenCalledOnce();
  });

  it("keeps reload consent after a later activation request fails", async () => {
    const harness = createHarness();
    let resolveFirstRequest: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve;
    });
    harness.activateUpdate
      .mockReturnValueOnce(firstRequest)
      .mockRejectedValueOnce(new Error("retry failed"));
    startPwaUpdateRegistration(harness.dependencies);
    harness.getRegistrationOptions()?.onNeedRefresh();
    const reloadAction = harness.toasts[0]?.options.action.onClick;

    reloadAction?.();
    expect(harness.activateUpdate).toHaveBeenCalledOnce();
    resolveFirstRequest?.();
    await firstRequest;
    await Promise.resolve();
    reloadAction?.();
    await vi.waitFor(() => {
      expect(harness.activateUpdate).toHaveBeenCalledTimes(2);
      expect(harness.reportError).toHaveBeenCalledWith(
        "Failed to activate the bb service worker update",
        expect.any(Error),
      );
    });
    harness.serviceWorker.dispatchControllerChange();

    expect(harness.reload).toHaveBeenCalledOnce();
  });
});
