import { Injectable } from '@nestjs/common';
import { ProcessingStrategy } from './processing-strategy.interface';
import { PromotionalStrategy } from './promotional.strategy';
import { PersonalStrategy } from './personal.strategy';

@Injectable()
export class StrategyFactory {
  constructor(
    private readonly promotionalStrategy: PromotionalStrategy,
    private readonly personalStrategy: PersonalStrategy,
  ) {}

  createStrategy(planName: string): ProcessingStrategy {
    switch (planName) {
      case 'promotional':
        return this.promotionalStrategy;
      case 'personal':
        return this.personalStrategy;
      default:
        throw new Error(`Unknown plan: ${planName}`);
    }
  }

  getAvailableStrategies(): string[] {
    return ['promotional', 'personal'];
  }
}
