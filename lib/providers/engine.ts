import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { providerRegistry, ProviderRegistry } from './registry';
import type {
  GenericExecutionInput,
  GenericExecutionResult,
  IProviderAdapter,
  TransportOutcome,
} from './types';

/**
 * Execution candidate representing an eligible source item mapped to a canonical product.
 */
export interface ExecutionCandidate {
  readonly provider: string;
  readonly sku: string;
  readonly name: string;
  readonly modal: number;
  readonly productAutomaticId: string;
  readonly zonaType?: string | null;
  readonly subBrandSlug?: string | null;
}

/**
 * Engine execution summary returned to server-side callers.
 */
export interface EngineExecutionResult {
  readonly success: boolean;
  readonly status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'CLAIM_REJECTED' | 'NO_CANDIDATES';
  readonly orderId: string;
  readonly winningProvider?: string | null;
  readonly winningSku?: string | null;
  readonly apiRefId?: string | null;
  readonly serialNumber?: string | null;
  readonly attemptsMade: number;
  readonly error?: string | null;
  readonly isRetryable?: boolean;
  readonly rawResponse?: unknown;
}

/**
 * Filter options for candidate resolution.
 */
export interface CandidateFilterOptions {
  readonly requirePrepaid?: boolean;
  readonly requirePostpaid?: boolean;
}

/**
 * Extracts User ID and optional Zone ID from raw customer destination string.
 * Common game formats: "12345678(1234)", "12345678 1234", "12345678|1234".
 */
export function parseDestinationParts(raw: string): {
  destination: string;
  userId?: string;
  zoneId?: string;
} {
  const trimmed = (raw || '').trim();
  const parenMatch = trimmed.match(/^(\d+)\s*\((.+)\)$/);
  if (parenMatch) {
    return { destination: trimmed, userId: parenMatch[1], zoneId: parenMatch[2] };
  }
  const spaceMatch = trimmed.match(/^(\d+)\s+([a-zA-Z0-9_-]+)$/);
  if (spaceMatch) {
    return { destination: trimmed, userId: spaceMatch[1], zoneId: spaceMatch[2] };
  }
  const pipeMatch = trimmed.match(/^(\d+)\|([a-zA-Z0-9_-]+)$/);
  if (pipeMatch) {
    return { destination: trimmed, userId: pipeMatch[1], zoneId: pipeMatch[2] };
  }
  return { destination: trimmed, userId: trimmed };
}

/**
 * Generic Provider Execution Engine for DaPay.
 *
 * Orchestrates multi-provider execution independently from vendor-specific logic:
 * 1. Canonical product source resolution
 * 2. Multi-provider operational eligibility verification
 * 3. Economic candidate sorting (modal ASC)
 * 4. Atomic order claiming & duplicate-execution prevention
 * 5. Waterfall retry orchestration with transport outcome safety
 * 6. Provider attribution preservation (provider_used & vendor_sku)
 */
export class ProviderExecutionEngine {
  constructor(
    private supabase = supabaseAdmin,
    private registry: ProviderRegistry = providerRegistry,
  ) {}

