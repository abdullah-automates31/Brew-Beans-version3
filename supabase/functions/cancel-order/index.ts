import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { allowRequest, clientIp, pinAttemptsExhausted, recordFailedPin } from '../_shared/rate-limit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Scopes the rate-limit buckets so this function's traffic cannot exhaust
// other endpoints' budget for the same IP.
const ENDPOINT = 'cancel-order'

// Mirrors update-order-status's flat status list, but only the states a
// customer is allowed to back out of. Anything past "preparing" means the
// kitchen/rider is already committed, so cancellation is staff-only from
// there via the existing update-order-status flow.
const CANCELLABLE_STATUSES = ['placed', 'preparing']

interface ReqBody {
  p_order_number: string
  p_phone: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const ip = clientIp(req)
  const tooMany = new Response(
    JSON.stringify({ error: 'Too many attempts. Try again in a minute.' }),
    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

  if (!await allowRequest(supabase, ENDPOINT, ip)) return tooMany
  // Reuses the same shape as the staff PIN brute-force budget: a wrong
  // order_number/phone pairing counts against it, so guessing phone
  // numbers against a known order number is throttled the same way
  // guessing a PIN is.
  if (await pinAttemptsExhausted(supabase, ENDPOINT, ip)) return tooMany

  try {
    const body: ReqBody = await req.json()

    if (!body.p_order_number || !body.p_phone) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders })
    }

    // Two-factor lookup (order number + phone), same pattern as the
    // get_order_status RPC the tracking page already uses — no PIN, no
    // Supabase Auth session, just proof the caller knows both values.
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('status, phone')
      .eq('order_number', body.p_order_number)
      .maybeSingle()

    if (fetchError) throw fetchError

    if (!order || order.phone !== body.p_phone) {
      await recordFailedPin(supabase, ENDPOINT, ip)
      return new Response(
        JSON.stringify({ error: "We couldn't find an order matching that ID and phone number." }),
        { status: 404, headers: corsHeaders }
      )
    }

    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'This order has already been cancelled.' }),
        { status: 400, headers: corsHeaders }
      )
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return new Response(
        JSON.stringify({ error: 'This order can no longer be cancelled because it is already being completed.' }),
        { status: 400, headers: corsHeaders }
      )
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('order_number', body.p_order_number)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true, status: 'cancelled' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('cancel-order error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
