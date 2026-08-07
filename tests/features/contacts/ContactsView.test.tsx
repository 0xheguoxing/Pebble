import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/lib/api";
import { useComposeStore } from "@/stores/compose.store";
import { useConfirmStore } from "@/stores/confirm.store";
import { useUIStore } from "@/stores/ui.store";

const mocks = vi.hoisted(() => ({
  contacts: [] as Contact[],
  useContactsQuery: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  setFavorite: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/hooks/queries", () => ({
  useContactsQuery: (options: unknown) => mocks.useContactsQuery(options),
}));

vi.mock("@/hooks/mutations", () => ({
  useContactMutations: () => ({
    save: { mutateAsync: mocks.save, isPending: false },
    remove: { mutateAsync: mocks.remove, isPending: false },
    setFavorite: { mutateAsync: mocks.setFavorite, isPending: false },
  }),
}));

import ContactsView from "@/features/contacts/ContactsView";

const alice: Contact = {
  id: "contact-1",
  display_name: "Alice",
  notes: "Rust community",
  is_favorite: false,
  emails: [{
    id: "email-1",
    address: "alice@example.com",
    label: "work",
    is_primary: true,
  }],
  created_at: 1,
  updated_at: 1,
};

describe("ContactsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contacts = [];
    mocks.useContactsQuery.mockImplementation(() => ({
      data: mocks.contacts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }));
    mocks.save.mockImplementation(async () => alice);
    mocks.remove.mockResolvedValue(undefined);
    mocks.setFavorite.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
    useConfirmStore.setState({ confirm: mocks.confirm });
    useUIStore.setState({ activeView: "contacts" as never });
    useComposeStore.setState({
      composeMode: null,
      composePrefill: null,
      composeReplyTo: null,
      composeDirty: false,
    });
  });

  it("shows an empty state and opens the new contact editor", () => {
    render(<ContactsView />);

    expect(screen.getByText("No contacts yet")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "New contact" })[0]);
    expect(screen.getByRole("dialog", { name: "New contact" })).toBeTruthy();
  });

  it("passes search and favorite filters to the contacts query", () => {
    render(<ContactsView />);

    fireEvent.change(screen.getByLabelText("Search contacts"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByLabelText("Favorites only"));

    expect(mocks.useContactsQuery).toHaveBeenLastCalledWith(expect.objectContaining({
      query: "alice",
      favoriteOnly: true,
    }));
  });

  it("opens contact details and composes to the primary email", () => {
    mocks.contacts = [alice];
    render(<ContactsView />);

    fireEvent.click(screen.getByRole("button", { name: /Alice.*alice@example.com/i }));
    fireEvent.click(screen.getByRole("button", { name: "Write email" }));

    expect(useUIStore.getState().activeView).toBe("compose");
    expect(useComposeStore.getState().composePrefill).toEqual({
      to: ["alice@example.com"],
    });
  });

  it("toggles favorite and deletes after confirmation", async () => {
    mocks.contacts = [alice];
    render(<ContactsView />);
    fireEvent.click(screen.getByRole("button", { name: /Alice.*alice@example.com/i }));

    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(() => {
      expect(mocks.setFavorite).toHaveBeenCalledWith({
        contactId: "contact-1",
        isFavorite: true,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith({
        contactId: "contact-1",
        suppressAddresses: true,
      });
    });
  });
});
