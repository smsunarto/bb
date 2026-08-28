import {
  APP_SURFACE_WEB,
  type RequestAppSurface,
} from "@bb/config/app-surface";
import { registerSW } from "virtual:pwa-register";
import { appToast, type AppToastOptions } from "@/components/ui/app-toast";
import { getAppSurface } from "./app-surface";

const PWA_UPDATE_TOAST_ID = "bb-pwa-update-ready";
const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

interface PwaServiceWorkerContainer {
  controller(): object | null;
  onControllerChange(listener: () => void): void;
}

type PwaUpdateToastOptions = Required<
  Pick<AppToastOptions, "duration" | "id">
> & {
  action: Omit<NonNullable<AppToastOptions["action"]>, "onClick"> & {
    onClick: () => void;
  };
};
type RegisterOptions = NonNullable<Parameters<typeof registerSW>[0]>;
type PwaRegisterOptions = Omit<
  RegisterOptions,
  "onNeedRefresh" | "onNeedReload" | "onRegisteredSW" | "onRegisterError"
> &
  Required<
    Pick<RegisterOptions, "onNeedRefresh" | "onNeedReload" | "onRegisterError">
  > & {
    onRegisteredSW: (
      swScriptUrl: string,
      update: (() => Promise<void>) | undefined,
    ) => void;
  };

export interface PwaUpdateDependencies {
  appSurface: RequestAppSurface;
  isProduction: boolean;
  registerServiceWorker: (
    options: PwaRegisterOptions,
  ) => ReturnType<typeof registerSW>;
  reload: () => void;
  reportError: (message: string, error: unknown) => void;
  scheduleUpdateCheck: (callback: () => void, intervalMs: number) => void;
  serviceWorker: PwaServiceWorkerContainer | undefined;
  showToast: (
    title: string,
    options: PwaUpdateToastOptions,
  ) => ReturnType<typeof appToast.message>;
}

function browserServiceWorker(): PwaServiceWorkerContainer | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }
  const serviceWorker = navigator.serviceWorker;
  return {
    controller: () => serviceWorker.controller,
    onControllerChange: (listener) => {
      serviceWorker.addEventListener("controllerchange", listener);
    },
  };
}

function registerBrowserServiceWorker(
  options: PwaRegisterOptions,
): ReturnType<typeof registerSW> {
  const { onRegisteredSW, ...registerOptions } = options;
  return registerSW({
    ...registerOptions,
    onRegisteredSW: (swScriptUrl, registration) => {
      onRegisteredSW(
        swScriptUrl,
        registration === undefined
          ? undefined
          : async () => {
              await registration.update();
            },
      );
    },
  });
}

function browserDependencies(): PwaUpdateDependencies {
  return {
    appSurface: getAppSurface(),
    isProduction: import.meta.env.PROD,
    registerServiceWorker: registerBrowserServiceWorker,
    reload: () => window.location.reload(),
    reportError: (message, error) => console.error(message, error),
    scheduleUpdateCheck: (callback, intervalMs) => {
      window.setInterval(callback, intervalMs);
    },
    serviceWorker: browserServiceWorker(),
    showToast: appToast.message,
  };
}

export function startPwaUpdateRegistration(
  dependencies: PwaUpdateDependencies = browserDependencies(),
): void {
  if (
    !dependencies.isProduction ||
    dependencies.appSurface !== APP_SURFACE_WEB ||
    dependencies.serviceWorker === undefined
  ) {
    return;
  }
  const serviceWorker = dependencies.serviceWorker;

  let reloadRequested = false;
  const reloadOnce = () => {
    if (reloadRequested) return;
    reloadRequested = true;
    dependencies.reload();
  };
  let updateIsControlling = false;
  let reloadAuthorized = false;
  let activationRequestPending = false;
  let activateUpdate: (() => Promise<void>) | undefined;
  const markUpdateControlling = () => {
    updateIsControlling = true;
    if (reloadAuthorized) reloadOnce();
  };
  const requestUpdateActivation = () => {
    reloadAuthorized = true;
    if (updateIsControlling) {
      reloadOnce();
      return;
    }
    if (activationRequestPending || activateUpdate === undefined) return;
    activationRequestPending = true;
    void activateUpdate()
      .catch((error: unknown) => {
        dependencies.reportError(
          "Failed to activate the bb service worker update",
          error,
        );
      })
      .finally(() => {
        activationRequestPending = false;
      });
  };
  let controllingWorker = serviceWorker.controller();
  serviceWorker.onControllerChange(() => {
    const nextController = serviceWorker.controller();
    if (nextController === null || nextController === controllingWorker) return;
    const wasControlled = controllingWorker !== null;
    controllingWorker = nextController;
    if (wasControlled) markUpdateControlling();
  });
  activateUpdate = dependencies.registerServiceWorker({
    onNeedReload: markUpdateControlling,
    onNeedRefresh: () => {
      dependencies.showToast("A bb update is ready", {
        action: {
          label: "Reload",
          onClick: requestUpdateActivation,
        },
        duration: Infinity,
        id: PWA_UPDATE_TOAST_ID,
      });
    },
    onRegisteredSW: (_swScriptUrl, update) => {
      if (update === undefined) return;
      dependencies.scheduleUpdateCheck(() => {
        void update().catch((error: unknown) => {
          dependencies.reportError(
            "Failed to check for a bb service worker update",
            error,
          );
        });
      }, PWA_UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError: (error) => {
      dependencies.reportError(
        "Failed to register the bb service worker",
        error,
      );
    },
  });
}
