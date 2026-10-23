import { type DynamicModule, Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { IDENTITY_WORKER_OPTIONS, type IdentityWorkerOptions } from './identity-worker.options'
import { IDENTITY_OPTIONS, type IdentityOptions } from './identity.options'
import { IdentityProcessor } from './identity.processor'
import { IdentityService } from './identity.service'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SecurityEventsService } from './security-events.service'
import { SessionService } from './session.service'

const services = [
  PasswordService,
  JwtService,
  SessionService,
  SecurityEventsService,
  IdentityService,
  AuthGuard,
]

@Module({})
export class IdentityModule {
  /** API side: auth endpoints, sessions, the global AuthGuard. */
  static forApi(options: IdentityOptions): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [AuthController],
      providers: [{ provide: IDENTITY_OPTIONS, useValue: options }, ...services],
      exports: [IDENTITY_OPTIONS, ...services],
    }
  }
}

@Module({})
export class IdentityWorkerModule {
  /** Worker side: token creation + emails for verification and password reset. */
  /** Requires EmailModule (global) in the worker. */
  static forWorker(options: IdentityWorkerOptions): DynamicModule {
    return {
      module: IdentityWorkerModule,
      providers: [{ provide: IDENTITY_WORKER_OPTIONS, useValue: options }, IdentityProcessor],
      exports: [IdentityProcessor],
    }
  }
}
