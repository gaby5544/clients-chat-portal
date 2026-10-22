# v3.10 — real account details, own-currency view, greeting, actions, Support

Built on v3.9. Nothing was removed; existing lines changed only to add a fallback (the mail reply-to) and to extend an export list.

## Your questions
- **Why no account number for EUR?** A euro (SEPA) account is identified by its IBAN, which already contains the account number. EUR sellers see IBAN + SWIFT/BIC. USD sellers see account number + ABA routing. GBP sellers see sort code + account number (+ IBAN if you enter one).
- **Are details regenerated, or permanent?** Nothing is generated any more. Every number comes from the Desk and stays until the Desk changes it.
- **Can I change them from the admin dashboard?** Yes, in two places:
  1. **Controls -> Receiving accounts**: your real USD, EUR and GBP account (for example HSBC USA, HSBC UK and your euro account). Verified sellers registered in that currency see it, with their own Account ID as the payment reference so you can match each payment to the right seller.
  2. **Seller profile -> Receiving account**: type one seller's own account details if your bank issues one account per customer. "Use the global account" reverts.

## What I did NOT do, and why
I did not generate account numbers under HSBC's (or any real bank's) name and SWIFT code. The bank never issued such numbers, so a payer's transfer would bounce or reach the wrong account, and the seller would believe they have an account that does not exist. Real details have to come from the bank (a collection account, or per-customer virtual accounts from your bank or a provider that issues them). Every field the Desk types is checked with real banking rules: IBAN check digits and country length, ABA routing check digit, UK 6-digit sort code and 8-digit account, SWIFT format.
Until a currency is set, verified sellers see "Your account details are being prepared". For demos only, set `ALLOW_SAMPLE_BANK_DETAILS=true` and a clearly labelled sample appears.

## Your list
1. **Own currency only**: a USD seller sees only USD, a EUR seller only EUR, a GBP seller only GBP. No tabs, no other currencies sent to the browser.
2. **Realistic details**: the Desk enters real bank name, real street address, real SWIFT and routing / sort code. No placeholder "000" codes are shown to sellers.
3. **Warning notes removed** from the account card. The palette button is removed from the top bar (the style picker stays on the Profile page).
4. **Greeting** at the top of the dashboard by the seller's own clock: "Good morning, Jane" (05:00-11:59), "Good afternoon" (12:00-16:59), "Good evening" (otherwise). Translated for French, Spanish, Portuguese, German and Italian sellers.
5. **Send, Receive, Withdraw, Support** buttons at the top of the dashboard. Receive opens the account details, Withdraw opens withdrawals, Send opens the existing deposit flow (the way a seller sends funds to the Desk), Support opens the popup.
6. **Support**: headset button (top bar, dashboard, Help page). The popup asks for name, email, topic and message; it validates, sends to your Support inbox (`SUPPORT_EMAIL`, with reply-to set to the seller so you answer directly), sends the seller an acknowledgement with a reference (SR-XXXXXXXX), stores it, and shows it live in **Controls -> Support requests** with a resolve switch. Limited to 5 requests per hour per seller.
7. **HSBC**: enter your real HSBC USA and HSBC UK account details in Controls -> Receiving accounts and the system displays them correctly for USD and GBP sellers. I do not have, and cannot invent, your real account numbers.

## Tests
Server 46/46 (`test/v38.js`), browser 54/54 (`test/ui_v38.py`), plus scenario 99, recovery 23, email 10, mailer 25, translate 10, Postgres and PDF checks. Greetings were verified at 08:15, 11:59, 12:00, 14:05 and 19:40. Not tested against a real mail provider or on physical phones.
