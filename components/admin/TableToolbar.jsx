"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import Input from "../ui/Input.jsx";
import Button from "../ui/Button.jsx";
import { cn } from "../../lib/utils.js";

/**
 * The search + filters + "Clear filters" row shared by every admin table.
 * Debounces the search box locally (350ms) before pushing it up, so typing
 * stays snappy while the URL/query only updates once someone pauses —
 * avoiding a network request per keystroke.
 */
export default function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  activeFilterCount = 0,
  onClearFilters,
  right,
  className,
}) {
  const [localSearch, setLocalSearch] = useState(search || "");

  // Resync the local draft when `search` changes from outside this
  // component (URL nav, "Clear filters") — set during render (React's
  // documented "adjust state when a prop changes" pattern, same idiom
  // Header.jsx uses for its own pathname-driven reset) rather than in an
  // effect, so it can't cause an extra render pass.
  const [syncedSearch, setSyncedSearch] = useState(search || "");
  if ((search || "") !== syncedSearch) {
    setSyncedSearch(search || "");
    setLocalSearch(search || "");
  }

  useEffect(() => {
    if (!onSearchChange || localSearch === (search || "")) return;
    const t = setTimeout(() => onSearchChange(localSearch), 350);
    return () => clearTimeout(t);
    // Only re-run when the local typed value changes — re-running on
    // `search`/`onSearchChange` too would re-fire the timer on every URL
    // sync this same debounce just caused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {onSearchChange && (
        <Input
          icon={Search}
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
          className="max-w-xs"
        />
      )}
      {filters}
      {activeFilterCount > 0 && onClearFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
          <X className="h-3.5 w-3.5" />
          Clear filters ({activeFilterCount})
        </Button>
      )}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