  /**
   * Resolves eligible execution candidates for a canonical product, ordered by modal ASC.
   * Enforces all operational eligibility gates without provider coupling:
   * - items.is_active = true
   * - public.providers.is_enabled = true
   * - public.providers.is_execution_enabled = true
   * - public.providers.is_maintenance = false
   * - Code adapter registered in ProviderRegistry
   * - Adapter configured (adapter.isConfigured() === true)
   * - Functional capability matching (prepaid / postpaid)
   */
  async resolveCandidates(
    productAutomaticId: string,
    options?: CandidateFilterOptions,
  ): Promise<ExecutionCandidate[]> {
    if (!productAutomaticId) return [];

    // 1. Fetch active source items mapped to canonical product
    const { data: items, error: itemsErr } = await this.supabase
      .from('product_providers_items')
      .select('provider, sku, name, modal, product_automatic_id, zona_type, sub_brand_slug, is_active')
      .eq('product_automatic_id', productAutomaticId)
      .eq('is_active', true);

    if (itemsErr || !items || items.length === 0) {
      return [];
    }

    // 2. Fetch operational status from database provider registry
    const providerCodes = Array.from(new Set(items.map((i) => i.provider?.toUpperCase()).filter(Boolean)));
    const { data: dbProviders, error: dbProvErr } = await this.supabase
      .from('providers')
      .select('code, is_enabled, is_execution_enabled, is_maintenance')
      .in('code', providerCodes);

    if (dbProvErr) {
      console.error('[ExecutionEngine] Failed to query providers registry:', dbProvErr.message);
      return [];
    }

    const dbProviderMap = new Map(
      (dbProviders || []).map((p) => [p.code.toUpperCase(), p]),
    );

    // 3. Evaluate operational eligibility for each candidate
    const eligibleCandidates: ExecutionCandidate[] = [];

    for (const item of items) {
      if (!item.provider || !item.sku) continue;
      const code = item.provider.toUpperCase();

      // Gate A: Database operational switches
      const dbStatus = dbProviderMap.get(code);
      if (!dbStatus) continue;
      if (!dbStatus.is_enabled || !dbStatus.is_execution_enabled || dbStatus.is_maintenance) {
        continue;
      }

      // Gate B: Code-level adapter availability
      const adapter = this.registry.get(code);
      if (!adapter) continue;

      // Gate C: Adapter-level credential/configuration check (provider-neutral)
      if (adapter.isConfigured && !adapter.isConfigured()) {
        continue;
      }

      // Gate D: Functional capability matching
      if (options?.requirePrepaid && !adapter.capabilities.supportsPrepaid) {
        continue;
      }
      if (options?.requirePostpaid && !adapter.capabilities.supportsPostpaid) {
        continue;
      }

      eligibleCandidates.push({
        provider: code,
        sku: item.sku,
        name: item.name,
        modal: Number(item.modal) || 0,
        productAutomaticId: item.product_automatic_id,
        zonaType: item.zona_type,
        subBrandSlug: item.sub_brand_slug,
      });
    }

    // 4. Sort strictly by economic cost: modal ASC (cheapest first)
    eligibleCandidates.sort((a, b) => a.modal - b.modal);

    return eligibleCandidates;
  }

  /**
   * Reconciles a confirmed terminal failure through the atomic refund primitive.
   * Ensures status -> 'Gagal', wallet refund, and balance_logs are executed atomically by DB.
   * If the RPC errors or returns false, does NOT force status to 'Gagal'.
   */
  private async failAndRefundOrder(
    orderId: string,
    reason: string,
    apiRefId?: string,
  ): Promise<boolean> {
    if (apiRefId) {
      await this.supabase
        .from('orders')
        .update({ api_ref_id: apiRefId, updated_at: new Date().toISOString() })
        .eq('id', orderId);
    }

    const { data: refundSuccess, error: rpcErr } = await this.supabase.rpc(
      'refund_failed_order_atomic',
      {
        p_order_id: orderId,
        p_reason: reason,
      },
    );

    if (rpcErr) {
      console.error(
        `[ExecutionEngine] Failed RPC refund_failed_order_atomic for order ${orderId}:`,
        rpcErr.message,
      );
      // DO NOT force status: 'Gagal' on RPC error!
      // Keep order in Diproses so it can still be safely reconciled by webhook/auto-check.
      return false;
    }

    if (refundSuccess !== true) {
      console.warn(
        `[ExecutionEngine] refund_failed_order_atomic returned false for order ${orderId} (already resolved or ineligible).`,
      );
      return false;
    }

    return true;
  }

  /**
   * Generates deterministic correlation reference ID.
   * Attempt 1: "INV-123"
   * Attempt 2: "INV-123-R2"
   * Attempt 3: "INV-123-R3"
   */
  buildCorrelationRefId(orderId: string, attemptNumber: number): string {
    if (attemptNumber <= 1) return orderId;
    return `${orderId}-R${attemptNumber}`;
  }

  /**
   * Executes an order through the multi-provider waterfall orchestration.
   */
  async executeOrder(orderIdentifier: string): Promise<EngineExecutionResult> {
    if (!orderIdentifier) {
      return {
        success: false,
        status: 'FAILED',
        orderId: '',
        attemptsMade: 0,
        error: 'Order identifier is required.',
      };
    }

    // 1. Fetch Order Record
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdentifier);
    const query = this.supabase
      .from('orders')
      .select('id, order_id, sku, status, customer_no, category, price, buy_price, raw_tagihan, customer_name, segment_power, stand_meter, desc, api_ref_id, provider_used, updated_at');

