import { type DynamicModule, Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { type IncomingMessage } from 'node:http'
import { type CoreConfig } from '../config/core-config'
import { createRootLogger } from './logger'

type CorrelatedRequest = IncomingMessage & { correlationId?: string }

export function pathOnly(url: string | undefined): string {
  const path = (url ?? '').split('?')[0] ?? ''
  // Public invitation paths contain bearer credentials, including preview requests.
  return path.replace(/^(\/api\/v1\/invitations\/)[^/]+/i, '$1[REDACTED]')
}

@Module({})
export class LoggingModule {
  static forRoot(config: CoreConfig): DynamicModule {
    const logger = createRootLogger(config, config.logDestination)
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            logger,
            genReqId: (req) => (req as CorrelatedRequest).correlationId ?? '',
            // Health probes run every few seconds; keep them out of access logs.
            autoLogging: { ignore: (req) => pathOnly(req.url).startsWith('/health') },
            customLogLevel: (_req, res, err) =>
              err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            // Access log shape: method, path (never the query string), status, duration.
            serializers: {
              req: (req: { method?: string; url?: string }) => ({
                method: req.method,
                path: pathOnly(req.url),
              }),
              res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
            },
            customAttributeKeys: { responseTime: 'durationMs' },
            quietReqLogger: true,
          },
        }),
      ],
      exports: [LoggerModule],
    }
  }
}
