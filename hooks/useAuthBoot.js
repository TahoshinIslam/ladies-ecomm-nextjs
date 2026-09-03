"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { useMeQuery } from "../store/userApi.js";
import { setCredentials, clearCredentials } from "../store/authSlice.js";
import { storage } from "../lib/utils.js";

// On app boot, revalidate the JWT cookie with the backend. If it's still
// valid, refresh the cached user; otherwise clear it.
export default function useAuthBoot() {
  const dispatch = useDispatch();
  const { data, isSuccess, isError, error } = useMeQuery(undefined, {
    // Only hit /me if we already think we have a session (avoids 401 spam on boot)
    skip: !storage.get("ss:user"),
  });

  useEffect(() => {
    if (isSuccess && data?.user) {
      dispatch(setCredentials(data.user));
    }
    if (isError && error?.status === 401) {
      dispatch(clearCredentials());
    }
  }, [isSuccess, isError, data, error, dispatch]);
}
