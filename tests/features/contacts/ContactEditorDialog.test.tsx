import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/lib/api";
import ContactEditorDialog from "@/features/contacts/ContactEditorDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const contact: Contact = {
  id: "contact-1",
  display_name: "Alice",
  notes: "Old note",
  is_favorite: true,
  emails: [{
    id: "email-1",
    address: "alice@example.com",
    label: "work",
    is_primary: true,
  }],
  created_at: 1,
  updated_at: 1,
};

describe("ContactEditorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a contact with a labeled primary email", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditorDialog contact={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Bob  " } });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: " bob@example.com " },
    });
    fireEvent.change(screen.getByLabelText("Email label"), { target: { value: "personal" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        display_name: "Bob",
        notes: "",
        is_favorite: false,
        emails: [{
          id: undefined,
          address: "bob@example.com",
          label: "personal",
          is_primary: true,
        }],
      });
    });
  });

  it("blocks an invalid email before saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditorDialog contact={null} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid email address");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves ids while editing and closes on Escape", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactEditorDialog contact={contact} onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        id: "contact-1",
        display_name: "Alice Updated",
        emails: [expect.objectContaining({ id: "email-1" })],
      }));
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
