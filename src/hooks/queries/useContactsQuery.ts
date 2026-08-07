import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listContacts } from "@/lib/api";

export const contactsQueryRoot = ["contacts"] as const;
export const contactSuggestionsQueryRoot = ["contact-suggestions"] as const;

export interface ContactsQueryOptions {
  query: string;
  favoriteOnly: boolean;
  limit: number;
  offset: number;
}

export const contactsQueryKey = ({
  query,
  favoriteOnly,
  limit,
  offset,
}: ContactsQueryOptions) => ["contacts", query, favoriteOnly, limit, offset] as const;

export const contactQueryKey = (contactId: string) => ["contact", contactId] as const;

export const contactSuggestionsQueryKey = (accountId: string, query: string) =>
  ["contact-suggestions", accountId, query] as const;

export function useContactsQuery(options: ContactsQueryOptions) {
  const [debouncedQuery, setDebouncedQuery] = useState(options.query);

  useEffect(() => {
    if (options.query === debouncedQuery) return;
    const timer = window.setTimeout(() => setDebouncedQuery(options.query), 200);
    return () => window.clearTimeout(timer);
  }, [debouncedQuery, options.query]);

  const debouncedOptions = { ...options, query: debouncedQuery };
  return useQuery({
    queryKey: contactsQueryKey(debouncedOptions),
    queryFn: () => listContacts(
      debouncedQuery,
      options.favoriteOnly,
      options.limit,
      options.offset,
    ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
