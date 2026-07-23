import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { allowRequest, clientIp, pinAttemptsExhausted, recordFailedPin } from '../_shared/rate-limit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Scopes the rate-limit buckets so this function's traffic cannot exhaust
// staff-list-orders' budget for the same IP.
const ENDPOINT = 'update-order-status'

interface ReqBody {
  p_pin: string
  p_order_number: string
  p_new_status: string
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
  if (await pinAttemptsExhausted(supabase, ENDPOINT, ip)) return tooMany

  try {
    const body: ReqBody = await req.json()

    if (!body.p_pin || !body.p_order_number || !body.p_new_status) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders })
    }

    // Not .maybeSingle(): the RPC returns a set, and two staff sharing a
    // PIN would make it throw instead of authenticating.
    const { data: matches, error: pinError } = await supabase
      .rpc('verify_staff_pin', { p_pin: body.p_pin })

    if (pinError) throw pinError
    if (!matches || matches.length === 0) {
      await recordFailedPin(supabase, ENDPOINT, ip)
      return new Response(JSON.stringify({ error: 'Invalid PIN' }), { status: 401, headers: corsHeaders })
    }

    const validStatuses = ['placed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']
    if (!validStatuses.includes(body.p_new_status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers: corsHeaders })
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: body.p_new_status, updated_at: new Date().toISOString() })
      .eq('order_number', body.p_order_number)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true, status: body.p_new_status }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('update-order-status error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
