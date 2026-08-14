import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  getDomainDetails,
  listDomains,
  listExpiring,
  searchDomains,
  listDnsRecords,
} from "../../db/domains.js";
import type { Domain, DomainDetails, DnsRecord } from "../../db/domains.js";
import { Header } from "./Header.js";
import { DomainTable } from "./DomainTable.js";
import { DomainDetail } from "./DomainDetail.js";
import { SearchView } from "./SearchView.js";
import type { DomainFilter } from "./format.js";
import { DOMAIN_FILTERS, clampSelectedIndex, resolveInitialFilter } from "./format.js";

type View = "list" | "detail" | "search";

export interface AppProps {
  initialStatus?: string;
}

function loadDomainsForFilter(activeFilter: DomainFilter): Promise<Domain[]> {
  switch (activeFilter) {
    case "active":
      return listDomains({ status: "active" });
    case "premium":
      return listDomains({ is_premium: true });
    case "expiring":
      return listExpiring(30);
    default:
      return listDomains();
  }
}

export function App({ initialStatus }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("list");
  const initialFilter = resolveInitialFilter(initialStatus);
  const [filter, setFilter] = useState<DomainFilter>(initialFilter);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [details, setDetails] = useState<DomainDetails | null>(null);
  const [searchResults, setSearchResults] = useState<Domain[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);

  const [domains, setDomains] = useState<Domain[]>([]);
  const [previewDetails, setPreviewDetails] = useState<DomainDetails | null>(null);
  const [previewDns, setPreviewDns] = useState<DnsRecord[]>([]);
  const [detailDns, setDetailDns] = useState<DnsRecord[]>([]);

  const refresh = useCallback(async () => {
    const next = await loadDomainsForFilter(filter);
    setDomains(next);
    setSelectedIndex((current) => clampSelectedIndex(current, next.length));
    return next;
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedDomain = domains[clampSelectedIndex(selectedIndex, domains.length)] ?? null;

  // Load preview details + DNS for the highlighted domain (list view).
  useEffect(() => {
    if (!selectedDomain) {
      setPreviewDetails(null);
      setPreviewDns([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [d, dns] = await Promise.all([
        getDomainDetails(selectedDomain.id),
        listDnsRecords(selectedDomain.id),
      ]);
      if (!cancelled) {
        setPreviewDetails(d);
        setPreviewDns(dns);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDomain]);

  // Load DNS records for the open detail view.
  useEffect(() => {
    if (!details) {
      setDetailDns([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const dns = await listDnsRecords(details.domain.id);
      if (!cancelled) setDetailDns(dns);
    })();
    return () => {
      cancelled = true;
    };
  }, [details]);

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }

    if (view === "list") {
      if (key.upArrow || input === "k") {
        setSelectedIndex((index) => clampSelectedIndex(index - 1, domains.length));
      } else if (key.downArrow || input === "j") {
        if (domains.length === 0) return;
        setSelectedIndex((index) => clampSelectedIndex(index + 1, domains.length));
      } else if (key.return && selectedDomain) {
        void (async () => {
          const full = await getDomainDetails(selectedDomain.id);
          if (full) {
            setDetails(full);
            setView("detail");
          }
        })();
      } else if (input === "/") {
        setSearchResults([]);
        setSearchIndex(0);
        setView("search");
      } else if (input === "f") {
        setFilter((current) => {
          const index = DOMAIN_FILTERS.indexOf(current);
          return DOMAIN_FILTERS[(index + 1) % DOMAIN_FILTERS.length]!;
        });
        setSelectedIndex(0);
      } else if (input === "r") {
        refresh();
      }
      return;
    }

    if (view === "search") {
      if (key.upArrow) {
        setSearchIndex((index) => clampSelectedIndex(index - 1, searchResults.length));
      } else if (key.downArrow) {
        if (searchResults.length === 0) return;
        setSearchIndex((index) => clampSelectedIndex(index + 1, searchResults.length));
      }
      return;
    }

    if (view === "detail") {
      if (key.escape) {
        setView("list");
        void refresh();
      } else if (input === "r" && details) {
        void (async () => {
          setDetails(await getDomainDetails(details.domain.id));
        })();
      }
    }
  });

  const handleSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }
    void (async () => {
      const results = await searchDomains(trimmed);
      setSearchResults(results);
      setSearchIndex(0);
    })();
  }, []);

  const handleSearchSelect = useCallback((domain: Domain) => {
    void (async () => {
      const full = await getDomainDetails(domain.id);
      if (full) {
        setDetails(full);
        setView("detail");
      }
    })();
  }, []);

  const listSelectedIndex = clampSelectedIndex(selectedIndex, domains.length);

  return (
    <Box flexDirection="column" padding={1}>
      <Header count={view === "search" ? searchResults.length : domains.length} filter={filter} view={view} />

      {view === "list" && (
        <Box flexDirection="column">
          <DomainTable domains={domains} selectedIndex={listSelectedIndex} />
          {previewDetails && (
            <Box marginTop={1} flexDirection="column">
              <Text bold dimColor>Selected</Text>
              <DomainDetail details={previewDetails} dnsRecords={previewDns} compact />
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              ↑↓ j/k navigate · enter detail · / search · f filter · r refresh · q quit
            </Text>
          </Box>
        </Box>
      )}

      {view === "detail" && details && (
        <DomainDetail details={details} dnsRecords={detailDns} />
      )}

      {view === "search" && (
        <SearchView
          results={searchResults}
          selectedIndex={clampSelectedIndex(searchIndex, searchResults.length)}
          onSearch={handleSearch}
          onSelect={handleSearchSelect}
          onBack={() => setView("list")}
        />
      )}
    </Box>
  );
}
