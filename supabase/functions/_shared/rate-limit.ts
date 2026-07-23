// Per-IP throttling for the PIN-guarded staff endpoints.
//
// The counter lives in the database, not in this module. An earlier version
// kept it in a module-level Map, which does not survive: Supabase runs each
// function in a V8 isolate created and discarded around requests, so the
// Map is empty far more often than not. Measured against the live project,
// 42 consecutive wrong-PIN requests from one IP produced zero 429s. See
// supabase/rate-limiting.sql for the table and the atomic counter.
//
// Two separate budgets, because one number cannot do both jobs. Staff share
// the shop's WiFi, so every device polling the dashboard every 15 s arrives
// from a single IP — a flat 5/minute locked the second person out as soon
// as they logged in. Brute force is a stream of *wrong* PINs, so that is
// what gets the tight budget; someone who keeps typing the right PIN never
// touches it.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WINDOW_SECONDS = 60;

// Enough headroom for several staff polling every 15 s from one IP.
const MAX_REQUESTS = 60;

// A person mistyping a PIN needs a couple of tries. A script needs
// thousands.
const MAX_FAILED_PINS = 5;

export function clientIp(req: Request): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown';
}

async function hit(
    supabase: SupabaseClient,
    bucket: string,
    max: number,
): Promise<boolean> {
    const { data, error } = await supabase.rpc('rate_limit_hit', {
        p_bucket: bucket,
        p_max: max,
        p_window_seconds: WINDOW_SECONDS,
    });

    // Fail open. If the limiter itself is broken, staff still need to work
    // their shift — a throttle that takes the dashboard down when the RPC
    // is missing is worse than the brute-force risk it covers. The PIN is
    // still bcrypt-hashed and still only verifiable through service_role.
    if (error) {
        console.error('rate_limit_hit failed, allowing request:', error.message);
        return true;
    }
    return data !== false;
}

/**
 * Overall request budget — catches hammering regardless of PIN validity.
 * `endpoint` scopes the bucket so one function's traffic cannot exhaust
 * another's.
 */
export function allowRequest(
    supabase: SupabaseClient,
    endpoint: string,
    ip: string,
): Promise<boolean> {
    return hit(supabase, `${endpoint}:req:${ip}`, MAX_REQUESTS);
}

/**
 * Call after a PIN is rejected. Returns false once this IP has burned its
 * wrong-PIN budget, which is checked on the *next* request — before the
 * bcrypt comparison, so a locked-out caller costs no CPU.
 */
export function recordFailedPin(
    supabase: SupabaseClient,
    endpoint: string,
    ip: string,
): Promise<boolean> {
    return hit(supabase, `${endpoint}:pin:${ip}`, MAX_FAILED_PINS);
}

/**
 * Peek at the wrong-PIN budget without spending from it, so a legitimate
 * staff member's successful requests never count toward the brute-force
 * limit.
 */
export async function pinAttemptsExhausted(
    supabase: SupabaseClient,
    endpoint: string,
    ip: string,
): Promise<boolean> {
    const { data, error } = await supabase
        .from('rate_limits')
        .select('count, reset_at')
        .eq('bucket', `${endpoint}:pin:${ip}`)
        .maybeSingle();

    if (error || !data) return false;
    if (new Date(data.reset_at) <= new Date()) return false;
    return data.count >= MAX_FAILED_PINS;
}
