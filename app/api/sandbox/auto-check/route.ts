import { NextResponse } from 'next/server';
import { sandboxExecutionSimulator } from '@/lib/providers/sandbox/simulator';
import { supabaseAdmin } from '@/utils/supabaseAdmin';

export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 10;

interface SandboxOrderRow {
  id: string;
  order_id: string;
  customer_no: string | null;
  user_id: string | null;
  email: string | null;
  used_balance: number | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const querySecret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || querySecret !== cronSecret) {
    return NextResponse.json({ error: 'Akses Ditolak!' }, { status: 401 });
  }

  const { data: orders, error: fetchError } = await supabaseAdmin
    .from('sandbox_orders')
    .select('id, order_id, customer_no, user_id, email, used_balance')
    .eq('status', 'Diproses')
    .eq('product_type', 'provider')
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchError) {
    return NextResponse.json({ error: 'Gagal mengambil pesanan Sandbox.' }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ message: 'Tidak ada pesanan Sandbox yang perlu diproses.', processedCount: 0 });
  }

  let processedCount = 0;
  const failures: string[] = [];

  for (const order of orders as SandboxOrderRow[]) {
    try {
      const result = await sandboxExecutionSimulator.resolveSandboxOrder({
        id: order.id,
        order_id: order.order_id,
        customer_no: order.customer_no,
        user_id: order.user_id,
        user_email: order.email,
        used_balance: order.used_balance,
      });

      if (result.resolved) processedCount += 1;
    } catch (error) {
      failures.push(order.order_id);
      console.error('[SANDBOX-AUTO-CHECK] Failed to process order:', error);
    }
  }

  return NextResponse.json({
    processedCount,
    failedCount: failures.length,
  });
}
