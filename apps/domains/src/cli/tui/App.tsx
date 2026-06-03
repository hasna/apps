import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  getDomainDetails,
  listDomains,
  listExpiring,
  searchDomains,
} from "../../db/domains.js";
import { listDnsRecords } from "../../db/dns-records.js";
import type { Domain, DomainDetails } from "../../db/domains.js";
import { Header } from "./Header.js";
import { DomainTable } from "./DomainTable.js";
import { DomainDetail } from "./DomainDetail.js";
import { SearchView } from "./SearchView.js";
import type { DomainFilter } from "./format.js";
import { DOMAIN_FILTERS } from "./format.js";

type View = "list" | "detail" | "search";

export interface AppProps {
  initialStatus?: string;
}

function loadDomainsForFilter(activeFilter: DomainFilter): Domain[] {
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
  const initialFilter: DomainFilter =
    initialStatus === "active"
      ? "active"
      : initialStatus === "premium"
        ? "premium"
        : "all";
  const [filter, setFilter] = useState<DomainFilter>(initialFilter);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [details, setDetails] = useState<DomainDetails | null>(null);
  const [searchResults, setSearchResults] = useState<Domain[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);

  const [domains, setDomains] = useState<Domain[]>(() => loadDomainsForFilter(initialFilter));

  const refresh = useCallback(() => {
    const next = loadDomainsForFilter(filter);
    setDomains(next);
    setSelectedIndex((current) => Math.min(current, Math.max(0, next.length - 1)));
    return next;
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedDomain = domains[selectedIndex] ?? null;

  const previewDetails = useMemo(() => {
    if (!selectedDomain) return null;
    return getDomainDetails(selectedDomain.id);
  }, [selectedDomain]);

  const previewDns = useMemo(() => {
    if (!selectedDomain) return [];
    return listDnsRecords(selectedDomain.id);
  }, [selectedDomain]);

  useInput((input, key) => {
    if (input === "q" && view !== "search") {
      exit();
      return;
    }

    if (view === "list") {
      if (key.upArrow || input === "k") {
        setSelectedIndex((index) => Math.max(0, index - 1));
      } else if (key.downArrow || input === "j") {
        setSelectedIndex((index) => Math.min(domains.length - 1, index + 1));
      } else if (key.return && selectedDomain) {
        const full = getDomainDetails(selectedDomain.id);
        if (full) {
          setDetails(full);
          setView("detail");
        }
      } else if (input === "/") {
        setSearchResults([]);
        setSearchIndex(0);
        setView("search");
      } else if (input === "f") {
        setFilter((current) => {
          const index = DOMAIN_FILTERS.indexOf(current);
          return DOMAIN_FILTERS[(index + 1) % DOMAIN_FILTERS.length]!;
        });
      } else if (input === "r") {
        refresh();
      }
      return;
    }

    if (view === "search") {
      if (key.upArrow || input === "k") {
        setSearchIndex((index) => Math.max(0, index - 1));
      } else if (key.downArrow || input === "j") {
        setSearchIndex((index) => Math.min(searchResults.length - 1, index + 1));
      }
      return;
    }

    if (view === "detail") {
      if (key.escape) {
        setView("list");
        refresh();
      } else if (input === "r" && details) {
        setDetails(getDomainDetails(details.domain.id));
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
    const results = searchDomains(trimmed);
    setSearchResults(results);
    setSearchIndex(0);
  }, []);

  const handleSearchSelect = useCallback((domain: Domain) => {
    const full = getDomainDetails(domain.id);
    if (full) {
      setDetails(full);
      setView("detail");
    }
  }, []);

  const detailDns = details ? listDnsRecords(details.domain.id) : [];

  return (
    <Box flexDirection="column" padding={1}>
      <Header count={view === "search" ? searchResults.length : domains.length} filter={filter} view={view} />

      {view === "list" && (
        <Box flexDirection="column">
          <DomainTable domains={domains} selectedIndex={selectedIndex} />
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
          selectedIndex={searchIndex}
          onSearch={handleSearch}
          onSelect={handleSearchSelect}
          onBack={() => setView("list")}
        />
      )}
    </Box>
  );
}
