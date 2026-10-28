# 5-minute setup test — for a non-technical shop owner

Status: SCRIPT + PASS CRITERIA ready. The live run with a real
non-technical user is an OWNER STEP (no such user exists in this
sandbox) — run it verbatim, tick the boxes, and record the time.

## Setup (tester prepares, 1 minute)

- A phone with the app installed (or the web app open).
- A fresh demo shop account (do not use a real shop's data).
- A stopwatch.

## Script (read each line aloud, then wait)

1. "Register a new shop with any name and a PIN you choose."
   ⏱ Target: under 60 seconds.
2. "Add one product: name 'Test Rice', price 100, cost 80, stock 10."
   ⏱ Target: under 60 seconds.
3. "Sell 2 of them for cash, customer pays 250."
   ⏱ Target: under 60 seconds, change shown must be 50.
4. "Show me the sale and the new stock."
   ⏱ Target: under 30 seconds.
5. "Close the day: open a shift with 500, then close it counting 700."
   ⏱ Target: under 60 seconds.

Total target: **under 5 minutes** including reading the lines.

## Pass criteria (ALL must hold)

- [ ] Every step completed without the tester explaining a button.
- [ ] Sale total is exactly 200, change exactly 50.
- [ ] Stock after the sale is exactly 8 (10 − 2), not 9, not 7.
- [ ] The shift close shows expected cash 700 (500 opening + 200 cash
      sale) and discrepancy 0.
- [ ] The user can say, in their own words, where to find tomorrow's
      sales and today's dues.

## If anything fails

Write down: the step number, what the screen showed (photo if
possible), and the exact words on any error. Send that note with the
support message format in `docs/support-and-rollback.md`. Do NOT
retry the same failed step more than twice — a repeated failure is a
finding, not a user error.
