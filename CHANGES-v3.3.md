# v3.3 — second fix list (10 points)

**Your two live links are protected.** `group-1791374307913` (Buyer and Seller) is on a built-in "preserved" list: if the database ever loses it (e.g. a redeploy without Postgres) it is re-created on first open. A link dies **only** when an admin deletes its group (then it is tombstoned and never re-created) or deletes that buyer/seller. Add more ids with `PRESERVED_GROUP_IDS=id1,id2`. Real persistence still needs `DATABASE_URL` (see DEPLOY.md).

| # | Change |
|---|---|
| 1 | After a seller registers, the only next step is **identity verification (KYC)**. A full-screen gate hides the dashboard and the transaction room until the KYC is submitted (also enforced on the server for chat). After submitting, everything opens. "Go to transaction room" removed from that page. |
| 2 | Announcements no longer show a time. |
| 3 | Admin **Controls → Automatic missed-message emails** toggle (default ON). ON: anyone who is away is emailed the moment someone — user or admin — writes. OFF: emails wait for approval. |
| 4 | New composer: multi-paragraph writing (Shift+Enter, or Enter on phones), auto-growing; **Paste as copied** / **Paste as plain text** menu; messages keep their paragraphs. |
| 5 | Crypto-deposit explanation rewritten from your spec: purpose, tier table, how the amount is set, one-time unlock, edge cases, and — prominently — that the verification deposit is **credited to the seller's available balance** (it is their money, not a fee), with a 4-step "how it works". |
| 6 | App start: cinematic splash → **Sign in / Create account**. Buyer: enter registered email → code → create password → lands directly in the transaction group; later signs in with email + password. Seller: enter registered email → registration → KYC. Install as an app on Android, iPhone, Windows, Mac. |
| 7 | Message times use each viewer's **own local time** (the server's clock is never shown). Emails show New York time with UTC. |
| 7i / 7Ii | **Last seen.** Admin always sees both parties' last seen and sets what they may see: *Nothing* (default) / *Recently* / *Exact*. Each party has a "Share my last seen" switch; turn yours off and you stop seeing theirs and they stop seeing yours. |
| 8 | Existing links keep working across deploys (see above). |
| 9 | **Copy** added to the message menu (right-click / long-press) and to the multi-select bar; multi-select delete was already there (menu → Select). |
| 10 | One invite seat = one person: opening a link again no longer creates new user rows; stray offline rows are cleaned up automatically. The directory now shows one buyer and one seller per group. |

Also fixed: header controls no longer overlap the title on desktop; admin title restored after party view.

**Honest limits**: a real Android/Windows installer file (APK/EXE) needs a separate build tool — the app installs through the browser (Chrome/Edge/Safari) as a full-screen app. Phone verification is confirmed by the Desk. IP location needs internet on the host.
