/** Redis key the worker writes when it processes a ping; the api reads it. TTL 1 hour. */
export const systemPingKey = (eventId: string): string => `fenwira:system-ping:${eventId}`
export const SYSTEM_PING_TTL_SECONDS = 3600
