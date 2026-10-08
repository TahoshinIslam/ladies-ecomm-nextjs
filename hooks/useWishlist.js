"use client";

import { useDispatch, useSelector } from "react-redux";

import { selectCurrentUser } from "../store/authSlice.js";
import { useGetWishlistQuery, useToggleWishlistMutation } from "../store/shopApi.js";
import { guestWishAdd, guestWishRemove, selectGuestWishlist } from "../store/guestWishlistSlice.js";

// Saved products, for a signed-in customer (their account's wishlist on the server) and for a visitor who is not signed in (kept on this
// device until they sign in, then merged into the account). Callers use one shape either way.
export function useWishlist() {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const guestItems = useSelector(selectGuestWishlist);

  const { data, isLoading } = useGetWishlistQuery(undefined, { skip: !user });
  const [toggleApi, { isLoading: toggling }] = useToggleWishlistMutation();

  if (user) {
    const products = data?.wishlist?.products ?? [];
    const ids = new Set(products.map((p) => p._id || p));
    return {
      isGuest: false,
      isLoading,
      busy: toggling,
      products,
      count: products.length,
      has: (id) => ids.has(id),
      // Resolves to { added } like the server's own answer.
      toggle: async (product) => {
        const res = await toggleApi(product._id).unwrap();
        return { added: Boolean(res.added) };
      },
    };
  }

  const ids = new Set(guestItems.map((p) => p._id));
  return {
    isGuest: true,
    isLoading: false,
    busy: false,
    products: guestItems,
    count: guestItems.length,
    has: (id) => ids.has(id),
    toggle: async (product) => {
      if (ids.has(product._id)) {
        dispatch(guestWishRemove(product._id));
        return { added: false };
      }
      dispatch(guestWishAdd(product));
      return { added: true };
    },
  };
}

// After signing in or registering: add every product saved on this device to the account's wishlist (an idempotent add, so a product
// already saved there is left alone), and drop it from the device only once it is safely in the account.
export async function mergeGuestWishlistAfterLogin(dispatch, addToWishlistMutation, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  for (const p of items) {
    try {
      await addToWishlistMutation(p._id).unwrap();
      dispatch(guestWishRemove(p._id));
    } catch {
      // Stays on this device and is tried again at the next sign-in.
    }
  }
}
