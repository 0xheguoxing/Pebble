import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  Send,
  FileEdit,
  Trash2,
  Archive,
  AlertTriangle,
  Folder,
  FolderTree,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Settings,
  Search,
  Clock,
  Star,
  ContactRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../stores/ui.store";
import { isComposeDirty, useComposeStore } from "../stores/compose.store";
import { useConfirmStore } from "../stores/confirm.store";
import { useMailStore } from "../stores/mail.store";
import { useAccountsQuery, useFoldersForAccountsQuery } from "../hooks/queries";
import { useFolderUnreadCountsForAccounts } from "../hooks/queries/useFolderUnreadCounts";
import {
  ALL_ACCOUNTS_SELECT_VALUE,
  RULES_PARENT_REMOTE_ID,
  buildAllAccountsFolders,
  sortFoldersForSidebar,
  unreadCountForFolder,
} from "../lib/folderAggregation";
import { deleteFolder } from "../lib/api";
import type { Account, Folder as FolderType } from "../lib/api";

const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_FOLDERS: FolderType[] = [];

const ROLE_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox size={16} />,
  sent: <Send size={16} />,
  drafts: <FileEdit size={16} />,
  trash: <Trash2 size={16} />,
  archive: <Archive size={16} />,
  spam: <AlertTriangle size={16} />,
};

function folderIcon(role: FolderType["role"]): React.ReactNode {
  return (role && ROLE_ICONS[role]) || <Folder size={16} />;
}

