"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Home, User as UserIcon, MapPin, Lock, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";

import Input from "../components/ui/Input.jsx";
import Select from "../components/ui/Select.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Modal from "../components/ui/Modal.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";

import { useUpdateMeMutation } from "../store/userApi.js";
import { setCredentials, selectCurrentUser } from "../store/authSlice.js";
import {
  useGetMyAddressesQuery,
  useCreateAddressMutation,
  useUpdateAddressMutation,
  useDeleteAddressMutation,
} from "../store/shopApi.js";
import { useLocale } from "../context/LocaleProvider.jsx";
// Shared boundary values/enums (not the full server schemas — these forms
// keep their own plain-English messages) so this client form can never
// drift out of sync with what services/userService.js's updateMe() and
// createAddress()/updateAddress() actually enforce server-side. No
// Mongoose/server-only code is pulled in by importing from schemas/*.js —
// see tests/clientSchemaImportability.test.mjs.
import { PASSWORD_MIN_LENGTH } from "../schemas/authSchemas.js";
import { ADDRESS_LABELS } from "../schemas/addressSchemas.js";

/**
 * Shared by all 3 account sub-pages below: the actual left-hand navigation
 * between them now lives in components/account/AccountSidebar.jsx (mounted
 * once by app/(routes)/(account)/layout.jsx), so each page here only needs
 * its own breadcrumb + heading + a sign-in gate for the (rare) case someone
 * lands on one of these URLs directly without a session.
 */
function AccountSection({ crumbLabel, crumbIcon, title, subtitle, children }) {
  const user = useSelector(selectCurrentUser);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <div>
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.account"), href: "/dashboard" },
          { label: crumbLabel, icon: crumbIcon },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

      {!user ? (
        <div className="mt-8 max-w-xl rounded-lg border border-dashed border-border p-6 text-sm">
          <p className="text-muted-foreground">{t("account.signInPrompt")}</p>
          <Button
            className="mt-3"
            onClick={() => router.push(`/login?redirect=${encodeURIComponent(pathname)}`)}
          >
            {t("account.signInCta")}
          </Button>
        </div>
      ) : (
        <div className="mt-8 max-w-xl">{children}</div>
      )}
    </div>
  );
}

// =========== PROFILE INFO (/profile) ===========
const infoSchema = z.object({
  name: z.string().min(2, "Required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional(),
});

export default function ProfilePage() {
  const { t } = useLocale();
  return (
    <AccountSection
      crumbLabel={t("account.navProfile")}
      crumbIcon={UserIcon}
      title={t("account.navProfile")}
      subtitle={t("account.subtitle")}
    >
      <InfoTab />
    </AccountSection>
  );
}

function InfoTab() {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const [updateMe, { isLoading }] = useUpdateMeMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(infoSchema),
    defaultValues: {
      name: user?.name || "",
      email: user?.email || "",
      phone: user?.phone || "",
    },
  });

  const onSubmit = async (data) => {
    try {
      const res = await updateMe(data).unwrap();
      dispatch(setCredentials(res.user));
      toast.warning("Profile updated");
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border bg-background p-6"
    >
      <Input label="Name" error={errors.name?.message} {...register("name")} />
      <Input
        label="Email"
        type="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Input label="Phone" error={errors.phone?.message} {...register("phone")} />
      <Button type="submit" loading={isLoading}>
        Save changes
      </Button>
    </form>
  );
}

// =========== PASSWORD (/profile/password) ===========
const pwdSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    // PASSWORD_MIN_LENGTH matches schemas/authSchemas.js's passwordSchema
    // exactly — previously this required only 6, while the server's
    // updateMeSchema always required 8, so a password that passed this
    // client-side check could still be rejected by the server.
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export function ProfilePasswordPage() {
  const { t } = useLocale();
  return (
    <AccountSection
      crumbLabel={t("account.navPassword")}
      crumbIcon={Lock}
      title={t("account.navPassword")}
      subtitle={t("account.subtitle")}
    >
      <PasswordTab />
    </AccountSection>
  );
}

