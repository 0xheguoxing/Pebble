import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContactAutocomplete from "../../src/components/ContactAutocomplete";
import { searchContactSuggestions, suppressContactSuggestion } from "../../src/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("../../src/lib/api", () => ({
  searchContacts: vi.fn().mockResolvedValue([]),
  searchContactSuggestions: vi.fn(),
  suppressContactSuggestion: vi.fn(),
}));

vi.mock("../../src/stores/toast.store", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

describe("ContactAutocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows saved and recent sources and selects only the address", async () => {
    vi.mocked(searchContactSuggestions).mockResolvedValue([
      {
        contact_id: "contact-1",
        name: "Alice",
        address: "alice@example.com",
        source: "saved",
        is_favorite: true,
        last_interaction_at: null,
      },
      {
        contact_id: null,
        name: "Alex",
        address: "alex@example.com",
        source: "recent",
        is_favorite: false,
        last_interaction_at: 100,
      },
    ]);
    const onChange = vi.fn();
    render(
      <ContactAutocomplete
        value={[]}
        onChange={onChange}
        accountId="account-1"
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "al" } });

    expect(await screen.findByText("Saved contact")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Alice.*alice@example.com/i }));
    expect(onChange).toHaveBeenCalledWith(["alice@example.com"]);
  });

  it("filters selected addresses without case sensitivity and supports keyboard selection", async () => {
    vi.mocked(searchContactSuggestions).mockResolvedValue([
      {
        contact_id: "contact-1",
        name: "Alice",
        address: "ALICE@example.com",
        source: "saved",
        is_favorite: false,
        last_interaction_at: null,
      },
      {
        contact_id: null,
        name: "Bob",
        address: "bob@example.com",
        source: "recent",
        is_favorite: false,
        last_interaction_at: 50,
      },
    ]);
    const onChange = vi.fn();
    render(
      <ContactAutocomplete
        value={["alice@example.com"]}
        onChange={onChange}
        accountId="account-1"
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "example" } });

    await waitFor(() => expect(searchContactSuggestions).toHaveBeenCalled());
    expect(screen.queryByText("ALICE@example.com")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["alice@example.com", "bob@example.com"]);
  });

  it("removes a recent suggestion without selecting it", async () => {
    vi.mocked(searchContactSuggestions).mockResolvedValue([
      {
        contact_id: null,
        name: "Alex",
        address: "alex@example.com",
        source: "recent",
        is_favorite: false,
        last_interaction_at: 100,
      },
    ]);
    vi.mocked(suppressContactSuggestion).mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <ContactAutocomplete value={[]} onChange={onChange} accountId="account-1" />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alex" } });
    const removeButton = await screen.findByRole("button", {
      name: "Remove suggestion alex@example.com",
    });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(suppressContactSuggestion).toHaveBeenCalledWith("alex@example.com");
      expect(screen.queryByText("alex@example.com")).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