    const { data: order, error: orderErr } = isUuid
      ? await query.eq('id', orderIdentifier).maybeSingle()
      : await query.eq('order_id', orderIdentifier).maybeSingle();

    if (orderErr || !order) {
      return {
        success: false,
        status: 'FAILED',
        orderId: orderIdentifier,
        attemptsMade: 0,
        error: orderErr ? orderErr.message : 'Order not found.',
      };
    }

    // 2. State Guard: Must be executable (Pending or Diproses)
    if (order.status !== 'Pending' && order.status !== 'Diproses') {
      return {
        success: false,
        status: 'FAILED',
        orderId: order.order_id,
        attemptsMade: 0,
        error: `Order is in terminal state '${order.status}' and cannot be executed.`,
      };
    }

    // Guard against re-executing orders already under active vendor processing
    if (order.status === 'Diproses' && order.provider_used && order.api_ref_id) {
      return {
        success: false,
        status: 'CLAIM_REJECTED',
        orderId: order.order_id,
        attemptsMade: 0,
        error: `Order is already in active processing with provider ${order.provider_used} (ref: ${order.api_ref_id}). Awaiting webhook or status check.`,
      };
    }

    // 3. Concurrency Guard: Atomic Claim via Row-Lock Conditional Update
    const claimTime = new Date().toISOString();
    let claimQuery = this.supabase
      .from('orders')
      .update({
        status: 'Diproses',
        updated_at: claimTime,
      })
      .eq('id', order.id);

    if (order.status === 'Pending') {
      claimQuery = claimQuery.eq('status', 'Pending');
    } else {
      // Order is already Diproses but not yet dispatched to a provider (provider_used is null): claim via OCC
      claimQuery = claimQuery
        .eq('status', 'Diproses')
        .is('provider_used', null)
        .eq('updated_at', order.updated_at);
    }

    const { data: claimed, error: claimErr } = await claimQuery
      .select('id, order_id, status, updated_at')
      .maybeSingle();

    if (claimErr || !claimed) {
      return {
        success: false,
        status: 'CLAIM_REJECTED',
        orderId: order.order_id,
        attemptsMade: 0,
        error: 'Failed to obtain execution ownership: order was claimed or modified by another concurrent process.',
      };
    }

    // 4. Resolve Canonical Product Identity
    const { data: mainProd, error: prodErr } = await this.supabase
      .from('product_automatic')
      .select('id, name, brand, sku')
      .eq('sku', order.sku)
      .maybeSingle();

    if (prodErr || !mainProd) {
      await this.failAndRefundOrder(
        order.id,
        'Canonical product not found in catalog for this order SKU.',
      );

      return {
        success: false,
        status: 'FAILED',
        orderId: order.order_id,
        attemptsMade: 0,
        error: 'Canonical product not found in catalog for this order SKU.',
      };
    }

    // 5. Determine capability requirements
    const categoryLower = (order.category || '').toLowerCase();
    const isPostpaid = categoryLower.includes('pascabayar') || categoryLower.includes('pln pasca');

    // 6. Resolve eligible candidates sorted by modal ASC
    const candidates = await this.resolveCandidates(mainProd.id, {
      requirePrepaid: !isPostpaid,
      requirePostpaid: isPostpaid,
    });

    if (candidates.length === 0) {
      await this.failAndRefundOrder(
        order.id,
        'No active eligible provider source found for this product.',
      );

      return {
        success: false,
        status: 'NO_CANDIDATES',
        orderId: order.order_id,
        attemptsMade: 0,
        error: 'No active eligible provider source found for this product.',
      };
    }

    // 7. Establish attempt sequence
    let currentAttempt = 1;
    const match = order.api_ref_id?.match(/-R(\d+)$/);
    if (match) {
      currentAttempt = parseInt(match[1], 10);
    }

    // 8. Waterfall Execution Loop
    let attemptIndex = currentAttempt - 1;
    let attemptsCount = 0;
    const dest = parseDestinationParts(order.customer_no || '');

