# orydl — go live

Everything is built and tested. What remains is wiring, in this order.
**Do not reorder — each step's output is the next step's input.**

Current state, verified against a live deployment:

| Piece | State |
|---|---|
| Convex backend (14 modules) | ✅ deploys clean, all functions tested |
| 80 real leads | ✅ imported (27 Goa hotels, 23 HSR restaurants, 18 Jaipur, 8 Karol Bagh, 4 pharmacies) |
| Intent extraction | ✅ live-tested — `negotiate`, ₹4000, hi-IN, 3 objectives |
| Vendor discovery + compliance gate | ✅ live-tested on real Goa hotels |
| Telegram bot `@orydl_bot` | ✅ token verified, full flow tested |
| Dashboard | ✅ builds, 46 kB gzipped |
| Bridge (Pipecat + Twilio + Sarvam) | ✅ imports clean, **never dialled a real number yet** |
| Twilio | ✅ Full account, `+16088177942`, $18.85 |
| **Convex deployment** | 🔴 **local only — nothing external can reach it** |
| **ngrok** | 🔴 not started |
| **India high-risk geo permission** | 🟠 off — may block Indian mobiles |

---

## 1. Convex → cloud (2 min) 🔴 BLOCKING

Local Convex (`127.0.0.1:3210`) cannot receive the Telegram webhook or Twilio's
StatusCallback, and Vercel can't reach it. Everything downstream needs this.

```bash
npx convex login       # GitHub OAuth, free, no card
npx convex dev         # provisions a cloud deployment, rewrites .env.local
```

Then copy the two URLs out of `.env.local` — **they are different hosts and it
matters**:

- `CONVEX_URL` → `https://<dep>.convex.cloud` — browser client
- `CONVEX_SITE_URL` → `https://<dep>.convex.site` — httpActions/webhooks

## 2. Convex env (1 min)

```bash
npx convex env set SARVAM_API_KEY      "sk_..."
npx convex env set TELEGRAM_BOT_TOKEN  "8911904003:..."
npx convex env set TG_WEBHOOK_SECRET   "<from .env>"
npx convex env set BRIDGE_SECRET       "<from .env>"
npx convex env set TWILIO_FROM_NUMBER  "+16088177942"
npx convex env set BRIDGE_URL          "https://<your>.ngrok-free.dev"   # after step 4
npx convex env set DASHBOARD_URL       "https://<your>.vercel.app"       # after step 6

npx convex env list                     # verify
curl https://<dep>.convex.site/health   # all four flags must read true
```

⚠️ These **must** go through `npx convex env set`. A local `.env` leaves
`process.env` undefined in deployed httpActions and every Telegram call 404s
with a confusing "Not Found".

## 3. Import the leads (30 s)

```bash
npx convex import --table leads --format jsonLines --append scripts/leads.jsonl
```

## 4. ngrok + bridge (3 min)

```bash
ngrok config add-authtoken <token>
ngrok http 7860          # copy the https host, e.g. abc123.ngrok-free.dev
```

Create `bridge/.env` (copy the block from `.env.example`), then:

```bash
cd bridge
uv run uvicorn server:app --host 0.0.0.0 --port 7860
```

On boot it prints a Convex health check. If it says `hasSarvamKey: false`, step 2
didn't take.

⚠️ **The ngrok host is baked into the TwiML of every call.** Restarting ngrok
silently breaks all subsequent calls while everything else looks fine. Set it
once and **never restart ngrok after 16:00.**

## 5. Register the Telegram webhook (30 s)

```bash
npx convex run telegram:registerWebhook '{"convexSiteUrl":"https://<dep>.convex.site"}'
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

`last_error_message` must be empty. Then message `@orydl_bot` — you should get
the brief card back within ~3 seconds.

## 6. Dashboard (2 min)

```bash
cd web
echo 'VITE_CONVEX_URL=https://<dep>.convex.cloud' > .env.local
npm run build
npx vercel --prod          # or: npm run dev, for a local demo
```

Get your dashboard link by sending `/start` to the bot.

## 7. 🔴 The first real call — do this before anything else is polished

**Nothing has dialled a real number yet. This is the only untested link.**

Use a teammate's phone, with their consent:

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Calls.json" \
  --data-urlencode "To=+91XXXXXXXXXX" \
  --data-urlencode "From=+16088177942" \
  --data-urlencode 'Twiml=<Response><Say>Namaste. Telephony works.</Say></Response>' \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
```

| Result | Meaning |
|---|---|
| Phone rings | ✅ go run the full flow through Telegram |
| `21215` | Geo permissions — see below |
| Created but silent | Carrier-side. Try a different operator's number. |

### If you get 21215

Console → Voice → Settings → **Geo Permissions → India → enable high-risk**.
Currently: low-risk ON, **high-risk OFF**. Indian mobiles may sit in the
high-risk range. I did not toggle this myself — it widens fraud exposure and
it's an account-security call that's yours to make. It's two clicks.

---

## Before you demo

- [ ] One real call completed end to end, with a transcript in the dashboard
- [ ] **Record a 90-second video of a working call** — this is your Tier-2
      fallback and it costs nothing while things are working
- [ ] Pre-arrange consent with 2–3 real businesses, log via `gate:logConsent`
- [ ] Phone on a **wired earbud into the PA — never open speakerphone.**
      Speakerphone → room → mic → VAD → the agent interrupts itself. This kills
      more voice demos than any API.
- [ ] `ALLOW_INTERRUPTIONS=false` in `bridge/.env` if the room is loud
- [ ] Test on the actual projector — dashboard is dark, 17px, tabular-nums
- [ ] Lead the demo with **Goa hotels** (27 leads), not the fridge (Karol Bagh
      electronics returned only 3 numbers from OSM)

## Fallback ladder

| Tier | What | Note |
|---|---|---|
| 0 | Real consented business | primary |
| 1 | Teammate in the corridor | genuine PSTN, same code path — **say so, nobody deducts** |
| 2 | The recorded video | judges forgive a recording, not dead air |
| 3 | The Convex tables | 80 real leads, transcripts, consent log, DNC list |

**Never debug in front of judges.** One failed attempt, one sentence, next tier.

## If something breaks

| Symptom | Cause |
|---|---|
| Telegram silent | Webhook on `.convex.cloud` instead of `.convex.site`, or env not set via `convex env set` |
| Bot 404s on every send | `TELEGRAM_BOT_TOKEN` in a local `.env` instead of the deployment |
| Agent silent on the call | `reasoning_effort` isn't `null` somewhere — content comes back empty with no error |
| Long dead air per turn | STT running at 8000 Hz instead of 16000 |
| Calls stuck at `queued` | Chain stalled. `reapStuck` clears it within 60 s. |
| TTS 400 | A `bulbul:v2` voice name. `anushka` is v2 — use `simran`. |
| Twilio 21215 | India high-risk geo permission |
| Calls stop working suddenly | ngrok restarted and the URL changed |

Full detail: [`docs/BUILD-SPEC.md`](docs/BUILD-SPEC.md).
