import { useEffect, useMemo, useState } from "react";
import { ContactRound, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listContacts, type Contact, type ContactInput } from "@/lib/api";
import { useAccountsQuery } from "@/hooks/queries";
import { useContactMutations } from "@/hooks/mutations";
import { useToastStore } from "@/stores/toast.store";
import { useUIStore } from "@/stores/ui.store";
import ContactEditorDialog from "@/features/contacts/ContactEditorDialog";

interface ContactAddressActionProps {
  accountId: string;
  name?: string | null;
  address: string;
}

export default function ContactAddressAction({
  accountId,
  name,
  address,
}: ContactAddressActionProps) {
  const { t } = useTranslation();
  const normalizedAddress = address.trim().toLowerCase();
  const { data: accounts = [] } = useAccountsQuery();
  const { save } = useContactMutations();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const addToast = useToastStore((state) => state.addToast);

  const isSelf = useMemo(() => accounts.some((account) => (
    account.id === accountId
    && account.email.trim().toLowerCase() === normalizedAddress
  )), [accountId, accounts, normalizedAddress]);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedAddress || isSelf) {
      setLoading(false);
      setContact(null);
      return () => { cancelled = true; };
    }

    setLoading(true);
    listContacts(address, false, 20, 0)
      .then((contacts) => {
        if (cancelled) return;
        const exact = contacts.find((candidate) => candidate.emails.some((email) => (
          email.address.trim().toLowerCase() === normalizedAddress
        )));
        setContact(exact ?? null);
      })
      .catch(() => {
        if (!cancelled) setContact(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address, isSelf, normalizedAddress]);

  if (isSelf || !normalizedAddress) return null;

  const contactName = contact?.display_name.trim()
    || contact?.emails[0]?.address
    || name?.trim()
    || address;
  const addLabel = `${t("contacts.addAddressPrefix", "Add")} ${address} ${t("contacts.addAddressSuffix", "to contacts")}`;
  const viewLabel = `${t("contacts.viewPrefix", "View")} ${contactName} ${t("contacts.viewSuffix", "in contacts")}`;

  const handleSave = async (input: ContactInput) => {
    const saved = await save.mutateAsync(input);
    setContact(saved);
    setEditorOpen(false);
    addToast({ message: t("contacts.saveSuccess", "Contact saved"), type: "success" });
  };

  return (
    <>
      <button
        type="button"
        className="contact-address-action"
        aria-label={contact ? viewLabel : addLabel}
        title={contact ? viewLabel : addLabel}
        disabled={loading}
        onClick={() => {
          if (contact) {
            useUIStore.getState().openContactInContacts(contact.id);
          } else {
            setEditorOpen(true);
          }
        }}
      >
        {contact ? <ContactRound size={13} /> : <UserPlus size={13} />}
      </button>

      {editorOpen && (
        <ContactEditorDialog
          contact={null}
          initialValue={{ displayName: name, address }}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
