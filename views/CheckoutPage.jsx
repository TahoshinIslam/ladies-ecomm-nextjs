"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  Home,
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
import Breadcrumb from "../components/ui/Breadcrumb.jsx";

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
import { useLocale } from "../context/LocaleProvider.jsx";

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
  // { id: "stripe", labelKey: "...", descKey: "...", icon: CreditCard },
  // { id: "bkash", labelKey: "...", descKey: "...", icon: Smartphone },
  // { id: "nagad", labelKey: "...", descKey: "...", icon: Smartphone },
  { id: "cod", labelKey: "checkout.cashOnDelivery", descKey: "checkout.cashOnDeliveryDesc", icon: Banknote },
];

export default function CheckoutPage() {
  const router = useRouter();
  const user = useSelector(selectCurrentUser);
  const settings = useSettings();
  const { t, locale } = useLocale();

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
            productId: i.productId,
            variantId: i.variantId,
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

  // Local fallback math used only before first preview response arrives —
  // always computed in Taka (this storefront is BDT-only; the shipping
  // address's country defaults to "Bangladesh", so this agrees with the
  // real preview in the overwhelming common case and avoids a flash of a
  // different currency while the debounced preview request is in flight).
  const fallbackTotals = useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      const p = it.product;
      if (!p) continue;
      const usdPrice = p.discountPrice ?? p.basePrice;
      subtotal += settings.toBdt(usdPrice) * it.quantity;
    }
    return {
      subtotal,
      tax: 0,
      taxLabel: "",
      taxInclusive: false,
      shippingCost: 0,
      discount: 0,
      total: subtotal,
      currency: "BDT",
    };
  }, [items, settings]);

  const rawTotals = serverTotals || fallbackTotals;
  // Every totals.* field below is guaranteed Taka from this point on. The
  // real, common path is already BDT (server preview for a Bangladesh
  // address, or the fallback above) — this conversion only ever actually
  // does something on the rare INTL-address server preview (see
  // services/orderService.js's regionFromCountry/toRegionCurrency, a real,
  // separate, USD-denominated order path this task intentionally leaves
  // untouched) so that path still never shows a customer a dollar sign.
  const rate = settings.currency?.usdToBdt || 120;
  const toBdtTotal = (v) => (rawTotals.currency === "USD" ? Math.round(Number(v) * rate) : Number(v));
  const totals = {
    ...rawTotals,
    subtotal: toBdtTotal(rawTotals.subtotal),
    shippingCost: toBdtTotal(rawTotals.shippingCost),
    tax: toBdtTotal(rawTotals.tax),
    discount: toBdtTotal(rawTotals.discount),
    total: toBdtTotal(rawTotals.total),
  };

  // Raw catalog price (USD-denominated, see services/productService.js) to
  // the checkout line-item's Taka amount — the same live exchange-rate
  // conversion settings.formatPrice() applies, exposed as a raw number so
  // line items can be summed before formatting.
  const toCheckoutPrice = (usdPrice) => settings.toBdt(usdPrice);

  const handleNewAddress = async (data) => {
    try {
      const res = await createAddress(data).unwrap();
      setSelectedAddressId(res.address._id);
      setAddingAddress(false);
      reset();
      toast.success(t("checkout.addressAdded"));
    } catch (e) {
      toast.error(e?.data?.message || t("checkout.addressAddFailed"));
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
      toast.success(t("checkout.couponApplied", { amount: formatCurrency(res.discount, locale) }));
    } catch (e) {
      setAppliedCoupon(null);
      toast.error(e?.data?.message || t("checkout.invalidCoupon"));
    }
  };

  const handlePlaceOrder = async () => {
    if (!user) {
      router.push("/login?redirect=/checkout");
      return;
    }
    if (!selectedAddressId) {
      toast.error(t("checkout.selectShippingAddress"));
      return;
    }
    if (items.length === 0) {
      toast.error(t("checkout.cartEmptyError"));
      return;
    }
    const address = addrData.addresses.find((a) => a._id === selectedAddressId);
    if (!address) {
      toast.error(t("checkout.invalidAddress"));
      return;
    }

    try {
      const orderRes = await createOrder({
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
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
      //   router.push(`/orders/${orderId}`);
      //   return;
      // }
      if (paymentMethod === "cod") {
        await codCreate(orderId).unwrap();
        toast.success(t("checkout.orderPlacedCod"));
        downloadReceipt(orderRes.order, locale);
        router.push(`/order-success/${orderId}`);
        return;
      }
    } catch (e) {
      toast.error(e?.data?.message || t("checkout.placeOrderFailed"));
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
      <div className="container-x py-8">
        <Breadcrumb
          items={[
            { label: t("navigation.home"), href: "/", icon: Home },
            { label: t("cart.bag"), href: "/cart", icon: ShoppingBag },
            { label: t("checkout.title"), icon: CreditCard },
          ]}
        />
        <EmptyState
          icon={ShoppingBag}
          title={t("cart.empty")}
          description={t("cart.emptyBody")}
          action={<Button onClick={() => router.push("/shop")}>{t("cart.continueShopping")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="container-x py-8">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("cart.bag"), href: "/cart", icon: ShoppingBag },
          { label: t("checkout.title"), icon: CreditCard },
        ]}
      />
      <h1 className="mb-6 font-heading text-3xl font-black">{t("checkout.title")}</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left: forms */}
        <div className="space-y-6">
          <Section icon={MapPin} title={t("checkout.shippingAddress")}>
            {!user ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm">
                <p className="text-muted-foreground">{t("checkout.signInPrompt")}</p>
                <Button
                  className="mt-3"
                  onClick={() => router.push("/login?redirect=/checkout")}
                >
                  {t("checkout.signInToContinue")}
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
                        {a.isDefault && <Badge variant="default">{t("checkout.default")}</Badge>}
                        <Badge variant="outline" className="capitalize">{a.label}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{a.street}, {a.city}, {a.postalCode}, {a.country}</p>
                      <p className="text-muted-foreground">{a.phone}</p>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("checkout.noSavedAddresses")}</p>
            )}

            {!user ? null : !addingAddress ? (
              <Button variant="outline" onClick={() => setAddingAddress(true)} className="mt-3">
                {t("checkout.addNewAddressBtn")}
              </Button>
            ) : (
              <form onSubmit={handleSubmit(handleNewAddress)} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label={t("checkout.fullName")} {...register("fullName")} error={errors.fullName?.message} />
                <Input label={t("checkout.phone")} {...register("phone")} error={errors.phone?.message} />
                <Input label={t("checkout.street")} className="md:col-span-2" {...register("street")} error={errors.street?.message} />
                <Input label={t("checkout.city")} {...register("city")} error={errors.city?.message} />
                <Input label={t("checkout.state")} {...register("state")} />
                <Input label={t("checkout.postalCode")} {...register("postalCode")} error={errors.postalCode?.message} />
                <Input label={t("checkout.country")} {...register("country")} error={errors.country?.message} />
                <div className="md:col-span-2 flex gap-2">
                  <Button type="submit">{t("common.save")}</Button>
                  <Button variant="outline" type="button" onClick={() => { setAddingAddress(false); reset(); }}>
                    {t("checkout.cancel")}
                  </Button>
                </div>
              </form>
            )}
          </Section>

          <Section icon={CreditCard} title={t("checkout.paymentMethodSection")}>
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
                      <p className="font-semibold">{t(m.labelKey)}</p>
                      <p className="text-xs text-muted-foreground">{t(m.descKey)}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            {(settings.store?.supportEmail || settings.store?.supportPhone) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("checkout.questionsBeforeOrder")}{" "}
                {settings.store.supportPhone && (
                  <a href={`tel:${settings.store.supportPhone}`} className="font-medium text-foreground hover:underline">
                    {settings.store.supportPhone}
                  </a>
                )}
                {settings.store.supportPhone && settings.store.supportEmail && ` ${t("checkout.or")} `}
                {settings.store.supportEmail && (
                  <a href={`mailto:${settings.store.supportEmail}`} className="font-medium text-foreground hover:underline">
                    {settings.store.supportEmail}
                  </a>
                )}
                .
              </p>
            )}
          </Section>

          <Section icon={Tag} title={t("checkout.promoCode")}>
            <div className="flex gap-2">
              <Input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder={t("checkout.enterCode")}
              />
              <Button onClick={handleApplyCoupon} disabled={!couponCode.trim()}>
                {t("checkout.apply")}
              </Button>
            </div>
            {appliedCoupon && (
              <div className="mt-3 flex items-center gap-2 text-sm text-success">
                <Check className="h-4 w-4" />
                <span>{t("checkout.couponAppliedLabel")} <strong>{appliedCoupon.coupon.code}</strong></span>
              </div>
            )}
          </Section>

          <Section icon={ShoppingBag} title={t("checkout.orderNotes")}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("checkout.orderNotesPlaceholder")}
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
            <h2 className="mb-4 font-heading text-xl font-bold">{t("checkout.orderSummaryTitle")}</h2>

            <ul className="divide-y divide-border">
              {items.map((it) => {
                const p = it.product;
                if (!p) return null;
                const usdPrice = p.discountPrice ?? p.basePrice;
                const lineTotal = toCheckoutPrice(usdPrice) * it.quantity;
                const variantLine = [it.variant?.color, it.variant?.size, it.variant?.fabric]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={`${p._id}-${it.variantId}`} className="py-3">
                    <div className="flex gap-3">
                      {/* Hatched plate stands in until artwork exists, matching
                          how ProductCard/CartDrawer render a missing image —
                          a raw <img> here would 404 against a placeholder
                          file that doesn't exist. */}
                      <div className="relative h-14 w-14 flex-none overflow-hidden rounded-md bg-media">
                        <div aria-hidden="true" className="absolute inset-0 hatch" />
                        {(it.variant?.image || p.images?.[0]) && (
                          <img
                            src={resolveImage(it.variant?.image || p.images[0], 112)}
                            alt={p.name}
                            loading="lazy"
                            decoding="async"
                            className="relative h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {variantLine ? `${variantLine} · ` : ""}{t("checkout.qty")} {it.quantity}
                        </p>
                      </div>
                      <p className="text-sm font-bold">
                        {/* In checkout currency — matches subtotal/total below */}
                        {formatCurrency(lineTotal, locale)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
              <Row
                label={t("checkout.subtotal")}
                value={formatCurrency(totals.subtotal, locale)}
              />
              <Row
                label={previewLoading ? t("checkout.shippingLoading") : t("checkout.shippingLabel")}
                value={
                  totals.shippingCost === 0 ? (
                    <span className="text-success font-semibold">{t("checkout.free")}</span>
                  ) : (
                    formatCurrency(totals.shippingCost, locale)
                  )
                }
              />
              {totals.tax > 0 && !totals.taxInclusive && (
                <Row
                  label={totals.taxLabel || t("checkout.tax")}
                  value={formatCurrency(totals.tax, locale)}
                />
              )}
              {totals.discount > 0 && (
                <Row
                  label={t("checkout.discount")}
                  value={`-${formatCurrency(totals.discount, locale)}`}
                  valueClass="text-success"
                />
              )}
              <Row
                label={t("checkout.total")}
                value={formatCurrency(totals.total, locale)}
                className="border-t border-border pt-3 text-base font-bold"
              />
              {totals.tax > 0 && totals.taxInclusive && (
                <p className="pt-1 text-xs text-muted-foreground">
                  {t("checkout.includesTaxOf", { tax: totals.taxLabel.replace(/\s*\(incl\.\)/i, "") })}{" "}
                  {formatCurrency(totals.tax, locale)}
                </p>
              )}
            </div>

            {user && (
              (() => {
                const missing = [];
                if (!selectedAddressId) missing.push(t("checkout.addShippingAddressWarning"));
                if (!paymentMethod) missing.push(t("checkout.choosePaymentMethodWarning"));
                if (items.length === 0) missing.push(t("checkout.addItemsWarning"));
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
                ? t("checkout.placeOrderWithTotal", { total: formatCurrency(totals.total, locale) })
                : t("checkout.signInToOrder")}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t("checkout.agreeTermsNotice")}
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
