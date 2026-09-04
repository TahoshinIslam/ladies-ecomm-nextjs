"use client";

import Link from "next/link";
import { Construction } from "lucide-react";

import EmptyState from "../components/ui/EmptyState.jsx";
import Button from "../components/ui/Button.jsx";

// Stub pages — these render a "coming soon" placeholder. The real
// implementations are in Phase 2b (checkout, profile, orders, admin).
export function CheckoutPage() {
  return <Stub title="Checkout" desc="Multi-gateway checkout with Stripe, bKash, Nagad & COD is being built in Phase 2b." />;
}
export function ProfilePage() {
  return <Stub title="Profile" desc="Profile & addresses coming in Phase 2b." />;
}
export function OrdersPage() {
  return <Stub title="My Orders" desc="Order history coming in Phase 2b." />;
}
export function OrderDetailPage() {
  return <Stub title="Order Details" desc="Order details & tracking coming in Phase 2b." />;
}
export function AdminDashboardPage() {
  return <Stub title="Admin Dashboard" desc="Analytics + theme switcher + CRUD coming in Phase 2b." />;
}
export function NotFoundPage() {
  return (
    <div className="container-x py-20 text-center">
      <h1 className="font-heading text-6xl font-black text-accent">404</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        This page doesn&apos;t exist.
      </p>
      <Link href="/" className="mt-6 inline-block">
        <Button size="lg">Go home</Button>
      </Link>
    </div>
  );
}

function Stub({ title, desc }) {
  return (
    <div className="container-x py-10">
      <h1 className="mb-6 font-heading text-3xl font-black">{title}</h1>
      <EmptyState
        icon={Construction}
        title="Coming soon"
        message={desc}
        action={
          <Link href="/">
            <Button>Back home</Button>
          </Link>
        }
      />
    </div>
  );
}
