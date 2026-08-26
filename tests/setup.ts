// Ensure a working `localStorage` in the jsdom test environment.
//
// Node 22+ exposes an experimental native `localStorage` getter (webstorage)
// that returns `undefined` when `--localstorage-file` is not provided. That
// getter shadows jsdom's own implementation, so any module that touches
// `localStorage` at import time (e.g. `src/lib/profileStorage.ts`) crashes
// with "Cannot read properties of undefined (reading 'getItem')".
function createMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

const storage = createMemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  configurable: true,
  writable: true,
});

if (typeof globalThis.window !== "undefined") {
  try {
    Object.defineProperty(globalThis.window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  } catch {
    // ignore — some environments make window.localStorage read-only
  }
}
