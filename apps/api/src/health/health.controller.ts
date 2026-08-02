import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public, SkipAudit } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

/**
 * Sonde de vivacité. Volontairement muette sur les détails d'infrastructure :
 * un point de santé public ne doit renseigner ni sur les versions, ni sur la
 * topologie interne, ni sur la nature d'une panne.
 */
@Controller('health')
@Public()
@SkipAudit()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
