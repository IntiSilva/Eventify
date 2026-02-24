/**
 * BACKFILL SCRIPT: Link existing payments to RSVPs
 * 
 * Purpose:
 * This script links created payments to their corresponding RSVPs.
 * It's safe to run multiple times (idempotent).
 * 
 * Usage:
 * npx tsx src/scripts/backfill-payment-rsvp-links.ts
 * 
 * What it does:
 * 1. Finds all succeeded payments without an rsvpId
 * 2. Matches them to RSVPs by (eventId, userId)
 * 3. Links the payment to the RSVP
 * 4. Generates a detailed audit report
 * 5. Flags any orphaned records for manual review
 */

import { prisma } from '@/lib/prisma';
import { PaymentStatus } from '@/generated/prisma';
import * as fs from 'fs/promises';
import * as path from 'path';

interface BackfillResult {
  paymentId: string;
  eventId: string;
  userId: string;
  rsvpId?: string | null;
  status: 'linked' | 'orphaned' | 'error';
  message: string;
}

interface BackfillReport {
  timestamp: string;
  duration: number;
  summary: {
    totalPayments: number;
    linkedCount: number;
    orphanedCount: number;
    errorCount: number;
  };
  results: BackfillResult[];
  warnings: string[];
  nextSteps: string[];
}

async function backfillPaymentRsvpLinks(): Promise<BackfillReport> {
  const startTime = Date.now();
  const results: BackfillResult[] = [];
  const warnings: string[] = [];

  console.log('[BACKFILL] Starting payment-RSVP linkage backfill...');

  try {
    // Step 1: Get all succeeded payments without rsvpId
    console.log('[BACKFILL] Querying unlinked succeeded payments...');
    const unlinkedPayments = await prisma.payment.findMany({
      where: {
        status: PaymentStatus.succeeded,
        rsvpId: null,
      },
      select: {
        id: true,
        eventId: true,
        userId: true,
      },
    });

    console.log(`[BACKFILL] Found ${unlinkedPayments.length} unlinked payments`);

    // Step 2: For each payment, find matching RSVP and link
    for (const payment of unlinkedPayments) {
      try {
        const rsvp = await prisma.rSVP.findUnique({
          where: {
            userId_eventId: {
              userId: payment.userId,
              eventId: payment.eventId,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (rsvp) {
          // Link the payment to the RSVP
          await prisma.payment.update({
            where: { id: payment.id },
            data: { rsvpId: rsvp.id },
          });

          results.push({
            paymentId: payment.id,
            eventId: payment.eventId,
            userId: payment.userId,
            rsvpId: rsvp.id,
            status: 'linked',
            message: `Linked to RSVP (status: ${rsvp.status})`,
          });

          console.log(`[BACKFILL] ✓ Linked payment ${payment.id} to RSVP ${rsvp.id}`);
        } else {
          // No matching RSVP found
          results.push({
            paymentId: payment.id,
            eventId: payment.eventId,
            userId: payment.userId,
            status: 'orphaned',
            message: 'No matching RSVP found for this user+event',
          });

          warnings.push(
            `Orphaned payment: ${payment.id} (user: ${payment.userId}, event: ${payment.eventId})`
          );

          console.log(
            `[BACKFILL] ⚠ Orphaned payment ${payment.id}: no RSVP found`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          paymentId: payment.id,
          eventId: payment.eventId,
          userId: payment.userId,
          status: 'error',
          message: `Error during linkage: ${errMsg}`,
        });

        warnings.push(
          `Error processing payment ${payment.id}: ${errMsg}`
        );

        console.error(`[BACKFILL] ✗ Error linking payment ${payment.id}:`, err);
      }
    }

    // Step 3: Check for opposite case: RSVPs on paid events without a Payment
    console.log('[BACKFILL] Checking for RSVPs on paid events without payments...');
    const orphanedRsvps = await prisma.rSVP.findMany({
      where: {
        event: {
          isPaid: true,
        },
        NOT: {
          payments: {
            some: {
              status: PaymentStatus.succeeded,
            },
          },
        },
      },
      select: {
        id: true,
        eventId: true,
        userId: true,
        status: true,
      },
    });

    if (orphanedRsvps.length > 0) {
      warnings.push(
        `Found ${orphanedRsvps.length} RSVPs on paid events without succeeded payments. These may be legacy entries or manual admin additions. Review manually.`
      );
      console.log(
        `[BACKFILL] ⚠ Found ${orphanedRsvps.length} RSVPs without payments`
      );
    }

    const duration = Date.now() - startTime;
    const report: BackfillReport = {
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalPayments: unlinkedPayments.length,
        linkedCount: results.filter((r) => r.status === 'linked').length,
        orphanedCount: results.filter((r) => r.status === 'orphaned').length,
        errorCount: results.filter((r) => r.status === 'error').length,
      },
      results,
      warnings: [...warnings, ...(`Found ${orphanedRsvps.length} RSVPs without payments` ? [] : [])],
      nextSteps: [
        'Review the audit report above',
        'If orphaned count > 0: manually investigate those records',
        'If error count > 0: fix the errors and re-run this script',
        'Verify data integrity by spot-checking 10 random payment-RSVP links',
        'Once satisfied, deployment can proceed',
      ],
    };

    // Save report to file
    const reportPath = path.join(process.cwd(), `backfill-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`[BACKFILL] Report saved to ${reportPath}`);

    return report;
  } catch (err) {
    console.error('[BACKFILL] Fatal error during backfill:', err);
    throw err;
  }
}

// Main entry point
async function main() {
  try {
    const report = await backfillPaymentRsvpLinks();

    console.log('\n' + '='.repeat(70));
    console.log('BACKFILL REPORT');
    console.log('='.repeat(70));
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Duration: ${report.duration}ms`);
    console.log('\nSummary:');
    console.log(`  Total unlinked payments found: ${report.summary.totalPayments}`);
    console.log(`  Successfully linked: ${report.summary.linkedCount}`);
    console.log(`  Orphaned (no matching RSVP): ${report.summary.orphanedCount}`);
    console.log(`  Errors: ${report.summary.errorCount}`);

    if (report.warnings.length > 0) {
      console.log('\nWarnings:');
      report.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    console.log('\nNext Steps:');
    report.nextSteps.forEach((step) => console.log(`  - ${step}`));

    console.log('\nDetailed results saved to:');
    const reportPath = path.join(process.cwd(), `backfill-report-${report.timestamp.replace(/[:.]/g, '-')}.json`);
    console.log(`  ${reportPath}`);

    process.exit(report.summary.errorCount > 0 ? 1 : 0);
  } catch (err) {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
