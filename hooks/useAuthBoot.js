"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useMeQuery } from "../store/userApi.js";
import { setCredentials, clearCredentials } from "../store/authSlice.js";

// On app boot, ask the server who (if anyone) the session cookie belongs
// to. Phase 2: called unconditionally, every time — there is no
// client-readable trace of the session left in localStorage to check
// first (the whole point of an HttpOnly cookie), so skipping this call
// when nothing is cached client-side would incorrectly treat "we don't
// know yet" as "definitely logged out." A valid cookie restores the
// authenticated user; a missing/invalid one resolves to "unauthenticated"
// via the 401 branch below. Wired into the tree from
// context/ThemeProvider.jsx's StorageHydrator, which is the one place this
// runs once per app load.
export default function useAuthBoot() {
  const dispatch = useDispatch();
  const { data, isSuccess, isError, error } = useMeQuery();

  useEffect(() => {
    if (isSuccess && data?.user) {
      dispatch(setCredentials(data.user));
    }
    if (isError && error?.status === 401) {
      dispatch(clearCredentials());
    }
  }, [isSuccess, isError, data, error, dispatch]);
}
