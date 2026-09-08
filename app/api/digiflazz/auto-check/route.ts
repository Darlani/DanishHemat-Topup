import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { providerRegistry } from '@/lib/providers/registry';
import { reconcileOrderResolution } from '@/lib/providers/reconciliation.service';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: string;
  order_id: string;
  api_ref_id: string | null;
  sku: string;
  customer_no: string;
  user_id: string | null;
  email: string | null;
  user_contact: string | null;
  payment_method: string | null;
  total_amount: number | null;
  status: string;
  category: string | null;
  product_name: string;
  price: number | null;
  used_balance: number | null;
  buy_price: number | null;
  provider_used: string | null;
  vendor_sku: string | null;
  sn?: string | null;
  updated_at?: string | null;
}

/**
 * Generic Automated Polling / Auto-Check Route.
 * URL: GET /api/digiflazz/auto-check?secret=CRON_SECRET
 *
 * Responsibilities:
 * 1. Cron secret authentication guard.
 * 2. Fetches pending in-flight orders ('Diproses', 'provider', limit 5).
 * 3. Dynamically resolves executing provider adapter from in-memory ProviderRegistry.
 * 4. Verifies adapter existence and supportsStatusCheck capability.
 * 5. Calls adapter.checkStatus(...) with standardized input.
 * 6. Handles UNKNOWN transport outcomes safely (keeps Diproses, zero refund, no fallback).
 * 7. Dispatches confirmed outcomes to centralized reconcileOrderResolution service.
 *
 * Safety & Isolation:
 * - Pure reconciliation: NEVER initiates new vendor transactions, alternate SKU, or waterfall retries.
 * - Provider disablement does NOT block in-flight order reconciliation.
 * - Unknown/unsupported providers are logged and skipped per-order without failing the entire batch.
 */
export async function GET(req: Request) {
  try {
    // 1. SATPAM API (CRON SECRET AUTH)
    const { searchParams } = new URL(req.url);
    const querySecret = searchParams.get('secret');
    const WEBHOOK_SECRET = process.env.CRON_SECRET;

    if (!WEBHOOK_SECRET || querySecret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Akses Ditolak!' }, { status: 401 });
    }

    // Ambil hanya order LIVE dari public.orders.
    const { data: pendingOrdersData, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select(
        'id, order_id, api_ref_id, sku, customer_no, user_id, email, user_contact, payment_method, total_amount, status, category, product_name, price, used_balance, buy_price, provider_used, vendor_sku, sn, updated_at'
      )
      .eq('status', 'Diproses')
      .eq('product_type', 'provider')
      .order('updated_at', { ascending: true })
      .limit(10);

    if (fetchErr || !pendingOrdersData || pendingOrdersData.length === 0) {
      return NextResponse.json({ message: 'Tidak ada pesanan yang perlu dicek.' });
    }

    const pendingOrders = pendingOrdersData as OrderRow[];
    console.log(`🕵️ [AUTO-CHECK] Memulai patroli untuk ${pendingOrders.length} pesanan...`);

    let processedCount = 0;

    // 3. LOOPING REKONSILIASI BATCH (SEKUENSIAL & TERISOLASI PER ORDER)
    for (const order of pendingOrders) {
      try {
        // Resolve executing provider code for LIVE orders only.
        // For legacy rows where provider_used is null, default narrowly to 'DIGIFLAZZ' to preserve established behavior
        const providerCode = (order.provider_used || 'DIGIFLAZZ').trim().toUpperCase();

        // 1. Resolve adapter from in-memory ProviderRegistry
        const adapter = providerRegistry.get(providerCode);
        if (!adapter) {
          console.warn(`⚠️ [AUTO-CHECK] Order ${order.order_id} has unregistered provider ${providerCode}. Skip.`);
          continue;
        }

        // 2. Capability verification: supportsStatusCheck & checkStatus method
        if (!adapter.capabilities.supportsStatusCheck || typeof adapter.checkStatus !== 'function') {
          console.warn(`⚠️ [AUTO-CHECK] Provider ${providerCode} does not support status check. Skip.`);
          continue;
        }

        // 3. Adapter configuration verification
        if (adapter.isConfigured && !adapter.isConfigured()) {
          console.warn(`⚠️ [AUTO-CHECK] Provider ${providerCode} credentials unconfigured. Skip.`);
          continue;
        }

        const targetRefId = order.api_ref_id || order.order_id;
        const targetSku = order.vendor_sku || order.sku;
        const kategori = (order.category || '').toLowerCase();
        const isPostpaid = kategori.includes('pascabayar') || kategori.includes('ppob');

        // 4. Query live vendor status
        const checkResult = await adapter.checkStatus({
          orderId: order.order_id,
          correlationRefId: targetRefId,
          vendorSku: targetSku,
          destination: order.customer_no,
          additionalMetadata: isPostpaid ? { commands: 'status-pasca' } : undefined,
        });

        // ====================================================================
        // GUARD A: UNKNOWN TRANSPORT OUTCOME (Timeout / Connection reset)
        // ====================================================================
        if (checkResult.transportOutcome === 'UNKNOWN') {
          console.log(
            `⏳ [AUTO-CHECK] Order ${order.order_id} status check menghasilkan UNKNOWN transport (${checkResult.errorMessage || 'Network timeout'}). Pertahankan Diproses.`
          );
          processedCount++;
          continue;
        }

        // ====================================================================
        // DISPATCH: Centralized Shared Domain Reconciliation
        // ====================================================================
        const reconRes = await reconcileOrderResolution(
          providerCode,
          order.order_id,
          targetRefId,
          {
            normalizedStatus: checkResult.normalizedStatus,
            serialNumber: checkResult.serialNumber,
            message: checkResult.errorMessage,
            metadata: checkResult.metadata,
            rawPayload: checkResult.rawResponse,
          }
        );

        if (!reconRes.success) {
          console.error(`🔥 [AUTO-CHECK] Rekonsiliasi gagal untuk ${order.order_id}:`, reconRes.error);
        } else {
          processedCount++;
        }
      } catch (orderLoopErr: unknown) {
        const errMsg = orderLoopErr instanceof Error ? orderLoopErr.message : String(orderLoopErr);
        console.error(`Gagal patroli order ${order.order_id}:`, errMsg);
      }
    }

    return NextResponse.json({ success: true, processed: processedCount, total: pendingOrders.length });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