function PasswordTab() {
  const [updateMe, { isLoading }] = useUpdateMeMutation();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(pwdSchema) });

  const onSubmit = async ({ confirmPassword, ...data }) => {
    try {
      await updateMe(data).unwrap();
      toast.warning("Password updated");
      reset();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update password");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-border bg-background p-6"
    >
      <Input
        label="Current password"
        type="password"
        error={errors.currentPassword?.message}
        {...register("currentPassword")}
      />
      <Input
        label="New password"
        type="password"
        error={errors.newPassword?.message}
        {...register("newPassword")}
      />
      <Input
        label="Confirm new password"
        type="password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" loading={isLoading}>
        Update password
      </Button>
    </form>
  );
}

// =========== ADDRESSES (/profile/addresses) ===========
const addrSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(6),
  street: z.string().min(3),
  city: z.string().min(2),
  state: z.string().optional(),
  postalCode: z.string().min(2),
  country: z.string().min(2),
  label: z.enum(ADDRESS_LABELS).default("home"),
  isDefault: z.boolean().optional(),
});

export function ProfileAddressesPage() {
  const { t } = useLocale();
  return (
    <AccountSection
      crumbLabel={t("account.navAddresses")}
      crumbIcon={MapPin}
      title={t("account.navAddresses")}
      subtitle={t("account.subtitle")}
    >
      <AddressesTab />
    </AccountSection>
  );
}

function AddressesTab() {
  const { data, isLoading } = useGetMyAddressesQuery();
  const [createAddress, { isLoading: creating }] = useCreateAddressMutation();
  const [updateAddress, { isLoading: updating }] = useUpdateAddressMutation();
  const [deleteAddress, { isLoading: deleting }] = useDeleteAddressMutation();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(addrSchema) });

  const openNew = () => {
    setEditing(null);
    reset({ country: "Bangladesh", label: "home", isDefault: false });
    setModalOpen(true);
  };

  const openEdit = (address) => {
    setEditing(address);
    reset(address);
    setModalOpen(true);
  };

  const onSubmit = async (formData) => {
    try {
      if (editing) {
        await updateAddress({ id: editing._id, ...formData }).unwrap();
        toast.warning("Address updated");
      } else {
        await createAddress(formData).unwrap();
        toast.success("Address added");
      }
      setModalOpen(false);
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAddress(confirmDelete._id).unwrap();
      toast.success("Address deleted");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const addresses = data?.addresses ?? [];

  return (
    <>
      <div className="rounded-lg border border-border bg-background p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">Saved addresses</h2>
          <Button onClick={openNew}>+ Add address</Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : addresses.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No addresses yet"
            message="Add a shipping address to speed up checkout."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {addresses.map((a) => (
              <li
                key={a._id}
                className="rounded-md border border-border bg-muted/20 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold flex items-center gap-2">
                      {a.fullName}
                      {a.isDefault && <Badge variant="accent">Default</Badge>}
                      <Badge variant="outline" className="capitalize">{a.label}</Badge>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {a.street}, {a.city}
                      {a.state && `, ${a.state}`} {a.postalCode}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.country} · {a.phone}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => openEdit(a)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(a)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit address" : "Add address"}
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Full name" error={errors.fullName?.message} {...register("fullName")} />
            <Input label="Phone" error={errors.phone?.message} {...register("phone")} />
          </div>
          <Input label="Street" error={errors.street?.message} {...register("street")} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="City" error={errors.city?.message} {...register("city")} />
            <Input label="State" {...register("state")} />
            <Input label="Postal code" error={errors.postalCode?.message} {...register("postalCode")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Country" error={errors.country?.message} {...register("country")} />
            <Select label="Label" {...register("label")}>
              <option value="home">Home</option>
              <option value="work">Work</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-accent" {...register("isDefault")} />
            Make this my default address
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creating || updating}>
              {editing ? "Update" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete this address?"
        description={confirmDelete ? `${confirmDelete.street}, ${confirmDelete.city}` : ""}
        loading={deleting}
      />
    </>
  );
}
