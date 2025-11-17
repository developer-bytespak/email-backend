import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { EngagementType, EmailLogStatus } from '@prisma/client';

export interface AnalyticsDateRange {
  from: Date;
  to: Date;
}

export interface EmailAnalyticsOverview {
  range: { from: string; to: string };
  totals: {
    requests: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    spamReports: number;
    unsubscribes: number;
  };
  rates: {
    deliveryRate: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
    spamReportRate: number;
  };
}

export interface EmailAnalyticsTimelinePoint {
  date: string;
  requests: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  spamReports: number;
  unsubscribes: number;
}

export interface EmailAnalyticsEvent {
  id: string;
  type:
    | 'processed'
    | 'deferred'
    | 'delivered'
    | 'bounced'
    | 'blocked'
    | 'dropped'
    | 'spamreport'
    | 'unsubscribe'
    | 'open'
    | 'click';
  occurredAt: string;
  email?: string | null;
  contactName?: string | null;
  subject?: string | null;
  url?: string | null;
  status?: EmailLogStatus | null;
}

@Injectable()
export class EmailAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(clientId: number, range: AnalyticsDateRange): Promise<EmailAnalyticsOverview> {
    const { from, to } = range;

    const [
      totalRequests,
      deliveredCount,
      bouncedCount,
      spamReportCount,
      unsubscribesCount,
      processedCount,
      deferredCount,
      droppedCount,
      blockedCount,
      openCount,
      clickCount,
    ] = await Promise.all([
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'delivered',
          deliveredAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'bounced',
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'spamreport',
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailUnsubscribe.count({
        where: {
          unsubscribedAt: { gte: from, lte: to },
          contact: {
            csvUpload: { clientId },
          },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'processed',
          processedAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'deferred',
          deferredAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'dropped',
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailLog.count({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          status: 'blocked',
          sentAt: { gte: from, lte: to },
        },
      }),
      this.prisma.emailEngagement.count({
        where: {
          engagementType: EngagementType.open,
          engagedAt: { gte: from, lte: to },
          emailLog: {
            emailDraft: {
              clientEmail: {
                clientId,
              },
            },
          },
        },
      }),
      this.prisma.emailEngagement.count({
        where: {
          engagementType: EngagementType.click,
          engagedAt: { gte: from, lte: to },
          emailLog: {
            emailDraft: {
              clientEmail: {
                clientId,
              },
            },
          },
        },
      }),
    ]);

    const effectiveDeliveries = deliveredCount || processedCount;
    const totals = {
      requests: totalRequests,
      delivered: deliveredCount,
      opened: openCount,
      clicked: clickCount,
      bounced: bouncedCount,
      spamReports: spamReportCount,
      unsubscribes: unsubscribesCount,
    };

    const rates = {
      deliveryRate: totalRequests ? (effectiveDeliveries / totalRequests) * 100 : 0,
      openRate: effectiveDeliveries ? (openCount / effectiveDeliveries) * 100 : 0,
      clickRate: effectiveDeliveries ? (clickCount / effectiveDeliveries) * 100 : 0,
      bounceRate: totalRequests ? (bouncedCount / totalRequests) * 100 : 0,
      spamReportRate: totalRequests ? (spamReportCount / totalRequests) * 100 : 0,
    };

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totals,
      rates,
    };
  }

  async getTimeline(clientId: number, range: AnalyticsDateRange): Promise<EmailAnalyticsTimelinePoint[]> {
    const { from, to } = range;

    const dateBuckets = this.buildDateBuckets(from, to);

    const [emailLogs, engagements, unsubscribes] = await Promise.all([
      this.prisma.emailLog.findMany({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          sentAt: { gte: from, lte: to },
        },
        select: {
          sentAt: true,
          status: true,
          deliveredAt: true,
        },
      }),
      this.prisma.emailEngagement.findMany({
        where: {
          engagedAt: { gte: from, lte: to },
          emailLog: {
            emailDraft: {
              clientEmail: {
                clientId,
              },
            },
          },
        },
        select: {
          engagedAt: true,
          engagementType: true,
        },
      }),
      this.prisma.emailUnsubscribe.findMany({
        where: {
          unsubscribedAt: { gte: from, lte: to },
          emailLog: {
            emailDraft: {
              clientEmail: {
                clientId,
              },
            },
          },
        },
        select: {
          unsubscribedAt: true,
        },
      }),
    ]);

