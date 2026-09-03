"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  MapPin,
  CreditCard,
  Tag,
  ShoppingBag,
  Check,
  Loader2,
  Smartphone,
  Banknote,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import Input from "../components/ui/Input.jsx";
import Select from "../components/ui/Select.jsx";
import Textarea from "../components/ui/Textarea.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";

import {
  useGetMyAddressesQuery,
  useCreateAddressMutation,
  useValidateCouponMutation,
  useCreateOrderMutation,
  usePreviewOrderMutation,
  useStripeCheckoutMutation,
  useBkashCreateMutation,
  useNagadCreateMutation,
  useCodCreateMutation,
} from "../store/shopApi.js";
import { selectCurrentUser } from "../store/authSlice.js";
import { useCart } from "../hooks/useCart.js";
import { formatCurrency, cn, resolveImage } from "../lib/utils.js";
import { downloadReceipt } from "../lib/receipt.js";
import { useSettings } from "../context/SettingsContext.jsx";

const addressSchema = z.object({
  fullName: z.string().min(2, "Required"),
  phone: z.string().min(6, "Required"),
  street: z.string().min(3, "Required"),
  city: z.string().min(2, "Required"),
  state: z.string().optional(),
  postalCode: z.string().min(2, "Required"),
  country: z.string().min(2, "Required"),
  label: z.enum(["home", "work", "other"]).default("home"),
});

// Stripe / bKash / Nagad are temporarily disabled until the gateway
// integrations are reworked. Only Cash on Delivery is offered at launch.
const PAYMENT_METHODS = [
  // { id: "stripe", label: "Credit/Debit Card", desc: "Secure checkout via Stripe", icon: CreditCard },
  // { id: "bkash", label: "bKash", desc: "Pay with your bKash wallet", icon: Smartphone },
  // { id: "nagad", label: "Nagad", desc: "Pay with Nagad", icon: Smartphone },
  { id: "cod", label: "Cash on Delivery", desc: "Pay when your order arrives", icon: Banknote },
];

