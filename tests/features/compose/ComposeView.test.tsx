import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComposeView from "../../../src/features/compose/ComposeView";
import { deleteDraft, stageComposeAttachment } from "../../../src/lib/api";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  closeCompose: vi.fn(),
  setComposeDirty: vi.fn(),
  addToast: vi.fn(),
  loadDraftFromStorage: vi.fn(),
  quotedReplyHtml: "",
  recipients: {
    to: ["to@example.com"] as string[],
    cc: [] as string[],
    bcc: [] as string[],
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("../../../src/stores/mail.store", () => ({
  useMailStore: (selector: (state: { activeAccountId: string }) => unknown) =>
    selector({ activeAccountId: "account-1" }),
}));

vi.mock("../../../src/stores/compose.store", () => ({
  useComposeStore: Object.assign(
    (selector: (state: {
      composeMode: string;
      composeReplyTo: null;
      closeCompose: () => void;
      showComposeLeaveConfirm: boolean;
      confirmCloseCompose: () => void;
      cancelCloseCompose: () => void;
    }) => unknown) =>
      selector({
        composeMode: "new",
        composeReplyTo: null,
        closeCompose: mocks.closeCompose,
        showComposeLeaveConfirm: false,
        confirmCloseCompose: vi.fn(),
        cancelCloseCompose: vi.fn(),
      }),
    {
      getState: () => ({ setComposeDirty: mocks.setComposeDirty }),
    },
  ),
}));

vi.mock("../../../src/hooks/queries", () => ({
  useAccountsQuery: () => ({
    data: [{ id: "account-1", email: "me@example.com", display_name: "Me" }],
  }),
}));

vi.mock("../../../src/hooks/mutations", () => ({
  useSendEmailMutation: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));

vi.mock("../../../src/hooks/useComposeRecipients", () => ({
  useComposeRecipients: () => ({
    fromAccountId: "account-1",
    setFromAccountId: vi.fn(),
    to: mocks.recipients.to,
    setTo: vi.fn(),
    cc: mocks.recipients.cc,
    setCc: vi.fn(),
    bcc: mocks.recipients.bcc,
    setBcc: vi.fn(),
    showCc: false,
    setShowCc: vi.fn(),
    showBcc: false,
    setShowBcc: vi.fn(),
  }),
}));

vi.mock("../../../src/hooks/useComposeDraft", () => ({
  useComposeDraft: () => ({
    draftIdRef: { current: "draft-1" },
    draftIdsByAccountRef: { current: { "account-1": "draft-1" } },
  }),
  loadDraftFromStorage: mocks.loadDraftFromStorage,
  clearDraftStorage: vi.fn(),
}));

vi.mock("../../../src/hooks/useComposeEditor", () => ({
  useComposeEditor: () => ({
    editor: {
      getHTML: () => "<p>Hello</p>",
      getText: () => "Hello",
      commands: { setContent: vi.fn() },
    },
    editorMode: "rich",
    rawSource: "",
    setRawSource: vi.fn(),
    richTextHtml: "<p>Hello</p>",
    htmlPreview: false,
    setHtmlPreview: vi.fn(),
    switchMode: vi.fn(),
    textareaRef: { current: null },
    quotedReplyHtml: mocks.quotedReplyHtml,
  }),
  appendReplyQuoteHtml: (bodyHtml: string, quotedReplyHtml: string) =>
    quotedReplyHtml.trim() ? `${bodyHtml}<br/><br/>${quotedReplyHtml.trim()}` : bodyHtml,
}));

vi.mock("../../../src/components/ContactAutocomplete", () => ({
  default: ({
    id,
    name,
    ariaLabelledBy,
    inputValue,
    placeholder,
    onInputValueChange,
  }: {
    id?: string;
    name?: string;
    ariaLabelledBy?: string;
    inputValue?: string;
    placeholder?: string;
    onInputValueChange?: (value: string) => void;
  }) => (
    <input
      id={id}
      name={name}
      role="combobox"
      aria-labelledby={ariaLabelledBy}
      value={inputValue ?? ""}
      placeholder={placeholder}
      onChange={(event) => onInputValueChange?.(event.currentTarget.value)}
    />
  ),
}));

vi.mock("../../../src/features/compose/ComposeToolbar", () => ({
  ModeButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
  EditorToolbar: () => <div />,
  MarkdownToolbar: () => <div />,
  composeStyles: {
    backBtn: {},
    fieldRow: {},
    fieldLabel: {},
    toggleBtn: {},
  },
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor" />,
}));

vi.mock("../../../src/lib/templates", () => ({
  listTemplates: () => [],
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock("../../../src/stores/confirm.store", () => ({
  useConfirmStore: { getState: () => ({ confirm: vi.fn().mockResolvedValue(true) }) },
}));

vi.mock("../../../src/stores/toast.store", () => ({
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));

vi.mock("../../../src/lib/api", () => ({
  deleteDraft: vi.fn(),
  stageComposeAttachment: vi.fn(),
}));

function attachmentFile(name: string, contents = name): File {
  const file = new File([contents], name);
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(new TextEncoder().encode(contents).buffer),
  });
  return file;
}

describe("ComposeView", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.mutate.mockReset();
    mocks.closeCompose.mockReset();
    mocks.setComposeDirty.mockReset();
    mocks.addToast.mockReset();
    mocks.loadDraftFromStorage.mockReset();
    mocks.quotedReplyHtml = "";
    mocks.recipients.to = ["to@example.com"];
    mocks.recipients.cc = [];
    mocks.recipients.bcc = [];
    mocks.loadDraftFromStorage.mockReturnValue(null);
    vi.mocked(deleteDraft).mockReset();
    vi.mocked(stageComposeAttachment).mockReset();
    vi.mocked(stageComposeAttachment).mockImplementation(async (filename) => `staged/${filename}`);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("shows a user-visible error when sent draft cleanup fails", async () => {
    vi.mocked(deleteDraft).mockRejectedValue(new Error("remote draft delete failed"));
    mocks.mutate.mockImplementation((_params, options) => options.onSuccess());

    render(<ComposeView />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("account-1", "draft-1"));
    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
    })));
  });

  it("validates a restored new-message draft against loaded account ids", () => {
    render(<ComposeView />);

    expect(mocks.loadDraftFromStorage).toHaveBeenCalledWith(["account-1"]);
  });

  it("sends a typed valid recipient without requiring Enter first", async () => {
    mocks.recipients.to = [];

    render(<ComposeView />);

    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "To" }), {
      target: { value: "typed@example.com" },
    });

    await waitFor(() => expect(sendButton.disabled).toBe(false));
    fireEvent.click(sendButton);

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["typed@example.com"] }),
      expect.any(Object),
    ));
  });

  it("keeps quoted replies collapsed until the user expands them", () => {
    mocks.quotedReplyHtml = "<blockquote><p>Original message body</p></blockquote>";

    render(<ComposeView />);

    expect(screen.getByRole("button", { name: "Show quoted message" })).toBeTruthy();
    expect(screen.queryByText("Original message body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show quoted message" }));

    expect(screen.getByText("Original message body")).toBeTruthy();
  });

  it("uses the first attached filename as an empty subject", async () => {
    render(<ComposeView />);

    const first = attachmentFile("季度报告.pdf", "quarterly results");
    const second = attachmentFile("supporting-data.xlsx", "supporting data");

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [first, second] } });

    await waitFor(() => expect(vi.mocked(stageComposeAttachment)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByLabelText("Subject") as HTMLInputElement).value)
      .toBe("季度报告.pdf"));
  });

  it("does not let a later concurrent attachment refill a subject the user cleared", async () => {
    let resolveFirst!: (path: string) => void;
    let resolveSecond!: (path: string) => void;
    vi.mocked(stageComposeAttachment).mockImplementation((filename) => new Promise((resolve) => {
      if (filename === "first.pdf") resolveFirst = resolve;
      if (filename === "second.pdf") resolveSecond = resolve;
    }));

    render(<ComposeView />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    const subjectInput = screen.getByLabelText("Subject") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, { target: { files: [attachmentFile("first.pdf")] } });
    await waitFor(() => expect(stageComposeAttachment).toHaveBeenCalledWith("first.pdf", expect.any(Array)));
    fireEvent.change(fileInput!, { target: { files: [attachmentFile("second.pdf")] } });
    await waitFor(() => expect(stageComposeAttachment).toHaveBeenCalledWith("second.pdf", expect.any(Array)));

    await act(async () => resolveFirst("staged/first.pdf"));
    await waitFor(() => expect(subjectInput.value).toBe("first.pdf"));
    fireEvent.change(subjectInput, { target: { value: "" } });

    await act(async () => resolveSecond("staged/second.pdf"));
    await waitFor(() => expect(screen.getByText("second.pdf")).toBeTruthy());
    expect(subjectInput.value).toBe("");
  });

  it("keeps successfully staged files when a later file in the batch fails", async () => {
    vi.mocked(stageComposeAttachment)
      .mockResolvedValueOnce("staged/first.pdf")
      .mockRejectedValueOnce(new Error("staging failed"));

    render(<ComposeView />);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: { files: [attachmentFile("first.pdf"), attachmentFile("broken.pdf")] },
    });

    await waitFor(() => expect(screen.getByText("first.pdf")).toBeTruthy());
    expect(screen.queryByText("broken.pdf")).toBeNull();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("first.pdf");
    expect(screen.getByRole("alert").textContent).toContain("Failed to attach file");
  });
});
