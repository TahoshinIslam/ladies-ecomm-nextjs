"use client";

import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";

/**
 * Seeds an RTK Query cache entry from data a Server Component already
 * fetched, so the client never re-fetches the same data on mount — while
 * never dispatching a Redux action during render (the seed happens inside
 * a real effect) and never showing a loading gate on the very first paint
 * (the server-provided data renders directly until the seed effect has
 * run, at which point RTK Query's own state takes over with the identical
 * data already in its cache).
 *
 * `useQueryHook`   — the RTK Query auto-generated hook (e.g. useGetAllOrdersQuery)
 * `queryArgs`      — the exact args this render will call it with
 * `initialData`    — the server-fetched value for those exact args (or
 *                     undefined if this page has nothing to seed)
 * `upsertThunk`    — `(args, data) => someApi.util.upsertQueryData("endpointName", args, data)`,
 *                     pre-bound by the caller to the right slice + endpoint name
 *
 * Only ever seeds ONCE, on mount, with the args/data pair the page was
 * rendered with — every later arg change (pagination, filters, search)
 * goes through the query hook's own ordinary fetch behavior untouched.
 */
export function useHydratedQuery(useQueryHook, queryArgs, initialData, upsertThunk) {
  const dispatch = useDispatch();
  const seededRef = useRef(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (initialData !== undefined && initialData !== null) {
      dispatch(upsertThunk(queryArgs, initialData));
    }
    setSeeded(true);
    // Deliberately empty deps — this effect is the one-time initial
    // hydration handoff, not an ongoing sync with queryArgs/initialData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queryState = useQueryHook(queryArgs, { skip: !seeded });

  if (!seeded) {
    // Pre-seed render (the server pass, and the first client frame before
    // the effect above has run): serve the server-provided data directly
    // instead of the query hook's own (intentionally skipped,
    // uninitialized) state, so both the initial HTML and the first client
    // paint show real content rather than a loading gate.
    return {
      data: initialData,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: undefined,
      refetch: () => {},
    };
  }
  return queryState;
}