    for (const log of emailLogs) {
      const sentKey = this.toBucketKey(log.sentAt);
      if (dateBuckets[sentKey]) {
        dateBuckets[sentKey].requests += 1;
      }

      const deliveredTimestamp = log.deliveredAt ?? log.sentAt;
      const deliveredKey = this.toBucketKey(deliveredTimestamp);
      if (dateBuckets[deliveredKey]) {
        switch (log.status) {
          case EmailLogStatus.delivered:
            dateBuckets[deliveredKey].delivered += 1;
            break;
          case EmailLogStatus.bounced:
            dateBuckets[deliveredKey].bounced += 1;
            break;
          case EmailLogStatus.spamreport:
            dateBuckets[deliveredKey].spamReports += 1;
            break;
          case EmailLogStatus.dropped:
            dateBuckets[deliveredKey].requests += 1;
            break;
          case EmailLogStatus.deferred:
            dateBuckets[deliveredKey].requests += 1;
            break;
          case EmailLogStatus.blocked:
            dateBuckets[deliveredKey].bounced += 1;
            break;
          default:
            break;
        }
      }
    }

    for (const engagement of engagements) {
      const key = this.toBucketKey(engagement.engagedAt);
      if (!dateBuckets[key]) {
        continue;
      }
      if (engagement.engagementType === EngagementType.open) {
        dateBuckets[key].opened += 1;
      } else if (engagement.engagementType === EngagementType.click) {
        dateBuckets[key].clicked += 1;
      }
    }

    for (const unsubscribe of unsubscribes) {
      const key = this.toBucketKey(unsubscribe.unsubscribedAt);
      if (dateBuckets[key]) {
        dateBuckets[key].unsubscribes += 1;
      }
    }

