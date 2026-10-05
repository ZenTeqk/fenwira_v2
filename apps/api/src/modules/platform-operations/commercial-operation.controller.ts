import {
  walletOperationSchema,
  type WalletOperation,
  subscriptionOperationSchema,
  type SubscriptionOperation,
  entitlementOperationSchema,
  type EntitlementOperation,
} from '@fenwira/contracts'
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe'
import { PlatformAccess } from '../../core/security/decorators'
import { CommercialOperationService } from './commercial-operation.service'
@Controller('platform/workspaces/:workspaceId')
export class CommercialOperationController {
  constructor(private readonly operations: CommercialOperationService) {}
  @PlatformAccess('subscription.manage')
  @Post('subscription-operations')
  @HttpCode(200)
  async subscription(
    @Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(subscriptionOperationSchema)) body: SubscriptionOperation,
  ) {
    return { data: await this.operations.subscription(id, body) }
  }
  @PlatformAccess('entitlements.manage')
  @Post('entitlement-operations')
  @HttpCode(200)
  async entitlement(
    @Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(entitlementOperationSchema)) body: EntitlementOperation,
  ) {
    return { data: await this.operations.entitlement(id, body) }
  }
  @PlatformAccess('wallet.manage')
  @Post('wallet-operations')
  @HttpCode(200)
  async wallet(
    @Param('workspaceId', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(walletOperationSchema)) body: WalletOperation,
  ) {
    return { data: await this.operations.wallet(id, body) }
  }
}
