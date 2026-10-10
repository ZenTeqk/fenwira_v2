import { type INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import IORedis from 'ioredis'
import { type Server, type ServerOptions } from 'socket.io'

/** Socket.IO over the Redis adapter so any api replica (and later the worker) can emit (ADR-0010). */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>
  private clients: IORedis[] = []

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly webOrigin: string,
  ) {
    super(app)
  }

  async connect(): Promise<void> {
    const pub = new IORedis(this.redisUrl, { maxRetriesPerRequest: null })
    const sub = pub.duplicate()
    for (const c of [pub, sub]) c.on('error', () => undefined)
    this.clients = [pub, sub]
    this.adapterConstructor = createAdapter(pub, sub)
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: '/ws',
      cors: { origin: this.webOrigin, credentials: true },
    }) as Server
    if (this.adapterConstructor) server.adapter(this.adapterConstructor)
    return server
  }

  override async close(server: Server): Promise<void> {
    await super.close(server)
    await Promise.allSettled(this.clients.map((c) => c.quit()))
  }
}
