"use client";

import { useDispatch, useSelector } from "react-redux";
import { storage } from "../lib/utils.js";
import { selectCurrentUser } from "../store/authSlice.js";
import {
  useGetCartQuery,
  useAddToCartMutation,
  useUpdateCartItemMutation,
  useRemoveFromCartMutation,
} from "../store/shopApi.js";
import {
  guestAdd,
  guestUpdate,
  guestRemove,
  guestClear,
  selectGuestItems,
} from "../store/guestCartSlice.js";

// Unified cart interface: server-backed when logged in, localStorage-backed
// guest cart otherwise. Items have the same shape in both modes:
//   { product, size, quantity }
export function useCart() {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const guestItems = useSelector(selectGuestItems);

  const { data, isLoading } = useGetCartQuery(undefined, { skip: !user });
  const [addToCartApi] = useAddToCartMutation();
  const [updateApi] = useUpdateCartItemMutation();
  const [removeApi] = useRemoveFromCartMutation();

  if (user) {
    const items = data?.cart?.items || [];
    return {
      isGuest: false,
      isLoading,
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      addItem: ({ product, size, quantity }) =>
        addToCartApi({ productId: product._id, size, quantity }).unwrap(),
      updateItem: ({ productId, size, quantity }) =>
        updateApi({ productId, size, quantity }).unwrap(),
      removeItem: ({ productId, size }) =>
        removeApi({ productId, size }).unwrap(),
      clear: () => {},
    };
  }

  return {
    isGuest: true,
    isLoading: false,
    items: guestItems,
    count: guestItems.reduce((n, i) => n + i.quantity, 0),
    addItem: async ({ product, size, quantity }) => {
      dispatch(guestAdd({ product, size, quantity }));
    },
    updateItem: async ({ productId, size, quantity }) => {
      dispatch(guestUpdate({ productId, size, quantity }));
    },
    removeItem: async ({ productId, size }) => {
      dispatch(guestRemove({ productId, size }));
    },
    clear: () => dispatch(guestClear()),
  };
}

// Merge the guest cart into the server cart after authentication.
// Called from login/register success handlers. Items already in the server
// cart aren't duplicated — the backend's POST /cart should add quantities
// to existing entries for the same (productId, size).
export async function mergeGuestCartAfterLogin(dispatch, addToCartMutation) {
  const items = storage.getJSON("ss:guestCart", []);
  if (!Array.isArray(items) || items.length === 0) return;
  for (const it of items) {
    try {
      await addToCartMutation({
        productId: it.productId,
        size: it.size,
        quantity: it.quantity,
      }).unwrap();
    } catch {
      // Skip items that fail (out of stock, removed product, etc.)
    }
  }
  dispatch(guestClear());
}
