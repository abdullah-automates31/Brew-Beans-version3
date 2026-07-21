import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { jazzCashSecureHash, pktStamp } from '../_shared/jazzcash.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ReqBody {
  order_number: string
  payment_method: string
  amount: number
  return_url: string
}

// Hosted page-redirect endpoints. Overridable via env for edge cases.
const JAZZCASH_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform',
  production: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform',
}

const EASYPAISA_URLS: Record<string, string> = {
  sandbox: 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf',
  production: 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function buildJazzCash(body: ReqBody) {
  const merchantId = Deno.env.get('JAZZCASH_MERCHANT_ID') || ''
  const password = Deno.env.get('JAZZCASH_PASSWORD') || ''
  const salt = Deno.env.get('JAZZCASH_INTEGRITY_SALT') || ''

  // No credentials yet (owner hasn't onboarded) -> tell the client to fall
  // back to Cash on Delivery instead of sending a broken form to the gateway.
  if (!merchantId || !password || !salt) {
    return { configured: false, message: 'JazzCash is not configured yet' }
  }

  const env = (Deno.env.get('JAZZCASH_ENV') || 'sandbox').toLowerCase()
  const gatewayUrl = Deno.env.get('JAZZCASH_GATEWAY_URL') || JAZZCASH_URLS[env] || JAZZCASH_URLS.sandbox

  const now = pktStamp()
  const expiry = pktStamp(60) // 1-hour window
  // TxnRefNo must be unique & alphanumeric; we reconcile via return_url params,
  // so it need not equal the human order number.
  const txnRef = ('T' + now + Math.floor(Math.random() * 1000)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)

  const fields: Record<string, string> = {
    pp_Version: Deno.env.get('JAZZCASH_VERSION') || '1.1',
    pp_TxnType: Deno.env.get('JAZZCASH_TXN_TYPE') || '',
    pp_Language: 'EN',
    pp_MerchantID: merchantId,
    pp_SubMerchantID: '',
    pp_Password: password,
    pp_TxnRefNo: txnRef,
    pp_Amount: Math.round(body.amount * 100).toString(), // paisa
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: now,
    pp_BillReference: body.order_number,
    pp_Description: `Brew Beans order ${body.order_number}`,
    pp_TxnExpiryDateTime: expiry,
    pp_ReturnURL: body.return_url,
    ppmpf_1: body.order_number,
    ppmpf_2: '',
    ppmpf_3: '',
    ppmpf_4: '',
    ppmpf_5: '',
  }

  fields.pp_SecureHash = await jazzCashSecureHash(fields, salt)

  return { configured: true, gatewayUrl, fields }
}

async function buildEasyPaisa(body: ReqBody) {
  const storeId = Deno.env.get('EASYPAISA_STORE_ID') || ''
  const hashKey = Deno.env.get('EASYPAISA_HASH_KEY') || ''

  // EasyPaisa's exact request-hashing differs by merchant package
  // (Merchant-Hosted uses AES-128-ECB of the sorted params with the hash key).
  // Until the owner provides their EasyPaisa onboarding pack + hash method we
  // keep this gated so the client cleanly falls back to Cash on Delivery.
  if (!storeId || !hashKey) {
    return { configured: false, message: 'EasyPaisa is not configured yet' }
  }

  const env = (Deno.env.get('EASYPAISA_ENV') || 'sandbox').toLowerCase()
  const gatewayUrl = Deno.env.get('EASYPAISA_GATEWAY_URL') || EASYPAISA_URLS[env] || EASYPAISA_URLS.sandbox

  const expiry = pktStamp(60)
  const fields: Record<string, string> = {
    storeId,
    amount: body.amount.toFixed(0),
    postBackURL: body.return_url,
    orderRefNum: body.order_number,
    expiryDate: expiry,
    autoRedirect: '0',
    paymentMethod: 'MA_PAYMENT_METHOD',
  }

  // Placeholder signing hook — real AES-128-ECB signing is wired in once the
  // owner's EasyPaisa package/hash method is confirmed. Structure is ready.
  return { configured: false, message: 'EasyPaisa signing pending merchant onboarding', _draftFields: fields, gatewayUrl }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body: ReqBody = await req.json()

    if (!body.order_number || !body.payment_method || !body.amount || !body.return_url) {
      return json({ error: 'Missing required fields' }, 400)
    }

    if (body.payment_method === 'jazzcash') {
      return json(await buildJazzCash(body))
    }
    if (body.payment_method === 'easypaisa') {
      return json(await buildEasyPaisa(body))
    }

    return json({ configured: false, message: 'Unsupported payment method' })
  } catch (err) {
    console.error('create-payment error:', err)
    return json({ configured: false, error: (err as Error).message || 'Internal server error' }, 500)
  }
})