export default function CheckoutPage() {
  const router = useRouter();
  const user = useSelector(selectCurrentUser);
  const settings = useSettings();

  // Guests can browse checkout — auth is only required when placing the order.
  const { items: cartItems, isLoading: cartLoading } = useCart();
  const { data: addrData } = useGetMyAddressesQuery(undefined, { skip: !user });
  const [createAddress] = useCreateAddressMutation();
  const [validateCoupon] = useValidateCouponMutation();
  const [createOrder, { isLoading: placing }] = useCreateOrderMutation();
  const [previewOrder] = usePreviewOrderMutation();
  const [stripeCheckout] = useStripeCheckoutMutation();
  const [bkashCreate] = useBkashCreateMutation();
  const [nagadCreate] = useNagadCreateMutation();
  const [codCreate] = useCodCreateMutation();

  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [notes, setNotes] = useState("");

  const [serverTotals, setServerTotals] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const items = cartItems ?? [];

  useEffect(() => {
    if (!selectedAddressId && addrData?.addresses?.length) {
      const def = addrData.addresses.find((a) => a.isDefault) || addrData.addresses[0];
      setSelectedAddressId(def._id);
    }
  }, [addrData, selectedAddressId]);

  // Newly-registered users land here from /login?redirect=/checkout with no
  // saved addresses yet — auto-open the new-address form so they immediately
  // see the next step instead of a disabled Place Order button.
  useEffect(() => {
    if (user && addrData && addrData.addresses?.length === 0 && !addingAddress) {
      setAddingAddress(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, addrData]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      fullName: user?.name || "",
      phone: user?.phone || "",
      country: "Bangladesh",
      label: "home",
    },
  });

  const selectedAddress = useMemo(
    () => addrData?.addresses?.find((a) => a._id === selectedAddressId),
    [addrData, selectedAddressId],
  );

  // Server-side preview, debounced to avoid hammering on every keystroke.
  // Skipped for guests — preview requires an authenticated session.
  useEffect(() => {
    if (!user || !items.length || !selectedAddress?.country) {
      setServerTotals(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await previewOrder({
          items: items.map((i) => ({
            product: i.product._id,
            size: i.size,
            quantity: i.quantity,
          })),
          shippingAddress: {
            fullName: selectedAddress.fullName,
            phone: selectedAddress.phone,
            street: selectedAddress.street,
            city: selectedAddress.city,
            state: selectedAddress.state || "",
            postalCode: selectedAddress.postalCode,
            country: selectedAddress.country,
          },
          couponCode: appliedCoupon?.coupon?.code,
        }).unwrap();
        if (!cancelled) setServerTotals(res.preview);
      } catch (e) {
        if (!cancelled) setServerTotals(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, items, selectedAddress, appliedCoupon, previewOrder]);

  // Local fallback math used only before first preview response arrives.
  // We compute in the user's display currency here so the UI doesn't flicker
  // before the server preview lands; once it does, totals.currency is the
  // authoritative checkout currency and we'll re-render everything in it.
  const fallbackTotals = useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      const p = it.product;
      if (!p) continue;
      const usdPrice = p.discountPrice ?? p.basePrice;
      const localPrice =
        settings.activeCurrency === "BDT"
          ? Math.round(usdPrice * (settings.currency?.usdToBdt || 120))
          : usdPrice;
      subtotal += localPrice * it.quantity;
    }
    return {
      subtotal,
      tax: 0,
      taxLabel: "",
      taxInclusive: false,
      shippingCost: 0,
      discount: 0,
      total: subtotal,
      currency: settings.activeCurrency || "USD",
    };
  }, [items, settings.activeCurrency, settings.currency?.usdToBdt]);

  const totals = serverTotals || fallbackTotals;
  const displayCurrency = totals.currency;

  // Convert a USD-stored product price into the active checkout currency.
  // The checkout currency is dictated by the shipping address (BD → BDT,
  // else USD), not by the user's browse-currency preference. This keeps
  // line items and totals in the same currency so the math reads cleanly.
  const toCheckoutPrice = (usdPrice) => {
    const rate = settings.currency?.usdToBdt || 120;
    if (displayCurrency === "BDT") return Math.round(Number(usdPrice) * rate);
    return Number(usdPrice);
  };

  const handleNewAddress = async (data) => {
    try {
      const res = await createAddress(data).unwrap();
      setSelectedAddressId(res.address._id);
      setAddingAddress(false);
      reset();
      toast.success("Address added");
    } catch (e) {
      toast.error(e?.data?.message || "Could not save address");
    }
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const res = await validateCoupon({
        code: couponCode.trim(),
        subtotal: totals.subtotal,
      }).unwrap();
      setAppliedCoupon(res);
      toast.success(`Coupon applied: -${formatCurrency(res.discount, displayCurrency)}`);
    } catch (e) {
      setAppliedCoupon(null);
      toast.error(e?.data?.message || "Invalid coupon");
    }
  };

  const handlePlaceOrder = async () => {
    if (!user) {
      router.push("/login?redirect=/checkout");
      return;
    }
    if (!selectedAddressId) {
      toast.error("Please select a shipping address");
      return;
    }
    if (items.length === 0) {
      toast.error("Your cart is empty");
      return;
    }
    const address = addrData.addresses.find((a) => a._id === selectedAddressId);
    if (!address) {
      toast.error("Invalid address");
      return;
    }

    try {
      const orderRes = await createOrder({
        items: items.map((i) => ({
          product: i.product._id,
          size: i.size,
          quantity: i.quantity,
        })),
        shippingAddress: {
          fullName: address.fullName,
          phone: address.phone,
          street: address.street,
          city: address.city,
          state: address.state || "",
          postalCode: address.postalCode,
          country: address.country,
        },
        couponCode: appliedCoupon?.coupon?.code,
        notes,
      }).unwrap();

      const orderId = orderRes.order._id;

      // Stripe / bKash / Nagad disabled until gateways are reworked.
      // if (paymentMethod === "stripe") {
      //   const res = await stripeCheckout(orderId).unwrap();
      //   window.location.href = res.url;
      //   return;
      // }
      // if (paymentMethod === "bkash") {
      //   const res = await bkashCreate(orderId).unwrap();
      //   window.location.href = res.url;
      //   return;
      // }
      // if (paymentMethod === "nagad") {
      //   toast.success("Order placed. Continue Nagad payment.");
      //   downloadReceipt(orderRes.order);
      //   router.push(`/order/${orderId}`);
      //   return;
      // }
      if (paymentMethod === "cod") {
        await codCreate(orderId).unwrap();
        toast.success("Order placed! Pay in cash on delivery.");
        downloadReceipt(orderRes.order);
        router.push(`/order/${orderId}`);
        return;
      }
    } catch (e) {
      toast.error(e?.data?.message || "Failed to place order");
    }
  };

  if (cartLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Your cart is empty"
        description="Add something to your cart to check out."
        action={<Button onClick={() => router.push("/shop")}>Continue shopping</Button>}
      />
    );
  }

  return (
    <div className="container-x py-8">
      <h1 className="mb-6 font-heading text-3xl font-black">Checkout</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left: forms */}
        <div className="space-y-6">
          <Section icon={MapPin} title="Shipping address">
            {!user ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm">
                <p className="text-muted-foreground">
                  Sign in to add a shipping address and place your order.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => router.push("/login?redirect=/checkout")}
                >
                  Sign in to continue
                </Button>
              </div>
            ) : addrData?.addresses?.length ? (
              <div className="space-y-2">
                {addrData.addresses.map((a) => (
                  <label
                    key={a._id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all",
                      selectedAddressId === a._id ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddressId === a._id}
                      onChange={() => setSelectedAddressId(a._id)}
                      className="mt-1"
                    />
                    <div className="flex-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{a.fullName}</span>
                        {a.isDefault && <Badge variant="default">Default</Badge>}
                        <Badge variant="outline" className="capitalize">{a.label}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{a.street}, {a.city}, {a.postalCode}, {a.country}</p>
                      <p className="text-muted-foreground">{a.phone}</p>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No saved addresses.</p>
            )}

            {!user ? null : !addingAddress ? (
              <Button variant="outline" onClick={() => setAddingAddress(true)} className="mt-3">
                + Add new address
              </Button>
            ) : (
              <form onSubmit={handleSubmit(handleNewAddress)} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label="Full name" {...register("fullName")} error={errors.fullName?.message} />
                <Input label="Phone" {...register("phone")} error={errors.phone?.message} />
                <Input label="Street" className="md:col-span-2" {...register("street")} error={errors.street?.message} />
                <Input label="City" {...register("city")} error={errors.city?.message} />
                <Input label="State" {...register("state")} />
                <Input label="Postal code" {...register("postalCode")} error={errors.postalCode?.message} />
                <Input label="Country" {...register("country")} error={errors.country?.message} />
                <div className="md:col-span-2 flex gap-2">
                  <Button type="submit">Save</Button>
                  <Button variant="outline" type="button" onClick={() => { setAddingAddress(false); reset(); }}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Section>

          <Section icon={CreditCard} title="Payment method">
            <div className="grid gap-2 md:grid-cols-2">
              {PAYMENT_METHODS.map((m) => {
                const Icon = m.icon;
                return (
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all",
                      paymentMethod === m.id ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === m.id}
                      onChange={() => setPaymentMethod(m.id)}
                      className="mt-1"
                    />
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 text-sm">
                      <p className="font-semibold">{m.label}</p>
                      <p className="text-xs text-muted-foreground">{m.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </Section>

          <Section icon={Tag} title="Promo code">
            <div className="flex gap-2">
              <Input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Enter code"
              />
              <Button onClick={handleApplyCoupon} disabled={!couponCode.trim()}>
                Apply
              </Button>
            </div>
            {appliedCoupon && (
              <div className="mt-3 flex items-center gap-2 text-sm text-success">
                <Check className="h-4 w-4" />
                <span>Applied <strong>{appliedCoupon.coupon.code}</strong></span>
              </div>
            )}
          </Section>

          <Section icon={ShoppingBag} title="Order notes (optional)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Special delivery instructions…"
              rows={3}
            />
          </Section>
        </div>

        {/* Right: summary */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:sticky lg:top-24 lg:self-start"
        >
          <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <h2 className="mb-4 font-heading text-xl font-bold">Order summary</h2>

            <ul className="divide-y divide-border">
              {items.map((it) => {
                const p = it.product;
                if (!p) return null;
                const usdPrice = p.discountPrice ?? p.basePrice;
                const lineTotal = toCheckoutPrice(usdPrice) * it.quantity;
                return (
                  <li key={`${p._id}-${it.size}`} className="py-3">
                    <div className="flex gap-3">
                      {/* Hatched plate stands in until artwork exists, matching
                          how ProductCard/CartDrawer render a missing image —
                          a raw <img> here would 404 against a placeholder
                          file that doesn't exist. */}
                      <div className="relative h-14 w-14 flex-none overflow-hidden rounded-md bg-media">
                        <div aria-hidden="true" className="absolute inset-0 hatch" />
                        {p.images?.[0] && (
                          <img
                            src={resolveImage(p.images[0], 112)}
                            alt={p.name}
                            loading="lazy"
                            decoding="async"
                            className="relative h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Size {it.size} · Qty {it.quantity}</p>
                      </div>
                      <p className="text-sm font-bold">
                        {/* In checkout currency — matches subtotal/total below */}
                        {formatCurrency(lineTotal, displayCurrency)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
              <Row
                label="Subtotal"
                value={formatCurrency(totals.subtotal, displayCurrency)}
              />
              <Row
                label={previewLoading ? "Shipping…" : "Shipping"}
                value={
                  totals.shippingCost === 0 ? (
                    <span className="text-success font-semibold">Free</span>
                  ) : (
                    formatCurrency(totals.shippingCost, displayCurrency)
                  )
                }
              />
              {totals.tax > 0 && !totals.taxInclusive && (
                <Row
                  label={totals.taxLabel || "Tax"}
                  value={formatCurrency(totals.tax, displayCurrency)}
                />
              )}
              {totals.discount > 0 && (
                <Row
                  label="Discount"
                  value={`-${formatCurrency(totals.discount, displayCurrency)}`}
                  valueClass="text-success"
                />
              )}
              <Row
                label="Total"
                value={formatCurrency(totals.total, displayCurrency)}
                className="border-t border-border pt-3 text-base font-bold"
              />
              {totals.tax > 0 && totals.taxInclusive && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Includes {totals.taxLabel.replace(/\s*\(incl\.\)/i, "")} of{" "}
                  {formatCurrency(totals.tax, displayCurrency)}
                </p>
              )}
            </div>

            {user && (
              (() => {
                const missing = [];
                if (!selectedAddressId) missing.push("Add a shipping address");
                if (!paymentMethod) missing.push("Choose a payment method");
                if (items.length === 0) missing.push("Add items to your cart");
                return missing.length > 0 ? (
                  <ul className="mt-4 space-y-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
                    {missing.map((m) => (
                      <li key={m} className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()
            )}
            <Button
              onClick={handlePlaceOrder}
              loading={placing}
              disabled={items.length === 0 || (!!user && (!selectedAddressId || previewLoading))}
              size="lg"
              className="mt-5 w-full"
            >
              {user
                ? `Place order — ${formatCurrency(totals.total, displayCurrency)}`
                : "Sign in to place order"}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              By placing your order you agree to our Terms.
            </p>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-5 w-5 text-accent" />
        <h2 className="font-heading text-lg font-bold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, valueClass, className }) {
  return (
    <div className={cn("flex justify-between", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", valueClass)}>{value}</span>
    </div>
  );
}
