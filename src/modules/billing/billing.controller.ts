import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async getPlans() {
    return this.billingService.getPlans();
  }

  @Post('subscription')
  async createSubscription(@Body() subscriptionData: any) {
    return this.billingService.createSubscription(subscriptionData);
  }

  @Get('subscription/:id')
  async getSubscription(@Param('id') id: string) {
    return this.billingService.getSubscription(id);
  }
}
