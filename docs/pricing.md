# How an order is priced

One function prices every order: `calcTotals()` in `services/orderService.js`.
The coupon box (`POST /api/coupons/validate` with the cart's items), the order
summary (`POST /api/orders/preview`) and the order itself (`POST /api/orders`)
all call it, so the figure a shopper is shown is the figure they are charged.
All amounts are whole taka; each step is rounded before it is added.

## Steps

0. **Which stock fills the line** — stock is held in receipt *batches*, each
   with its own selling price (see `ecom_erp/docs/inventory-foundation.md`).
   `planOrder()` (`models/inventoryModel.js`) lays each line's quantity over the
   batches at the store that supplies the website, oldest received first
   (earliest expiry first for dated goods, never an expired lot), under lock
   at checkout. A line whose units sell at more than one price becomes one
   order line per price — "50 × ৳500 and 10 × ৳550", never an average.
1. **Goods subtotal** — each line's charge price × quantity, summed. The
   charge price is the variant's (or product's) discount price if set (one
   price for every batch), otherwise the **batch's own selling price**
   (rounded to whole taka, as every price here is). A product still priced in
   USD keeps its single converted price.
2. **Coupon** (optional):
   - it must be active, unexpired, under its usage limits, and the goods
     subtotal must reach its minimum order amount (measured on the whole
     cart's goods, before any discount);
   - **eligible lines**: a coupon with no categories covers every line. A
     coupon limited to categories covers lines whose product is in one of
     those categories *or any category below it* (the dashboard lets a
     coupon name a parent such as "Women");
   - a coupon that covers no line in the cart is refused, not applied as 0;
   - **discount** = percentage of the eligible lines, or the flat amount;
     then capped by the coupon's maximum discount; then capped at the
     eligible lines' total. A coupon reduces the price of goods only — it can
     never reduce shipping or tax.
3. **Tax** — from the store's tax rule for the delivery zone (BD or INTL),
   applied to the goods **after** the discount (what the goods actually sell
   for). Shipping is not in the tax base.
   - *Inclusive* rule (prices include VAT): the tax figure is the VAT
     contained in the discounted goods amount; nothing is added to the total.
   - *Exclusive* rule: the tax is added on top.
   - The rate itself is store configuration (Settings → tax rules); nothing
     here assumes a particular rate is legally required.
4. **Shipping** — the chosen tier's cost for the zone, or 0 when the goods
   subtotal **before the coupon** is at or above the tier's free-shipping
   threshold (`freeAbove`). The first-order free-shipping promotion, when
   switched on, also sets it to 0.
5. **Total** = goods after discount + exclusive tax + shipping.

## Policies recorded here, not chosen here

- **Free-shipping threshold** is measured on the goods subtotal before the
  coupon (existing behaviour, kept). A store that wants "after discount"
  must decide that; it is a commercial choice.
- **Minimum order amount** for a coupon is measured on the whole cart's goods
  before discount, not only the eligible lines (existing behaviour, kept).
- **Coupon usage after cancellation and refunds**: cancelling an order gives
  the coupon use back (global and per shopper). Marking an order refunded
  does not. There is no partial refund in either app. No written business
  policy exists for refunds — this is the current behaviour, awaiting a
  decision, not a rule someone chose.

## Changed in this revision (and why)

Before: category limits on coupons were stored but ignored (a category
coupon discounted the whole cart); a flat coupon could exceed the goods and
eat into shipping and tax (the order total was only floored at 0); tax was
computed on the pre-discount subtotal, so every discounted order recorded
more VAT than its goods carried. Historical orders keep the figures they
were saved with.

## Quotes: what the shopper is shown is what checkout can charge

`POST /api/orders/preview` returns, besides every figure, the goods line by line at
the prices checkout would charge (`lines`) and a `quote` token (a hash of items,
quantities, prices and the total — no batch, lot or cost ever leaves the server).
The bag (`POST /api/cart/check`) shows the same breakdown per item.

`POST /api/orders` takes that token. Checkout prices again **inside the order's
transaction with the batch rows locked**; if the result differs — a price moved,
a batch ran out, another store was chosen — nothing is created and the response
is `409` with `errors: { code: "QUOTE_CHANGED", preview }`, the new quote for the
shopper to review. An order with no token is priced at the server's current
price (the token is the shopper's protection). An accepted order keeps the price
it was agreed at, whatever later happens to its batch (`order_items.snapshot_price`
and the reservation's allocations); the batches it holds are reserved exactly as
priced (`stock_batch_allocations`), released batch by batch on cancel.