// Default folders shown when no account is configured
const DEFAULT_FOLDERS: { role: string; labelKey: string }[] = [
  { role: "inbox", labelKey: "sidebar.inbox" },
  { role: "sent", labelKey: "sidebar.sent" },
  { role: "archive", labelKey: "sidebar.archive" },
  { role: "drafts", labelKey: "sidebar.drafts" },
  { role: "trash", labelKey: "sidebar.trash" },
  { role: "spam", labelKey: "sidebar.spam" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeFolderId = useMailStore((s) => s.activeFolderId);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const setActiveAccountId = useMailStore((s) => s.setActiveAccountId);
  const setActiveFolderId = useMailStore((s) => s.setActiveFolderId);

  const showUnread = useUIStore((s) => s.showFolderUnreadCount);
  const { data: accounts = EMPTY_ACCOUNTS } = useAccountsQuery();
  const allAccountsMode = accounts.length > 1 && !activeAccountId;
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    folder: FolderType;
  } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  function toggleParentFolder(folderId: string) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  async function handleDeleteFolder(folder: FolderType) {
    const confirmed = await useConfirmStore.getState().confirm({
      title: t("sidebar.deleteFolder", "Delete folder"),
      message: t("sidebar.deleteFolderConfirm", {
        name: folder.name,
        defaultValue: `Delete folder "${folder.name}"? Messages inside will be moved back to the Inbox.`,
      }),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteFolder(folder.id);
      setActiveFolderId(null);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["folder-unread-counts"] });
    } catch (e) {
      console.error("Failed to delete folder:", e);
    }
  }
  const folderAccountIds = useMemo(
    () => activeAccountId ? [activeAccountId] : accounts.map((account) => account.id),
    [accounts, activeAccountId],
  );
  const { data: folders = EMPTY_FOLDERS, isFetched: foldersFetched } = useFoldersForAccountsQuery(folderAccountIds);
  const { data: unreadCounts = {} } = useFolderUnreadCountsForAccounts(folderAccountIds);
  const ROLE_LABELS: Record<string, string> = {
    inbox: t("sidebar.inbox"),
    sent: t("sidebar.sent"),
    drafts: t("sidebar.drafts"),
    trash: t("sidebar.trash"),
    archive: t("sidebar.archive"),
    spam: t("sidebar.spam"),
  };
  const folderLabel = (folder: FolderType) => {
    if (folder.remote_id === RULES_PARENT_REMOTE_ID) {
      return t("sidebar.categoriesFolder", "Categories");
    }
    return (folder.role && ROLE_LABELS[folder.role]) || folder.name;
  };

  const displayedFolders = useMemo(
    () => allAccountsMode ? buildAllAccountsFolders(folders) : folders,
    [allAccountsMode, folders],
  );
  const hasRealFolders = displayedFolders.length > 0;

  // Keep system folders stable across all-account and single-account views.
  // Archive is intentionally hidden: this app doesn't expose an archive
  // workflow, and local-only archive folders have no remote counterpart.
  const dedupedFolders = useMemo(() => {
    return sortFoldersForSidebar(displayedFolders).filter((f) => f.role !== "archive");
  }, [displayedFolders]);

  // Split folders into top-level entries and their children so rule-created
  // folders can be nested under the "Categories" parent instead of flattening
  // against the Inbox.
  const { topLevelFolders, childrenByParentId } = useMemo(() => {
    const childrenByParentId = new Map<string, FolderType[]>();
    const topLevelFolders: FolderType[] = [];
    for (const folder of dedupedFolders) {
      if (folder.parent_id && dedupedFolders.some((f) => f.id === folder.parent_id)) {
        const list = childrenByParentId.get(folder.parent_id) ?? [];
        list.push(folder);
        childrenByParentId.set(folder.parent_id, list);
      } else {
        topLevelFolders.push(folder);
      }
    }
    return { topLevelFolders, childrenByParentId };
  }, [dedupedFolders]);

  // Auto-select the only account. With multiple accounts, null means the
  // combined "all accounts" mailbox.
  useEffect(() => {
    if (accounts.length === 1 && !activeAccountId) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  // Auto-select inbox folder when folders load.
  // If the selected account has no folders, try the next account.
  useEffect(() => {
    if (displayedFolders.length > 0 && !activeFolderId) {
      const inbox = displayedFolders.find((f) => f.role === "inbox");
      setActiveFolderId((inbox ?? displayedFolders[0]).id);
    } else if (!allAccountsMode && foldersFetched && displayedFolders.length === 0 && activeAccountId && accounts.length > 1) {
      const idx = accounts.findIndex((a) => a.id === activeAccountId);
      const next = accounts[idx + 1] ?? accounts.find((a) => a.id !== activeAccountId);
      if (next) {
        setActiveAccountId(next.id);
      }
    }
  }, [displayedFolders, foldersFetched, activeFolderId, setActiveFolderId, accounts, activeAccountId, setActiveAccountId, allAccountsMode]);

  async function confirmDiscardDraft() {
    if (isComposeDirty()) {
      const confirmed = await useConfirmStore.getState().confirm({
        title: t("compose.discardDraft", "Discard draft"),
        message: t("compose.discardDraftConfirm", "You have an unsaved draft. Discard and leave?"),
        destructive: true,
      });
      return confirmed;
    }
    return true;
  }

  async function safeSetActiveView(view: Parameters<typeof setActiveView>[0]) {
    if (isComposeDirty()) {
      const confirmed = await confirmDiscardDraft();
      if (!confirmed) return;
      useComposeStore.getState().discardComposeAndSetActiveView(view);
      return;
    }
    setActiveView(view);
  }

  async function handleFolderClick(folderId: string) {
    if (isComposeDirty()) {
      const confirmed = await confirmDiscardDraft();
      if (!confirmed) return;
      useComposeStore.getState().discardComposeAndSetActiveView("inbox");
      setActiveFolderId(folderId);
      return;
    }
    setActiveView("inbox");
    setActiveFolderId(folderId);
  }

  const buttonBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderRadius: "6px",
    padding: sidebarCollapsed ? "7px" : "6px 10px",
    width: "100%",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
    textAlign: "left",
    justifyContent: sidebarCollapsed ? "center" : "flex-start",
  };

  const starredButton = (
    <SidebarButton
      key="__starred__"
      icon={<Star size={16} />}
      label={t("sidebar.starred", "Starred")}
      isActive={activeView === "starred"}
      collapsed={sidebarCollapsed}
      style={buttonBase}
      onClick={() => safeSetActiveView("starred")}
    />
  );

  // Insert a Starred entry right after the inbox/sent folders, independent of
  // whether the account actually has a drafts folder (where it used to live).
  function renderFoldersWithStarred(
    folders: FolderType[],
    renderFolder: (folder: FolderType) => React.ReactNode,
  ): React.ReactNode[] {
    const items: React.ReactNode[] = [];
    let starredInserted = false;
    for (const folder of folders) {
      if (!starredInserted && folder.role !== "inbox" && folder.role !== "sent") {
        items.push(starredButton);
        starredInserted = true;
      }
      items.push(renderFolder(folder));
    }
    if (!starredInserted) {
      items.push(starredButton);
    }
    return items;
  }

  return (
    <>
    <aside
      aria-label={t("sidebar.navigation", "Sidebar")}
      style={{
        width: sidebarCollapsed ? "48px" : "200px",
        flexShrink: 0,
        backgroundColor: "var(--color-sidebar-bg)",
        borderRight: "1px solid var(--color-border)",
        transition: "width 150ms ease",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search button */}
      <nav aria-label={t("sidebar.search", "Search")} style={{ padding: "8px 6px 0", display: "flex", flexDirection: "column", gap: "1px" }}>
        <SidebarButton
          icon={<Search size={16} />}
          label={t("search.title", "Search")}
          isActive={activeView === "search"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("search")}
        />
      </nav>

      {/* Section label */}
      {!sidebarCollapsed && (
        <div style={{
          padding: "12px 10px 4px 10px",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {t("sidebar.mail", "Mail")}
        </div>
      )}

      {/* Account switcher */}
      {!sidebarCollapsed && accounts.length > 1 && (
        <div style={{ padding: "0 10px 8px" }}>
          <select
            aria-label={t("settings.emailAccounts", "Email Accounts")}
            value={activeAccountId || ALL_ACCOUNTS_SELECT_VALUE}
            onChange={(e) => {
              setActiveAccountId(e.target.value === ALL_ACCOUNTS_SELECT_VALUE ? null : e.target.value);
              setActiveFolderId(null);
            }}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: "13px",
              borderRadius: "8px",
              border: "1.5px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border))",
              backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            <option value={ALL_ACCOUNTS_SELECT_VALUE}>
              {t("sidebar.allAccounts", "All accounts")}
            </option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Folders section */}
      <nav
        className="scroll-region sidebar-folder-scroll"
        aria-label={t("sidebar.mailFolders", "Mail folders")}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 6px",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        }}
      >
        {hasRealFolders
          ? renderFoldersWithStarred(topLevelFolders, (folder) => {
              const children = childrenByParentId.get(folder.id) ?? [];
              const childButtons = children.map((child) => {
                const deletable = child.remote_id.startsWith("__local_");
                return (
                  <div
                    key={child.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!deletable) return;
                      setContextMenu({ x: e.clientX, y: e.clientY, folder: child });
                    }}
                  >
                    <SidebarButton
                      icon={folderIcon(child.role)}
                      label={folderLabel(child)}
                      badge={showUnread ? unreadCountForFolder(child.id, folders, unreadCounts) : undefined}
                      isActive={child.id === activeFolderId && activeView === "inbox"}
                      collapsed={sidebarCollapsed}
                      style={{ ...buttonBase, paddingLeft: sidebarCollapsed ? "7px" : "24px" }}
                      onClick={() => handleFolderClick(child.id)}
                    />
                  </div>
                );
              });
              if (children.length > 0) {
                const isCollapsed = collapsedParents.has(folder.id);
                return (
                  <div key={folder.id}>
                    <button
                      type="button"
                      onClick={() => toggleParentFolder(folder.id)}
                      aria-expanded={!isCollapsed}
                      title={sidebarCollapsed ? folderLabel(folder) : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                        padding: sidebarCollapsed ? "7px" : "6px 10px",
                        fontSize: "13px",
                        color: "var(--color-text-primary)",
                        background: "transparent",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        justifyContent: sidebarCollapsed ? "center" : "flex-start",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <FolderTree size={16} />
                      {!sidebarCollapsed && (
                        <>
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              textAlign: "left",
                            }}
                          >
                            {folderLabel(folder)}
                          </span>
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </>
                      )}
                    </button>
                    {!isCollapsed && childButtons}
                  </div>
                );
              }
              return (
                <SidebarButton
                  key={folder.id}
                  icon={folderIcon(folder.role)}
                  label={folderLabel(folder)}
                  badge={showUnread ? unreadCountForFolder(folder.id, folders, unreadCounts) : undefined}
                  isActive={folder.id === activeFolderId && activeView === "inbox"}
                  collapsed={sidebarCollapsed}
                  style={buttonBase}
                  onClick={() => handleFolderClick(folder.id)}
                />
              );
            })
          : DEFAULT_FOLDERS.flatMap((df, index) => {
              const items: React.ReactNode[] = [];
              if (df.role === "drafts") {
                items.push(starredButton);
              }
              items.push(
                <SidebarButton
                  key={df.role}
                  icon={ROLE_ICONS[df.role] || <Folder size={16} />}
                  label={t(df.labelKey)}
                  isActive={index === 0 && activeView === "inbox"}
                  collapsed={sidebarCollapsed}
                  style={buttonBase}
                  onClick={() => safeSetActiveView("inbox")}
                />
              );
              return items;
            })}
      </nav>

      {/* Divider */}
      <div
        style={{
          height: "1px",
          backgroundColor: "var(--color-border)",
          margin: "0 6px",
        }}
      />

      {/* Bottom nav: Contacts + Snoozed + Kanban + Settings */}
      <nav
        aria-label={t("sidebar.tools", "Tools")}
        style={{
          padding: "6px 6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        }}
      >
        <SidebarButton
          icon={<ContactRound size={16} />}
          label={t("sidebar.contacts", "Contacts")}
          isActive={activeView === "contacts"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("contacts")}
        />
        <SidebarButton
          icon={<Clock size={16} />}
          label={t("sidebar.snoozed", "Snoozed")}
          isActive={activeView === "snoozed"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("snoozed")}
        />
        <SidebarButton
          icon={<LayoutGrid size={16} />}
          label={t("sidebar.kanban", "Kanban")}
          isActive={activeView === "kanban"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("kanban")}
        />
        <SidebarButton
          icon={<Settings size={16} />}
          label={t("sidebar.settings", "Settings")}
          isActive={activeView === "settings"}
          collapsed={sidebarCollapsed}
          style={buttonBase}
          onClick={() => safeSetActiveView("settings")}
        />
      </nav>
    </aside>
    {contextMenu && (
      <div
        style={{
          position: "fixed",
          left: contextMenu.x,
          top: contextMenu.y,
          zIndex: 1000,
          minWidth: "120px",
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "5px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          padding: "3px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => {
            const target = contextMenu.folder;
            setContextMenu(null);
            void handleDeleteFolder(target);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            width: "100%",
            padding: "5px 8px",
            border: "none",
            background: "transparent",
            color: "var(--color-text-primary)",
            fontSize: "12px",
            lineHeight: 1,
            textAlign: "left",
            borderRadius: "3px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
            e.currentTarget.style.color = "#ef4444";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--color-text-primary)";
          }}
        >
          <Trash2 size={13} />
          {t("sidebar.deleteFolder", "Delete folder")}
        </button>
      </div>
    )}
    </>
  );
}

// Reusable sidebar button to avoid repetitive hover logic
function SidebarButton({
  icon, label, badge, isActive, collapsed, style, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  isActive: boolean;
  collapsed: boolean;
  style: React.CSSProperties;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      title={collapsed ? label : undefined}
      disabled={disabled}
      style={{
        ...style,
        backgroundColor: isActive
          ? "var(--color-sidebar-active)"
          : style.backgroundColor ?? "transparent",
        color: style.color ?? "var(--color-text-primary)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        transition: "background-color 0.15s ease, opacity 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isActive && !style.backgroundColor)
          e.currentTarget.style.backgroundColor = "var(--color-sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive && !style.backgroundColor)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {icon}
      {!collapsed && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {label}
        </span>
      )}
      {!collapsed && badge != null && badge > 0 && (
        <span style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-accent)",
          minWidth: "18px",
          textAlign: "right",
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}
