import { Database } from '@fenwira/database'
import { Inject, Injectable, type OnApplicationShutdown, type Provider } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'

export const databaseProvider: Provider = {
  provide: Database,
  useFactory: (config: CoreConfig) =>
    Database.connect({ url: config.databaseUrl, poolSize: config.dbPoolSize }),
  inject: [CORE_CONFIG],
}

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.disconnect()
  }
}
