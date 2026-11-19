import { randomUUID } from 'crypto'
import redis from '../../api/utils/redisClient'

// Caps how many Cloudflare Browser Run requests run at once across every worker
// (all shop queues + the listings queue share this one limit via Redis).
//
// Change the limit with CLOUDFLARE_MAX_CONCURRENT_BROWSERS in .env, e.g. raise it
// when moving from the Workers Free plan (3 concurrent browsers) to a paid plan.
const MAX_CONCURRENT = Math.max(1, Number(process.env.CLOUDFLARE_MAX_CONCURRENT_BROWSERS) || 3)

const SLOTS_KEY = 'cloudflare_browser_slots'
// A slot is freed automatically after this long, so a crashed worker can't hold one forever.
const LEASE_MS = 2 * 60 * 1000
// Give up waiting for a free slot after this long; callers already handle thrown errors.
const MAX_WAIT_MS = 10 * 60 * 1000
const POLL_MS = 1000
// How long a "rate limited" mark for a figure/shop is kept around for the API to pick up.
const RATE_LIMITED_FLAG_TTL_S = 60 * 30

// Thrown when Cloudflare rejects a request for going over a plan limit (HTTP 429),
// or when no browser slot frees up in time.
export class CloudflareRateLimitError extends Error {
  constructor (message = 'Cloudflare Browser Run rate limit exceeded') {
    super(message)
    this.name = 'CloudflareRateLimitError'
  }
}

const rateLimitedKey = (figureId: string, shop: string) => `cloudflare_rate_limited_${figureId}_${shop}`

// Records that a search/check for this figure in this shop was cut short by a Cloudflare limit.
export async function markCloudflareRateLimited (figureId: string, shop: string) {
  await redis.set(rateLimitedKey(figureId, shop), Date.now().toString(), 'EX', RATE_LIMITED_FLAG_TTL_S)
}

// Whether any of the given shops was rate limited for this figure at or after `since`.
export async function wasCloudflareRateLimited (figureId: string, shops: string[], since: number) {
  const values = await redis.mget(...shops.map(shop => rateLimitedKey(figureId, shop)))

  return values.some(value => !!value && parseInt(value) >= since)
}

// Atomically: drop expired slots, then take one if any are free.
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[5])
  return 1
end
return 0
`

async function acquireSlot (): Promise<string> {
  const id = randomUUID()
  const start = Date.now()

  while (true) {
    const now = Date.now()
    const acquired = await redis.eval(ACQUIRE_SCRIPT, 1, SLOTS_KEY, now, MAX_CONCURRENT, now + LEASE_MS, id, LEASE_MS)

    if (acquired === 1) return id

    if (now - start > MAX_WAIT_MS) throw new CloudflareRateLimitError('Timed out waiting for a free Cloudflare browser slot')

    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

export async function withCloudflareSlot<T> (fn: () => Promise<T>): Promise<T> {
  const id = await acquireSlot()

  try {
    return await fn()
  } finally {
    await redis.zrem(SLOTS_KEY, id)
  }
}
