import { formatCurrency, storage, formatVariantAttributes } from "./utils.js";
import { formatDhakaDateTime } from "./date.js";

// Read the live theme accent from the current document so the printable
// receipt picks up the active accent color. Falls back to a sensible blue
// if the variable hasn't been set yet.
const getAccentRgb = () => {
  if (typeof window === "undefined") return "37 99 235";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
  return v || "37 99 235";
};

// Read the cached public store settings — the receipt window can't use
// React context, so we sniff localStorage where SettingsContext caches them.
const getStoreInfo = () => {
  try {
    const raw = storage.get("ss:settings");
    const parsed = raw ? JSON.parse(raw) : null;
    const store = parsed?.store || {};
    return {
      name: store.name || "Store",
      logoUrl: store.logoUrl || "",
      supportEmail: store.supportEmail || "",
      supportPhone: store.supportPhone || "",
    };
  } catch {
    return { name: "Store", logoUrl: "", supportEmail: "", supportPhone: "" };
  }
};

// Build a self-contained HTML receipt as a string.
//
// The invoice template itself (labels like "Invoice To", "Sub Total") stays
// English — this is a plain JS module with no access to the app's t()/React
// context, and localizing a printable-invoice template is a separate,
// larger undertaking than this pass covers (see the localization report).
// `locale` only drives number formatting: every order monetary field here
// (order.total/subtotal/shippingCost/tax/discount, and each line's
// snapshot.price) is already Taka by the time it reaches an Order document
// — see services/orderService.js's toRegionCurrency — so no conversion
// happens here, only Bangla-vs-English digit formatting.
function buildReceiptHtml(order, { autoPrint = false, locale = "en-BD" } = {}) {
  const accent = getAccentRgb();
  const store = getStoreInfo();

  const itemRows = (order.items || [])
    .map((it, idx) => {
      const snap = it.snapshot || {};
      const meta = formatVariantAttributes(snap.attributes, locale);
      return `
        <tr>
          <td class="sl"><span class="pill">${String(idx + 1).padStart(2, "0")}</span></td>
          <td class="desc">
            <div class="name">${escapeHtml(snap.name)}</div>
            <div class="meta">${escapeHtml(meta)}${snap.sku ? ` · SKU ${escapeHtml(snap.sku)}` : ""}</div>
          </td>
          <td class="price"><span class="pill">${formatCurrency(snap.price, locale)}</span></td>
          <td class="qty"><span class="pill">${String(it.quantity).padStart(2, "0")}</span></td>
          <td class="total"><span class="pill">${formatCurrency((snap.price || 0) * it.quantity, locale)}</span></td>
        </tr>`;
    })
    .join("");

  const addr = order.shippingAddress || {};
  const orderNum = String(order._id || "").slice(-8).toUpperCase();
  const isCod =
    order.paymentMethod === "cod" ||
    (!order.paymentMethod && order.status !== "paid");
  const paymentLabel = isCod
    ? "Cash on Delivery"
    : (order.paymentMethod || "").toUpperCase() || "—";

  const logoMarkup = store.logoUrl
    ? `<img src="${escapeHtml(store.logoUrl)}" alt="" class="logo" />`
    : `<div class="logo-fallback">${escapeHtml(store.name.charAt(0))}</div>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice #${orderNum}</title>
<style>
  :root { --accent: rgb(${accent}); --accent-soft: rgb(${accent} / 0.10); --accent-line: rgb(${accent} / 0.25); }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 0; background: #fff; }
  .page { max-width: 820px; margin: 0 auto; padding: 36px 44px 0; }

  /* ===== Header band ===== */
  .header { position: relative; display: grid; grid-template-columns: 1fr 1fr; align-items: stretch; min-height: 140px; }
  .header-left { background: #111; color: #fff; border-top-left-radius: 6px; border-bottom-right-radius: 60px; padding: 24px 28px; display: flex; align-items: center; gap: 14px; }
  .logo { width: 44px; height: 44px; object-fit: contain; background: #fff; padding: 6px; border-radius: 8px; }
  .logo-fallback { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #fff; font-weight: 800; border-radius: 8px; font-size: 20px; }
  .store-name { font-size: 18px; font-weight: 800; letter-spacing: 0.02em; }
  .store-slogan { font-size: 11px; opacity: 0.7; margin-top: 2px; }
  .header-right { background: var(--accent); color: #fff; padding: 24px 32px; border-top-right-radius: 6px; border-bottom-left-radius: 60px; text-align: right; }
  .invoice-title { font-size: 34px; font-weight: 900; letter-spacing: 0.08em; -webkit-text-stroke: 1.5px #fff; color: transparent; }
  .invoice-meta { margin-top: 10px; font-size: 12px; line-height: 1.6; }
  .invoice-meta strong { display: inline-block; min-width: 86px; font-weight: 600; }

  /* ===== To / Terms ===== */
  .twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin: 28px 0 20px; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #111; }
  .to-name { color: var(--accent); font-size: 18px; font-weight: 800; margin-top: 6px; }
  .to-role { color: #777; font-size: 11px; margin-top: 2px; }
  .to-line { font-size: 12px; margin-top: 6px; color: #333; }
  .to-line .k { color: var(--accent); display: inline-block; min-width: 50px; }
  .terms { font-size: 12px; line-height: 1.6; color: #444; }
  .terms .label { color: var(--accent); margin-bottom: 4px; display: block; }

  /* ===== Items table ===== */
  table.items { width: 100%; border-collapse: separate; border-spacing: 0 6px; margin-top: 6px; }
  .items thead th { background: #111; color: #fff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 12px 14px; text-align: left; }
  .items thead th:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; width: 60px; text-align: center; }
  .items thead th.center { text-align: center; }
  .items thead th:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; text-align: center; }
  .items tbody td { font-size: 13px; padding: 6px 14px; vertical-align: middle; background: #f5f5f5; }
  .items tbody tr td:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; text-align: center; }
  .items tbody tr td:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; text-align: center; }
  .items td.desc .name { font-weight: 600; }
  .items td.desc .meta { font-size: 11px; color: #777; margin-top: 1px; }
  .items td.price, .items td.qty, .items td.total { text-align: center; }
  .pill { display: inline-block; min-width: 72px; padding: 6px 10px; background: var(--accent-soft); border-radius: 4px; font-weight: 600; font-size: 12px; }
  .items td.sl .pill { background: var(--accent-soft); min-width: 36px; }
  .items td.qty .pill { background: #fff; min-width: 36px; }

  /* ===== Bottom: payment / totals ===== */
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 26px; }
  .payinfo .label { display: block; margin-bottom: 6px; }
  .payinfo .row { font-size: 12px; margin-top: 4px; }
  .payinfo .row .k { color: var(--accent); display: inline-block; min-width: 100px; }
  .totals { font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row .k { color: var(--accent); }
  .totals .row.grand { background: var(--accent-soft); padding: 10px 12px; font-weight: 800; font-size: 14px; margin-top: 6px; border-radius: 4px; }
  .totals .row.grand .k { color: #111; }

  /* ===== Footer ===== */
  .signature { margin-top: 32px; display: inline-block; }
  .signature .line { border-top: 1.5px solid #111; width: 220px; margin-top: 36px; }
  .signature .label { color: var(--accent); margin-top: 6px; font-size: 12px; }
  .signature .sub { font-size: 11px; color: #777; }

  .footer-band { margin-top: 40px; position: relative; height: 60px; }
  .footer-band::before { content: ""; position: absolute; inset: 0 0 0 0; background: var(--accent); border-top-left-radius: 60px; }
  .footer-band::after { content: ""; position: absolute; left: 30%; top: -6px; bottom: 0; width: 90px; background: #111; border-top-left-radius: 40px; border-bottom-right-radius: 6px; }
  .footer-contact { position: relative; z-index: 1; color: #fff; padding: 18px 32px; text-align: right; font-size: 11px; line-height: 1.6; }

  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.35); color: #fff; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }

  /* ===== Print ===== */
  @media print {
    body { padding: 0; }
    .page { padding: 18px 26px 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header band -->
  <div class="header">
    <div class="header-left">
      ${logoMarkup}
      <div>
        <div class="store-name">${escapeHtml(store.name)}</div>
        ${order.status ? `<div class="store-slogan"><span class="badge">${escapeHtml(order.status)}</span></div>` : ""}
      </div>
    </div>
    <div class="header-right">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-meta">
        <div><strong>Invoice No</strong> : ${orderNum}</div>
        <div><strong>Invoice Date</strong> : ${escapeHtml(formatDhakaDateTime(order.createdAt || Date.now(), locale))}</div>
        <div><strong>Total Due</strong> : ${formatCurrency(order.total || 0, locale)}</div>
      </div>
    </div>
  </div>

  <!-- Invoice to / terms -->
  <div class="twocol">
    <div>
      <div class="label">Invoice To:</div>
      <div class="to-name">${escapeHtml(addr.fullName || "Customer")}</div>
      <div class="to-role">Shipping address</div>
      <div class="to-line"><span class="k">Phone</span>: ${escapeHtml(addr.phone || "—")}</div>
      <div class="to-line"><span class="k">Address</span>: ${escapeHtml(addr.street || "")}, ${escapeHtml(addr.city || "")}${addr.state ? ", " + escapeHtml(addr.state) : ""} ${escapeHtml(addr.postalCode || "")}, ${escapeHtml(addr.country || "")}</div>
    </div>
    <div class="terms">
      <span class="label">Terms &amp; conditions:</span>
      ${isCod
        ? "Payment is collected in cash upon delivery. Please have the exact amount ready. Goods once delivered are subject to our standard return policy."
        : "Payment confirmed. Goods are subject to our standard return policy. Please retain this invoice for your records."}
    </div>
  </div>

  <!-- Items table -->
  <table class="items">
    <thead>
      <tr>
        <th>SL.</th>
        <th>Item Description</th>
        <th class="center">Price</th>
        <th class="center">Qty.</th>
        <th class="center">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Payment info + totals -->
  <div class="bottom">
    <div class="payinfo">
      <span class="label">Payment Info</span>
      <div class="row"><span class="k">Method</span>: ${escapeHtml(paymentLabel)}</div>
      <div class="row"><span class="k">Order ID</span>: #${orderNum}</div>
      ${store.supportEmail ? `<div class="row"><span class="k">Support</span>: ${escapeHtml(store.supportEmail)}</div>` : ""}
      ${store.supportPhone ? `<div class="row"><span class="k">Phone</span>: ${escapeHtml(store.supportPhone)}</div>` : ""}
    </div>
    <div class="totals">
      <div class="row"><span class="k">Sub Total</span><span>${formatCurrency(order.subtotal || 0, locale)}</span></div>
      <div class="row"><span class="k">Shipping</span><span>${(order.shippingCost || 0) === 0 ? "Free" : formatCurrency(order.shippingCost, locale)}</span></div>
      ${order.tax > 0 ? `<div class="row"><span class="k">${escapeHtml(order.taxLabel || "Tax")}</span><span>${formatCurrency(order.tax, locale)}</span></div>` : ""}
      ${order.discount > 0 ? `<div class="row"><span class="k">Discount</span><span>-${formatCurrency(order.discount, locale)}</span></div>` : ""}
      <div class="row grand"><span class="k">Total</span><span>${formatCurrency(order.total || 0, locale)}</span></div>
    </div>
  </div>

  <!-- Signature -->
  <div class="signature">
    <div class="line"></div>
    <div class="label">${escapeHtml(store.name)}</div>
    <div class="sub">Authorized signatory</div>
  </div>

  <!-- Footer band -->
  <div class="footer-band">
    <div class="footer-contact">
      ${store.supportEmail ? escapeHtml(store.supportEmail) + " · " : ""}${store.supportPhone ? escapeHtml(store.supportPhone) : ""}
    </div>
  </div>

  ${autoPrint ? `<!-- Print button (hidden on print) -->
  <div class="no-print" style="margin: 24px 0 32px; text-align:center">
    <button onclick="window.print()" style="padding:10px 22px; font-size:14px; cursor:pointer; border-radius:6px; border:1px solid #111; background:#111; color:#fff; font-weight:600;">Save as PDF / Print</button>
  </div>` : ""}
</div>

<script>
  ${autoPrint ? "window.addEventListener('load', () => { setTimeout(() => { window.focus(); window.print(); }, 200); });" : ""}
</script>
</body>
</html>`;

  return { html, orderNum };
}

// Customer-facing: trigger a real file download of the receipt HTML.
// Avoids opening a new tab — iOS Safari can't reliably render Blob URLs
// in new tabs (WebKitBlobResource error 1), so we download instead.
export function downloadReceipt(order, locale) {
  if (!order) return;
  const { html, orderNum } = buildReceiptHtml(order, { autoPrint: false, locale });
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${orderNum}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

// Admin: open the receipt in a new window and trigger the print dialog.
// From there the admin can print or "Save as PDF".
export function printReceipt(order, locale) {
  if (!order) return;
  const { html } = buildReceiptHtml(order, { autoPrint: true, locale });
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=820,height=1000");
  if (!win) {
    URL.revokeObjectURL(url);
    window.location.href = url;
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
