import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { allowRequest, clientIp, pinAttemptsExhausted, recordFailedPin } from '../_shared/rate-limit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders })
  }

  const ip = clientIp(req)
  if (!allowRequest(ip) || pinAttemptsExhausted(ip)) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again in a minute.' }), { status: 429, headers: corsHeaders })
  }

  try {
    const { p_pin } = await req.json()

    if (!p_pin) {
      return new Response(JSON.stringify({ error: 'PIN is required' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Not .maybeSingle(): the RPC returns a set, and two staff sharing a
    // PIN would make it throw instead of authenticating. Once PINs are
    // hashed nobody can notice that collision, so tolerate it here.
    const { data: matches, error: pinError } = await supabase
      .rpc('verify_staff_pin', { p_pin })

    if (pinError) throw pinError
    if (!matches || matches.length === 0) {
      recordFailedPin(ip)
      return new Response(JSON.stringify({ error: 'Invalid PIN' }), { status: 401, headers: corsHeaders })
    }

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })

    if (ordersError) throw ordersError

    const orderIds = (orders || []).map(o => o.id)
    if (orderIds.length === 0) {
      return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('order_id, menu_item_name, quantity')
      .in('order_id', orderIds)

    if (itemsError) throw itemsError

    const itemsByOrder: Record<number, { name: string; quantity: number }[]> = {}
    for (const item of orderItems || []) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
      itemsByOrder[item.order_id].push({ name: item.menu_item_name, quantity: item.quantity })
    }

    const result = (orders || []).map(order => ({
      order_number: order.order_number,
      customer_name: order.customer_name,
      phone: order.phone,
      address: order.address,
      notes: order.notes,
      total: order.total,
      status: order.status,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      created_at: order.created_at,
      items: itemsByOrder[order.id] || [],
    }))

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('staff-list-orders error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