    return Object.values(dateBuckets).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getRecentEvents(
    clientId: number,
    range: AnalyticsDateRange,
    limit = 50,
  ): Promise<EmailAnalyticsEvent[]> {
    const { from, to } = range;

    const [emailLogs, engagements, unsubscribes] = await Promise.all([
      this.prisma.emailLog.findMany({
        where: {
          emailDraft: {
            clientEmail: {
              clientId,
            },
          },
          OR: [
            { sentAt: { gte: from, lte: to } },
            { processedAt: { gte: from, lte: to } },
            { deferredAt: { gte: from, lte: to } },
            { deliveredAt: { gte: from, lte: to } },
          ],
        },
        orderBy: {
          sentAt: 'desc',
        },
        include: {
          contact: {
            select: {
              email: true,
              businessName: true,
            },
          },
          emailDraft: {
            select: {
              subjectLines: true,
            },
          },
        },
      }),
      this.prisma.emailEngagement.findMany({
        where: {
          engagedAt: { gte: from, lte: to },
          emailLog: {
            emailDraft: {
              clientEmail: {
                clientId,
              },
            },
          },
        },
        orderBy: {
          engagedAt: 'desc',
        },
        include: {
          emailLog: {
            select: {
              id: true,
              status: true,
              contact: {
                select: {
                  email: true,
                  businessName: true,
                },
              },
              emailDraft: {
                select: {
                  subjectLines: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.emailUnsubscribe.findMany({
        where: {
          unsubscribedAt: { gte: from, lte: to },
          contact: {
            csvUpload: {
              clientId,
            },
          },
        },
        orderBy: {
          unsubscribedAt: 'desc',
        },
        include: {
          contact: {
            select: {
              email: true,
              businessName: true,
            },
          },
          emailLog: {
            select: {
              status: true,
              emailDraft: {
                select: {
                  subjectLines: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const events: EmailAnalyticsEvent[] = [];

    for (const log of emailLogs) {
      const contactName = log.contact?.businessName ?? null;
      const email = log.contact?.email ?? null;
      const subject = log.emailDraft?.subjectLines?.[0] ?? null;

      if (log.processedAt && this.isWithinRange(log.processedAt, from, to)) {
        events.push({
          id: `processed-${log.id}-${log.processedAt.getTime()}`,
          type: 'processed',
          occurredAt: log.processedAt.toISOString(),
          email,
          contactName,
          subject,
          status: log.status,
        });
      }

      if (log.deferredAt && this.isWithinRange(log.deferredAt, from, to)) {
        events.push({
          id: `deferred-${log.id}-${log.deferredAt.getTime()}`,
          type: 'deferred',
          occurredAt: log.deferredAt.toISOString(),
          email,
          contactName,
          subject,
          status: log.status,
        });
      }

      if (log.deliveredAt && this.isWithinRange(log.deliveredAt, from, to)) {
        events.push({
          id: `delivered-${log.id}-${log.deliveredAt.getTime()}`,
          type: 'delivered',
          occurredAt: log.deliveredAt.toISOString(),
          email,
          contactName,
          subject,
          status: log.status,
        });
      }

      if (!log.deliveredAt && this.isWithinRange(log.sentAt, from, to)) {
        const mappedType = this.mapStatusToEventType(log.status);
        if (mappedType) {
          events.push({
            id: `status-${log.id}-${log.sentAt.getTime()}`,
            type: mappedType,
            occurredAt: log.sentAt.toISOString(),
            email,
            contactName,
            subject,
            status: log.status,
          });
        }
      }
    }

    for (const engagement of engagements) {
      events.push({
        id: `${engagement.engagementType}-${engagement.emailLog?.id ?? 'unknown'}-${engagement.engagedAt.getTime()}`,
        type: engagement.engagementType,
        occurredAt: engagement.engagedAt.toISOString(),
        email: engagement.emailLog.contact?.email ?? null,
        contactName: engagement.emailLog.contact?.businessName ?? null,
        subject: engagement.emailLog.emailDraft?.subjectLines?.[0] ?? null,
        status: engagement.emailLog.status,
        url: engagement.engagementType === EngagementType.click ? engagement.url ?? null : null,
      });
    }

    for (const unsubscribe of unsubscribes) {
      events.push({
        id: `unsubscribe-${unsubscribe.contactId}-${unsubscribe.unsubscribedAt.getTime()}`,
        type: 'unsubscribe',
        occurredAt: unsubscribe.unsubscribedAt.toISOString(),
        email: unsubscribe.contact?.email ?? null,
        contactName: unsubscribe.contact?.businessName ?? null,
        subject: unsubscribe.emailLog?.emailDraft?.subjectLines?.[0] ?? null,
        status: unsubscribe.emailLog?.status ?? null,
      });
    }

    return events
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }

  private buildDateBuckets(from: Date, to: Date): Record<string, EmailAnalyticsTimelinePoint> {
    const buckets: Record<string, EmailAnalyticsTimelinePoint> = {};
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);

    const end = new Date(to);
    end.setHours(0, 0, 0, 0);

    while (cursor <= end) {
      const key = this.toBucketKey(cursor);
      buckets[key] = {
        date: key,
        requests: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        spamReports: 0,
        unsubscribes: 0,
      };
      cursor.setDate(cursor.getDate() + 1);
    }

    return buckets;
  }

  private toBucketKey(date: Date): string {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized.toISOString().split('T')[0];
  }

  private isWithinRange(date: Date, from: Date, to: Date): boolean {
    return date >= from && date <= to;
  }

  private mapStatusToEventType(status: EmailLogStatus): EmailAnalyticsEvent['type'] | null {
    switch (status) {
      case EmailLogStatus.processed:
        return 'processed';
      case EmailLogStatus.deferred:
        return 'deferred';
      case EmailLogStatus.delivered:
        return 'delivered';
      case EmailLogStatus.bounced:
        return 'bounced';
      case EmailLogStatus.blocked:
        return 'blocked';
      case EmailLogStatus.dropped:
        return 'dropped';
      case EmailLogStatus.spamreport:
        return 'spamreport';
      default:
        return null;
    }
  }
}


