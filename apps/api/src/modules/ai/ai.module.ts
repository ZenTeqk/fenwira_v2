import { type AiConfig, createAiProvider } from '@fenwira/ai'
import { type DynamicModule, Module } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { AuditModule } from '../audit'
import { AiAnswerService } from './ai-answer.service'
import { AiIngestProcessor } from './ai-ingest.processor'
import { AiPlatformController } from './ai-platform.controller'
import { AiPlatformService } from './ai-platform.service'
import { AiController } from './ai.controller'
import { AI_CONFIG, AI_PROVIDER } from './ai.options'
import { AiService } from './ai.service'

const providers = (config: AiConfig) => [
  { provide: AI_CONFIG, useValue: config },
  {
    provide: AI_PROVIDER,
    inject: [PinoLogger],
    useFactory: (logger: PinoLogger) => {
      logger.setContext('AiProvider')
      return createAiProvider(config, logger)
    },
  },
  AiAnswerService,
]

/**
 * AI Assistant (docs/AI_ASSISTANT.md): knowledge, settings, playground and the answer runtime.
 * The automation module imports this one (the AI reply step); never the other way round.
 */
@Module({})
export class AiModule {
  static forApi(config: AiConfig): DynamicModule {
    return {
      module: AiModule,
      imports: [AuditModule],
      controllers: [AiController, AiPlatformController],
      providers: [...providers(config), AiService, AiPlatformService],
      exports: [AiAnswerService, AI_CONFIG],
    }
  }

  static forWorker(config: AiConfig): DynamicModule {
    return {
      module: AiModule,
      providers: [...providers(config), AiIngestProcessor],
      exports: [AiAnswerService, AiIngestProcessor, AI_CONFIG],
    }
  }
}
