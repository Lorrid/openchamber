import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import { getRuntimeKey } from '@/lib/runtime-switch';

import { parseGuestCatalogJson } from './parse.ts';
import { useGuestsStore } from './store.ts';

const alignCatalogRuntime = (runtimeKey: string): void => {
  const store = useGuestsStore.getState();
  if (store.runtimeKey !== runtimeKey) {
    store.resetForRuntimeSwitch(runtimeKey);
  }
};

export const loadGuestCatalog = async (): Promise<void> => {
  const runtimeKey = getRuntimeKey();
  alignCatalogRuntime(runtimeKey);

  const store = useGuestsStore.getState();
  if (isVSCodeRuntime() || isMobileSurfaceRuntime()) {
    store.markUnsupported(runtimeKey);
    return;
  }

  store.markLoading();
  try {
    const response = await runtimeFetch('/api/guests');
    if (useGuestsStore.getState().runtimeKey !== runtimeKey) {
      return;
    }
    if (!response.ok) {
      store.markFailed(runtimeKey);
      return;
    }
    const guests = parseGuestCatalogJson(await response.text());
    if (useGuestsStore.getState().runtimeKey !== runtimeKey) {
      return;
    }
    if (!guests) {
      store.markFailed(runtimeKey);
      return;
    }
    useGuestsStore.getState().replaceCatalog(guests, runtimeKey);
  } catch {
    useGuestsStore.getState().markFailed(runtimeKey);
  }
};
