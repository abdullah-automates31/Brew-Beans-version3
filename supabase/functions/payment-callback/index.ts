import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyJazzCashHash } from '../_shared/jazzcash.ts'

// Where to send the customer after we record the payment result. Defaults to
// the live site; override with SITE_URL for other deployments.
const SITE_URL = Deno.env.get('SITE_URL') || 'https://brew-beans-version3.vercel.app'

function redirect(order: string, result: 'success' | 'failed') {
  const url = new URL(`${SITE_URL}/order-tracking.html`)
  if (order) url.searchParams.set('order', order)
  url.searchParams.set('payment', result)
  // Phone is intentionally NOT put in the URL — the tracking page reads it
  // from sessionStorage (bb_phone_<order>) to keep it out of history/logs.
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

/** Read fields from a POST form body or a GET query string. */
async function readFields(req: URL, body: string): Promise<Record<string, string>> {
  const fields: Record<string, string> = {}
  // Gateway posts application/x-www-form-urlencoded; some redirect via GET.
  const params = body ? new URLSearchParams(body) : req.searchParams
  for (const [k, v] of params) fields[k] = v
  return fields
}

serve(async (req) => {
  const reqUrl = new URL(req.url)
  // We appended ?order=&phone= to the return_url when creating the payment.
  const order = reqUrl.searchParams.get('order') || ''

  try {
    const rawBody = req.method === 'POST' ? await req.text() : ''
    const fields = await readFields(reqUrl, rawBody)

    // Determine gateway + success. JazzCash: pp_ResponseCode '000' == success.
    const salt = Deno.env.get('JAZZCASH_INTEGRITY_SALT') || ''
    let paid = false

    if (fields.pp_ResponseCode !== undefined) {
      const hashOk = salt ? await verifyJazzCashHash(fields, salt) : false
      paid = hashOk && fields.pp_ResponseCode === '000'
      if (!hashOk) console.error('payment-callback: JazzCash hash verification FAILED for order', order)
    } else if (fields.responseCode !== undefined) {
      // EasyPaisa response shape (finalised once EasyPaisa signing is wired).
      paid = fields.responseCode === '0000'
    }

    // Record the result server-side (service role bypasses RLS).
    const orderNumber = order || fields.pp_BillReference || fields.orderRefNum || ''
    if (orderNumber) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: paid ? 'paid' : 'failed', updated_at: new Date().toISOString() })
        .eq('order_number', orderNumber)
      if (error) console.error('payment-callback: DB update error:', error.message)
    }

    return redirect(orderNumber, paid ? 'success' : 'failed')
  } catch (err) {
    console.error('payment-callback error:', err)
    return redirect(order, 'failed')
  }
})
