# Onboarding guide — new shop owner (Amar Dokan POS)

Read this in order. Each step ends with a check you can see on screen.

## 1. Create your shop (2 minutes)

1. Open the app and tap **Register**.
2. Enter shop name, category, a username, and a **4+ character PIN**.
   Keep the PIN private — staff get their own PINs in step 4.
3. ✅ Check: you land on the dashboard with your shop name on top.

## 2. Add your first products (5 minutes)

1. Go to **Inventory → Add product**.
2. Enter name, category, unit (pcs/kg), selling price, cost price, and
   opening stock. Cost price is never shown to customers — only you and
   staff with inventory permission see it.
3. ✅ Check: the product appears in the product list with the stock you
   entered. Free plan: up to 20 products, 10 sales/day.

## 3. Make your first sale (2 minutes)

1. Go to **POS**, tap products to add them to the bill.
2. Apply a discount only if you mean it — the bill total is calculated
   by the server, never by the screen you see.
3. Enter cash received; the change is shown automatically.
4. ✅ Check: the sale appears in **Sales**, and the product stock drops
   by exactly what you sold.

## 4. Add staff (optional, 3 minutes)

1. Go to **Staff → Add staff**: name, username, PIN, permissions.
2. Give a cashier only **Process sale**. Give inventory access only to
   someone you trust with stock and cost prices.
3. ✅ Check: the staff member logs in with their own username/PIN and
   sees only what their permissions allow (e.g. no Inventory tab
   without inventory permission).

## 5. Open and close a shift (daily habit)

1. At opening, **Shifts → Open shift** and enter the cash in the drawer.
2. At closing, **Close shift** and enter the cash you counted. The
   difference (expected vs actual) is your Z-report.
3. ✅ Check: the closed shift shows expected cash, actual cash, and any
   difference — never zero it out by hand without noting why.

## 6. Dues, suppliers, and online orders

- **Dues:** a sale with less than full payment leaves a due on the
  customer. Collect it from the Due List.
- **Suppliers:** add a supplier, create a purchase order, and mark
  goods received — stock rises and supplier due rises together.
- **Online:** turn a product's online visibility on to list it in the
  marketplace; confirm orders from **Orders**.

## 7. Backups and safety

- Your data is backed up nightly from the database (see
  `docs/backup-runbook.md`). The in-app JSON export is a handy copy,
  not the backup — do not rely on it alone.
- If you change your PIN, your old sessions on other devices are not
  automatically signed out — sign out on a lost device from that device
  itself, or ask the platform admin to reset access.
- Mobile payments (bKash/Nagad): unless your shop enabled the gateway
  callback flow with its own merchant credentials, the app does NOT
  verify a payment by itself. Always confirm the money in your gateway
  app/SMS before marking an order paid, and keep the transaction ID.

## 8. Getting help

See `docs/support-and-rollback.md`: what to include in a support
message (shop name, time, what you tapped, the exact error text, and
the sale/order ID if there is one) — that is what lets support find
your problem instead of guessing.
