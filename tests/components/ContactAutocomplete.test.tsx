import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContactAutocomplete from "../../src/components/ContactAutocomplete";
import { searchContacts } from "../../src/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("../../src/lib/api", () => ({
  searchContacts: vi.fn(),
}));

vi.mock("../../src/stores/toast.store", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

const searchContactsMock = vi.mocked(searchContacts);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("ContactAutocomplete", () => {
  afterEach(() => {
    vi.useRealTimers();
    searchContactsMock.mockReset();
  });

  it("forwards form identity and label association to the combobox input", () => {
    render(
      <>
        <label id="to-label" htmlFor="compose-to-input">To</label>
        <ContactAutocomplete
          id="compose-to-input"
          name="to"
          ariaLabelledBy="to-label"
          value={[]}
          onChange={vi.fn()}
          accountId="account-1"
          placeholder="recipient@example.com"
        />
      </>,
    );

    const input = screen.getByRole("combobox", { name: "To" });
    expect(input.getAttribute("id")).toBe("compose-to-input");
    expect(input.getAttribute("name")).toBe("to");
    expect(input.getAttribute("aria-labelledby")).toBe("to-label");
    expect(input.getAttribute("autocomplete")).toBe("email");
  });

  it("can expose its pending text as controlled input state", () => {
    const onInputValueChange = vi.fn();
    const { rerender } = render(
      <>
        <label id="to-label" htmlFor="compose-to-input">To</label>
        <ContactAutocomplete
          id="compose-to-input"
          ariaLabelledBy="to-label"
          value={[]}
          onChange={vi.fn()}
          accountId="account-1"
          inputValue=""
          onInputValueChange={onInputValueChange}
        />
      </>,
    );

    const input = screen.getByRole("combobox", { name: "To" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed@example.com" } });

    expect(onInputValueChange).toHaveBeenCalledWith("typed@example.com");

    rerender(
      <>
        <label id="to-label" htmlFor="compose-to-input">To</label>
        <ContactAutocomplete
          id="compose-to-input"
          ariaLabelledBy="to-label"
          value={[]}
          onChange={vi.fn()}
          accountId="account-1"
          inputValue="typed@example.com"
          onInputValueChange={onInputValueChange}
        />
      </>,
    );

    expect(input.value).toBe("typed@example.com");
  });

  it("ignores an older search response that resolves after the latest query", async () => {
    vi.useFakeTimers();
    const older = deferred<Array<{ name: string | null; address: string }>>();
    const latest = deferred<Array<{ name: string | null; address: string }>>();
    searchContactsMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);

    render(
      <ContactAutocomplete
        value={[]}
        onChange={vi.fn()}
        accountId="account-1"
        placeholder="recipient@example.com"
      />,
    );
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "old" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "new" } });
    act(() => vi.advanceTimersByTime(200));

    await act(async () => {
      latest.resolve([{ name: "Newest", address: "new@example.com" }]);
      await latest.promise;
    });
    expect(screen.getByRole("option").textContent).toContain("new@example.com");

    await act(async () => {
      older.resolve([{ name: "Outdated", address: "old@example.com" }]);
      await older.promise;
    });

    expect(screen.getByRole("option").textContent).toContain("new@example.com");
    expect(screen.getByRole("option").textContent).not.toContain("old@example.com");
  });

  it("ignores a pending response after switching accounts", async () => {
    vi.useFakeTimers();
    const oldAccountSearch = deferred<Array<{ name: string | null; address: string }>>();
    searchContactsMock.mockReturnValueOnce(oldAccountSearch.promise);

    const { rerender } = render(
      <ContactAutocomplete value={[]} onChange={vi.fn()} accountId="account-1" />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alice" } });
    act(() => vi.advanceTimersByTime(200));

    rerender(
      <ContactAutocomplete value={[]} onChange={vi.fn()} accountId="account-2" />,
    );
    await act(async () => {
      oldAccountSearch.resolve([{ name: "Old account", address: "old@example.com" }]);
      await oldAccountSearch.promise;
    });

    expect(screen.queryByRole("option")).toBeNull();
  });

  it("filters a contact selected externally while its search is pending", async () => {
    vi.useFakeTimers();
    const pendingSearch = deferred<Array<{ name: string | null; address: string }>>();
    searchContactsMock.mockReturnValueOnce(pendingSearch.promise);

    const { rerender } = render(
      <ContactAutocomplete value={[]} onChange={vi.fn()} accountId="account-1" />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alice" } });
    act(() => vi.advanceTimersByTime(200));

    rerender(
      <ContactAutocomplete
        value={["alice@example.com"]}
        onChange={vi.fn()}
        accountId="account-1"
      />,
    );
    await act(async () => {
      pendingSearch.resolve([{ name: "Alice", address: "alice@example.com" }]);
      await pendingSearch.promise;
    });

    expect(screen.queryByRole("option")).toBeNull();
  });
});
