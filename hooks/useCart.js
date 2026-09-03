"use client";

import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
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
// guest cart otherwise. Items are keyed by (productId, variantId) — the
// variant's own Mongo _id — not a bare size string, which can't tell two
// different-colored variants apart (see Phase 4 audit). `addItem` takes
// the full selected variant object so both cart backends can snapshot its
// color/size/fabric/price/image without re-fetching the product.
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
      addItem: ({ product, variant, quantity }) =>
        addToCartApi({ productId: product._id, variantId: variant._id, quantity }).unwrap(),
      updateItem: ({ productId, variantId, quantity }) =>
        updateApi({ productId, variantId, quantity }).unwrap(),
      removeItem: ({ productId, variantId }) =>
        removeApi({ productId, variantId }).unwrap(),
      clear: () => {},
    };
  }

  return {
    isGuest: true,
    isLoading: false,
    items: guestItems,
    count: guestItems.reduce((n, i) => n + i.quantity, 0),
    addItem: async ({ product, variant, quantity }) => {
      dispatch(guestAdd({ product, variant, quantity }));
    },
    updateItem: async ({ productId, variantId, quantity }) => {
      dispatch(guestUpdate({ productId, variantId, quantity }));
    },
    removeItem: async ({ productId, variantId }) => {
      dispatch(guestRemove({ productId, variantId }));
    },
    clear: () => dispatch(guestClear()),
  };
}

// Merge the guest cart into the server cart after authentication.
// Called from login/register success handlers. Items already in the server
// cart aren't duplicated — the backend's POST /cart should add quantities
// to existing entries for the same (productId, variantId).
//
// Only items that actually merge are removed from guest storage — a failed
// item (out of stock, a network blip) stays in the guest cart rather than
// being silently discarded. Previously this cleared the whole guest cart
// unconditionally after the loop, so any single failure quietly deleted
// every other item the customer had added, with no error shown at all.
export async function mergeGuestCartAfterLogin(dispatch, addToCartMutation) {
  const items = storage.getJSON("ss:guestCart", []);
  if (!Array.isArray(items) || items.length === 0) return;

  let succeeded = 0;
  let failed = 0;
  for (const it of items) {
    try {
      await addToCartMutation({
        productId: it.productId,
        variantId: it.variantId,
        quantity: it.quantity,
      }).unwrap();
      dispatch(guestRemove({ productId: it.productId, variantId: it.variantId }));
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  if (failed > 0) {
    toast.warning(
      succeeded > 0
        ? `${succeeded} item${succeeded === 1 ? "" : "s"} added to your account. ${failed} item${failed === 1 ? "" : "s"} couldn't be added and ${failed === 1 ? "is" : "are"} still in your bag.`
        : `Couldn't add your saved items right now — they're still in your bag.`,
    );
  }
}