    while (attemptIndex < candidates.length) {
      attemptsCount++;
      const candidate = candidates[attemptIndex];
      const attemptNumber = attemptIndex + 1;
      const correlationRefId =
        attemptNumber === 1 && order.api_ref_id
          ? order.api_ref_id
          : this.buildCorrelationRefId(order.order_id, attemptNumber);

      const adapter: IProviderAdapter | undefined = this.registry.get(candidate.provider);
      if (!adapter) {
        attemptIndex++;
        continue;
      }

      // MANDATORY NEW ATTEMPT INVARIANT:
      // Establish new active attempt and EXPLICITLY CLEAR provider_ref_id to NULL
      // BEFORE dispatching adapter.executeTransaction().
      const { error: prepErr } = await this.supabase
        .from('orders')
        .update({
          status: 'Diproses',
          api_ref_id: correlationRefId,
          provider_used: candidate.provider,
          vendor_sku: candidate.sku,
          provider_ref_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      if (prepErr) {
        console.error(
          `[ExecutionEngine] Pre-dispatch persistence failed for order ${order.order_id} candidate ${candidate.provider}:`,
          prepErr.message,
        );
        // DO NOT call provider, DO NOT fallback, DO NOT refund.
        // Order remains in Diproses awaiting manual review or subsequent reconciliation.
        return {
          success: false,
          status: 'FAILED',
          orderId: order.order_id,
          winningProvider: candidate.provider,
          winningSku: candidate.sku,
          apiRefId: correlationRefId,
          attemptsMade: attemptsCount,
          isRetryable: false,
          error: `Pre-dispatch attempt persistence failed: ${prepErr.message}`,
        };
      }

      const input: GenericExecutionInput = {
        orderId: order.order_id,
        attemptNumber,
        correlationRefId,
        vendorSku: candidate.sku,
        destination: dest.destination,
        destinationUserId: dest.userId,
        destinationZoneId: dest.zoneId,
        customerName: order.customer_name || undefined,
        segmentPower: order.segment_power || undefined,
        amount: Number(order.price) || undefined,
        productName: mainProd.name,
        category: order.category || undefined,
      };

      let result: GenericExecutionResult;
      let transportOutcome: TransportOutcome = 'CONFIRMED_RESPONSE';

      try {
        result = await adapter.executeTransaction(input);
        if (result.transportOutcome) {
          transportOutcome = result.transportOutcome;
        }
      } catch (adapterErr) {
        console.error(
          `[ExecutionEngine] Transport or network exception on candidate ${candidate.provider}:${candidate.sku}:`,
          adapterErr,
        );
        transportOutcome = 'UNKNOWN';
        result = {
          normalizedStatus: 'PENDING',
          rawStatus: 'NETWORK_TIMEOUT',
          errorMessage: adapterErr instanceof Error ? adapterErr.message : 'Network transport error or timeout',
          retryClassification: 'RETRYABLE',
          transportOutcome: 'UNKNOWN',
        };
      }

      // CRITICAL FINANCIAL SAFETY GUARD: UNKNOWN TRANSPORT OUTCOME
      if (transportOutcome === 'UNKNOWN') {
        // The transaction may have reached the vendor and deducted balance.
        // NEVER fall back to another provider! STOP WATERFALL IMMEDIATELY!
        // UNKNOWN transport: never fabricate providerReference, never clear existing current-attempt reference,
        // never fallback, never refund.
        await this.supabase
          .from('orders')
          .update({
            status: 'Diproses',
            sn: 'Menunggu Verifikasi Jaringan Vendor',
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        return {
          success: false,
          status: 'PENDING',
          orderId: order.order_id,
          winningProvider: candidate.provider,
          winningSku: candidate.sku,
          apiRefId: correlationRefId,
          serialNumber: 'Menunggu Verifikasi Jaringan Vendor',
          attemptsMade: attemptsCount,
          isRetryable: false,
          error: 'Network timeout / transport ambiguity. Waterfall halted to prevent double-charge. Awaiting webhook or status inquiry.',
          rawResponse: result.rawResponse,
        };
      }

      // Resolve buy_price: For postpaid, maintain dynamic bill cost from order; for prepaid use candidate modal
      const effectiveBuyPrice = isPostpaid
        ? (order.buy_price ?? candidate.modal)
        : candidate.modal;

      // Build metadata update payload for SUCCESS / PENDING
      const metadataPayload: Record<string, unknown> = {};
      if (result.metadata) {
        if (typeof result.metadata.customer_name === 'string' && result.metadata.customer_name) {
          metadataPayload.customer_name = result.metadata.customer_name;
        }
        if (typeof result.metadata.segment_power === 'string' && result.metadata.segment_power) {
          metadataPayload.segment_power = result.metadata.segment_power;
        }
        if (typeof result.metadata.stand_meter === 'string' && result.metadata.stand_meter) {
          metadataPayload.stand_meter = result.metadata.stand_meter;
        }
        if (typeof result.metadata.raw_tagihan === 'number') {
          metadataPayload.raw_tagihan = result.metadata.raw_tagihan;
        }
        if (result.metadata.desc) {
          metadataPayload.desc = typeof result.metadata.desc === 'string'
            ? result.metadata.desc
            : JSON.stringify(result.metadata.desc);
        }
      }

      // SAME ATTEMPT REFERENCE HANDLING:
      // providerReference present -> write/update provider_ref_id
      // providerReference absent -> DO NOT overwrite provider_ref_id
      const providerRefUpdate: Record<string, unknown> = {};
      if (typeof result.providerReference === 'string' && result.providerReference.trim().length > 0) {
        providerRefUpdate.provider_ref_id = result.providerReference.trim();
      }

      // CASE A: SUCCESS (Vendor immediate completion)
      if (result.normalizedStatus === 'SUCCESS') {
        await this.supabase
          .from('orders')
          .update({
            status: 'Berhasil',
            sn: result.serialNumber || 'SN-TERBIT',
            buy_price: effectiveBuyPrice,
            updated_at: new Date().toISOString(),
            ...metadataPayload,
            ...providerRefUpdate,
          })
          .eq('id', order.id);

        return {
          success: true,
          status: 'SUCCESS',
          orderId: order.order_id,
          winningProvider: candidate.provider,
          winningSku: candidate.sku,
          apiRefId: correlationRefId,
          serialNumber: result.serialNumber,
          attemptsMade: attemptsCount,
          rawResponse: result.rawResponse,
        };
      }

      // CASE B: PENDING (Vendor accepted into queue/processing)
      if (result.normalizedStatus === 'PENDING') {
        await this.supabase
          .from('orders')
          .update({
            status: 'Diproses',
            sn: result.serialNumber || 'Proses di Vendor',
            buy_price: effectiveBuyPrice,
            updated_at: new Date().toISOString(),
            ...metadataPayload,
            ...providerRefUpdate,
          })
          .eq('id', order.id);

        // DO NOT retry a pending transaction with another supplier!
        return {
          success: true,
          status: 'PENDING',
          orderId: order.order_id,
          winningProvider: candidate.provider,
          winningSku: candidate.sku,
          apiRefId: correlationRefId,
          serialNumber: result.serialNumber,
          attemptsMade: attemptsCount,
          rawResponse: result.rawResponse,
        };
      }

      // CASE C: FAILED
      if (result.retryClassification === 'NON_RETRYABLE') {
        // Terminal customer error: abort waterfall immediately and reconcile failure atomically
        await this.failAndRefundOrder(
          order.id,
          result.errorMessage || 'Transaction rejected by vendor with terminal status.',
          correlationRefId,
        );

        return {
          success: false,
          status: 'FAILED',
          orderId: order.order_id,
          attemptsMade: attemptsCount,
          isRetryable: false,
          error: result.errorMessage || 'Transaction rejected by vendor with terminal status.',
          rawResponse: result.rawResponse,
        };
      }

      // RETRYABLE failure: advance to next candidate
      attemptIndex++;
    }

    // 9. All Candidates Exhausted: reconcile failure atomically
    await this.failAndRefundOrder(
      order.id,
      'All eligible provider candidates failed or were exhausted.',
    );

    return {
      success: false,
      status: 'FAILED',
      orderId: order.order_id,
      attemptsMade: attemptsCount,
      isRetryable: false,
      error: 'All eligible provider candidates failed or were exhausted.',
    };
  }
}

/**
 * Global singleton instance of the generic execution engine.
 */
export const providerExecutionEngine = new ProviderExecutionEngine();
