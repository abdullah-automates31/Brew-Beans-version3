// Shared JazzCash HTTP-Redirect (v1.1/v2.0) Secure Hash helpers.
//
// Used by BOTH `create-payment` (to sign the outgoing form) and
// `payment-callback` (to verify the gateway's response). Keeping the
// algorithm in one place guarantees signing and verification never drift.
//
// Algorithm (per JazzCash HTTP Redirect integration guide):
//   1. Take every request/response field that has a non-empty value,
//      EXCEPT `pp_SecureHash` itself.
//   2. Sort the field NAMES ascending (ASCII).
//   3. Build: hashString = IntegritySalt + '&' + value1 + '&' + value2 + ...
//   4. secureHash = HMAC_SHA256(hashString, key = IntegritySalt), hex, UPPERCASE.
//
// NOTE: the Integrity Salt is a SECRET — it is read from an environment
// variable (Supabase Edge Function secret), never hardcoded or committed.

async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Build the JazzCash secure hash for a set of fields. */
export async function jazzCashSecureHash(
  fields: Record<string, string>,
  integritySalt: string,
): Promise<string> {
  const keys = Object.keys(fields)
    .filter((k) => k !== 'pp_SecureHash' && fields[k] != null && String(fields[k]) !== '')
    .sort()

  let hashString = integritySalt
  for (const k of keys) hashString += '&' + fields[k]

  return await hmacSha256Hex(hashString, integritySalt)
}

/** Constant-time-ish verification of a gateway response's pp_SecureHash. */
export async function verifyJazzCashHash(
  fields: Record<string, string>,
  integritySalt: string,
): Promise<boolean> {
  const received = String(fields.pp_SecureHash || '').toUpperCase()
  if (!received) return false

  const expected = await jazzCashSecureHash(fields, integritySalt)
  if (received.length !== expected.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/** yyyyMMddHHmmss in Pakistan Standard Time (UTC+5), optionally offset by minutes. */
export function pktStamp(offsetMinutes = 0): string {
  const t = new Date(Date.now() + offsetMinutes * 60_000 + 5 * 60 * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
    `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`
  )
}
