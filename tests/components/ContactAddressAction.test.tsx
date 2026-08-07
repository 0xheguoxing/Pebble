import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/lib/api";
import { listContacts } from "@/lib/api";
import { useUIStore } from "@/stores/ui.store";
import ContactAddressAction from "@/components/ContactAddressAction";

const mocks = vi.hoisted(() => ({
  accounts: [{ id: "account-1", email: "me@example.com" }],
  save: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@/lib/api", () => ({
  listContacts: vi.fn(),
}));

vi.mock("@/hooks/queries", () => ({
  useAccountsQuery: () => ({ data: mocks.accounts }),
}));

vi.mock("@/hooks/mutations", () => ({
  useContactMutations: () => ({
    save: { mutateAsync: mocks.save, isPending: false },
  }),
}));

const alice: Contact = {
  id: "contact-1",
  display_name: "Alice",
  notes: "",
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

describe("ContactAddressAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts = [{ id: "account-1", email: "me@example.com" }];
    vi.mocked(listContacts).mockResolvedValue([]);
    mocks.save.mockResolvedValue(alice);
    useUIStore.setState({ activeView: "inbox", pendingContactId: null });
  });

  it("opens a prefilled editor for an unsaved participant", async () => {
    render(
      <ContactAddressAction
        accountId="account-1"
        name="Sender"
        address="sender@example.com"
      />,
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "Add sender@example.com to contacts",
    }));

    expect(screen.getByRole("dialog", { name: "New contact" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sender");
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("sender@example.com");
  });

  it("opens an existing contact in the contacts view", async () => {
    vi.mocked(listContacts).mockResolvedValue([alice]);
    render(
      <ContactAddressAction
        accountId="account-1"
        name="Alice"
        address="alice@example.com"
      />,
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "View Alice in contacts",
    }));

    await waitFor(() => {
      expect(useUIStore.getState().activeView).toBe("contacts");
      expect(useUIStore.getState().pendingContactId).toBe("contact-1");
    });
  });

  it("does not offer contact actions for the current account address", async () => {
    render(
      <ContactAddressAction
        accountId="account-1"
        name="Me"
        address="ME@example.com"
      />,
    );

    await waitFor(() => expect(listContacts).not.toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });
});
