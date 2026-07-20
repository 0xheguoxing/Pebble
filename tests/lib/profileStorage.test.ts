import { beforeEach, describe, expect, it } from "vitest";
import {
  getProfileStorageNamespace,
  initializeProfileStorageNamespace,
  profileLocalStorage,
  profileSessionStorage,
  resetProfileStorageNamespaceForTests,
} from "../../src/lib/profileStorage";

describe("profileStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetProfileStorageNamespaceForTests();
  });

  it("scopes local storage values by the active profile namespace", async () => {
    await initializeProfileStorageNamespace(async () => "alpha");
    profileLocalStorage.setItem("pebble-theme", "dark");

    await initializeProfileStorageNamespace(async () => "beta");
    profileLocalStorage.setItem("pebble-theme", "light");

    await initializeProfileStorageNamespace(async () => "alpha");

    expect(profileLocalStorage.getItem("pebble-theme")).toBe("dark");
    expect(localStorage.getItem("pebble:profile:alpha:pebble-theme")).toBe("dark");
    expect(localStorage.getItem("pebble:profile:beta:pebble-theme")).toBe("light");
    expect(localStorage.getItem("pebble-theme")).toBeNull();
  });

  it("scopes session storage values by the active profile namespace", async () => {
    await initializeProfileStorageNamespace(async () => "alpha");
    profileSessionStorage.setItem("pebble-settings-tab", "appearance");

    await initializeProfileStorageNamespace(async () => "beta");

    expect(profileSessionStorage.getItem("pebble-settings-tab")).toBeNull();
    expect(sessionStorage.getItem("pebble:profile:alpha:pebble-settings-tab")).toBe("appearance");
  });

  it("falls back to legacy keys when profile namespace lookup fails", async () => {
    localStorage.setItem("pebble-theme", "dark");

    await initializeProfileStorageNamespace(async () => {
      throw new Error("not running in Tauri");
    });

    expect(getProfileStorageNamespace()).toBeNull();
    expect(profileLocalStorage.getItem("pebble-theme")).toBe("dark");
  });

  it("migrates legacy localStorage keys into the profile namespace once", async () => {
    localStorage.setItem("pebble-theme", "dark");
    localStorage.setItem("pebble-language", "zh");
    localStorage.setItem("pebble-unrelated-key", "untouched");

    await initializeProfileStorageNamespace(async () => "alpha");

    expect(profileLocalStorage.getItem("pebble-theme")).toBe("dark");
    expect(profileLocalStorage.getItem("pebble-language")).toBe("zh");
    expect(localStorage.getItem("pebble-theme")).toBeNull();
    expect(localStorage.getItem("pebble-language")).toBeNull();
    expect(localStorage.getItem("pebble-unrelated-key")).toBe("untouched");

    // A legacy key re-appearing later (e.g. written by a downgrade) must not
    // overwrite the namespaced value, because the migration already ran.
    localStorage.setItem("pebble-theme", "light");
    await initializeProfileStorageNamespace(async () => "alpha");
    expect(profileLocalStorage.getItem("pebble-theme")).toBe("dark");
  });

  it("does not overwrite an existing scoped value during migration", async () => {
    localStorage.setItem("pebble-theme", "legacy-dark");
    localStorage.setItem("pebble:profile:alpha:pebble-theme", "scoped-light");

    await initializeProfileStorageNamespace(async () => "alpha");

    expect(profileLocalStorage.getItem("pebble-theme")).toBe("scoped-light");
  });

  it("migrates legacy sessionStorage keys into the profile namespace", async () => {
    sessionStorage.setItem("pebble-settings-tab", "appearance");

    await initializeProfileStorageNamespace(async () => "alpha");

    expect(profileSessionStorage.getItem("pebble-settings-tab")).toBe("appearance");
    expect(sessionStorage.getItem("pebble-settings-tab")).toBeNull();
  });
});
