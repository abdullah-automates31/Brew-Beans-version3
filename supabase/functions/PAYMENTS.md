# Online Payments — Go-Live Guide

The online-payment flow (JazzCash / EasyPaisa) is **fully built and wired**.
Nothing about payments is hardcoded — the code reads all merchant credentials
from **Supabase Edge Function secrets** at runtime. To go live, the shop owner
only provides their merchant credentials; **no code change is needed.**

> ⚠️ **Never put these credentials in the codebase / git.** They are secrets.
> They live only in Supabase secrets (encrypted), exactly like
> `SUPABASE_SERVICE_ROLE_KEY`.

## Flow

```
checkout (js/main.js)
  → create-payment   builds + SIGNS the gateway form (pp_SecureHash)
  → browser auto-submits form to JazzCash/EasyPaisa hosted page
  → customer pays on the gateway
  → gateway POSTs result to  payment-callback
  → payment-callback VERIFIES the hash, updates orders.payment_status
  → redirects to order-tracking.html?order=…&payment=success|failed
```

If credentials are missing, `create-payment` returns `configured: false` and the
site cleanly falls back to **Cash on Delivery** — so nothing breaks pre-launch.

## Required secrets (owner provides the values)

### JazzCash
| Secret | From |
|---|---|
| `JAZZCASH_MERCHANT_ID` | JazzCash merchant portal |
| `JAZZCASH_PASSWORD` | JazzCash merchant portal |
| `JAZZCASH_INTEGRITY_SALT` | JazzCash merchant portal (Integrity Salt) |
| `JAZZCASH_ENV` | `sandbox` for testing, `production` when live |

### EasyPaisa (optional — enable when onboarded)
| Secret | From |
|---|---|
| `EASYPAISA_STORE_ID` | EasyPaisa merchant onboarding pack |
| `EASYPAISA_HASH_KEY` | EasyPaisa merchant onboarding pack |
| `EASYPAISA_ENV` | `sandbox` / `production` |

> EasyPaisa's exact request-hashing (AES-128-ECB vs HMAC) depends on the
> merchant's package. The scaffold is in place; final signing is wired once the
> owner shares their EasyPaisa integration doc. Until then EasyPaisa returns
> `configured:false` and orders fall back to COD.

### Already set (do not change)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (used by callback to update orders),
optional `SITE_URL` (defaults to the live domain for the post-payment redirect).

## Setting the secrets

Owner sets them themselves (preferred — you never see production credentials):

```bash
supabase secrets set \
  JAZZCASH_MERCHANT_ID=xxxx \
  JAZZCASH_PASSWORD=xxxx \
  JAZZCASH_INTEGRITY_SALT=xxxx \
  JAZZCASH_ENV=sandbox \
  --project-ref rtqbpviegxwgaknmrrsg
```

…or via **Supabase Dashboard → Edge Functions → Manage secrets**.

## Deploy

```bash
supabase functions deploy create-payment
supabase functions deploy payment-callback
```

## Go-live checklist

1. Owner creates JazzCash **sandbox** creds → set secrets with `JAZZCASH_ENV=sandbox`.
2. Deploy both functions.
3. Place a test order, pay on the JazzCash sandbox page, confirm the order
   flips to `payment_status = paid` and lands on the tracking page.
4. Swap in **production** creds, set `JAZZCASH_ENV=production`. **No redeploy of
   logic needed** — only the secret values change.

## Secure hash

`_shared/jazzcash.ts` signs outgoing forms and verifies incoming callbacks with
the same HMAC-SHA256 routine (sort non-empty fields by name → prepend Integrity
Salt → HMAC → uppercase hex). The callback rejects any response whose hash does
not match, so a tampered `pp_ResponseCode` can't mark an unpaid order as paid.
