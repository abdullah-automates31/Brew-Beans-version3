// Per-IP throttling for the PIN-guarded staff endpoints.
//
// Two separate budgets, because one number cannot do both jobs. Staff share
// the shop's WiFi, so every device polling the dashboard every 15 s arrives
// from a single IP — a flat 5/minute locked the second person out as soon
// as they logged in. Brute force, on the other hand, is a stream of *wrong*
// PINs, so that is what gets the tight budget. A staff member who keeps
// typing the right PIN never touches it.
//
// This lives in the isolate's memory, so it is per-instance and lost when
// the instance recycles. It raises the cost of guessing; it is not a
// guarantee. The real protection is that the PIN is bcrypt-hashed and only
// verifiable through the service role.

const WINDOW_MS = 60_000;

// Enough headroom for several staff polling every 15 s from one IP.
const MAX_REQUESTS = 60;

// A person mistyping a PIN needs a couple of tries. A script needs
// thousands.
const MAX_FAILED_PINS = 5;

interface Bucket {
    count: number;
    resetAt: number;
}

const requests = new Map<string, Bucket>();
const failures = new Map<string, Bucket>();

// The maps are keyed by IP and nothing removes entries on its own, so sweep
// expired buckets once the map is big enough to be worth walking.
function sweep(map: Map<string, Bucket>, now: number): void {
    if (map.size < 1000) return;
    for (const [key, bucket] of map) {
        if (now > bucket.resetAt) map.delete(key);
    }
}

function take(map: Map<string, Bucket>, key: string, max: number): boolean {
    const now = Date.now();
    sweep(map, now);

    const bucket = map.get(key);
    if (!bucket || now > bucket.resetAt) {
        map.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    if (bucket.count >= max) return false;
    bucket.count++;
    return true;
}

export function clientIp(req: Request): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown';
}

/** Overall request budget — catches hammering regardless of PIN validity. */
export function allowRequest(ip: string): boolean {
    return take(requests, ip, MAX_REQUESTS);
}

/**
 * True once this IP has burned its wrong-PIN budget. Checked *before* the
 * bcrypt comparison, so a locked-out caller costs no CPU.
 */
export function pinAttemptsExhausted(ip: string): boolean {
    const bucket = failures.get(ip);
    if (!bucket || Date.now() > bucket.resetAt) return false;
    return bucket.count >= MAX_FAILED_PINS;
}

export function recordFailedPin(ip: string): void {
    take(failures, ip, Number.MAX_SAFE_INTEGER);
}
