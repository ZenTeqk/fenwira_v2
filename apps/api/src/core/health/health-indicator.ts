/** A readiness dependency. `check` resolves when healthy and throws (with a reason) otherwise. */
export interface HealthIndicator {
  readonly name: string
  check(): Promise<void>
}

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS')
export const HEALTH_SERVICE_NAME = Symbol('HEALTH_SERVICE_NAME')

export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
