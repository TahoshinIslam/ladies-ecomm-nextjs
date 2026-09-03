/**
 * Lightweight footer for the admin shell. A server component (no state, no
 * browser APIs) — nothing here needs "use client". Lives inside the same
 * flex column as the topbar/main content, never under the sidebar, and
 * sits at the bottom of short pages via the shell's flex-col + main:flex-1
 * layout rather than any position:absolute/fixed trick.
 */
export default function AdminFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="flex-none border-t border-border px-4 py-4 sm:px-6">
      <div className="flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
        <p>© {year} TAHOS. Admin</p>
        <p>Kinetic Editorial</p>
      </div>
    </footer>
  );
}
