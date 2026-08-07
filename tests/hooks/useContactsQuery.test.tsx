import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listContacts } from "@/lib/api";
import {
  contactsQueryKey,
  useContactsQuery,
} from "@/hooks/queries/useContactsQuery";

vi.mock("@/lib/api", () => ({
  listContacts: vi.fn(() => Promise.resolve([])),
}));

const mockListContacts = vi.mocked(listContacts);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useContactsQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes search, favorite filter, limit, and offset in its query key", () => {
    expect(
      contactsQueryKey({ query: "alice", favoriteOnly: true, limit: 25, offset: 50 }),
    ).toEqual(["contacts", "alice", true, 25, 50]);
  });

  it("debounces changed search text for 200 milliseconds", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ query }) => useContactsQuery({ query, favoriteOnly: false, limit: 50, offset: 0 }),
      { initialProps: { query: "a" }, wrapper: createWrapper() },
    );
    await act(async () => Promise.resolve());
    expect(mockListContacts).toHaveBeenCalledWith("a", false, 50, 0);

    rerender({ query: "alice" });
    await act(async () => {
      vi.advanceTimersByTime(199);
      await Promise.resolve();
    });
    expect(mockListContacts).not.toHaveBeenCalledWith("alice", false, 50, 0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mockListContacts).toHaveBeenCalledWith("alice", false, 50, 0);
  });
});
