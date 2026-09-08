import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { isManagementRole } from '@/utils/serverAuth';

export const SANDBOX_SESSION_COOKIE = 'dapay_sandbox_session';

export interface OrderEnvironmentResolution {
  isSandbox: boolean;
  reason: 
    | 'GLOBAL_STORE_SANDBOX'
    | 'AUTHORIZED_TESTER_SANDBOX'
    | 'LIVE_DEFAULT'
    | 'UNAUTHORIZED_FORCED_LIVE'
    | 'MANAGEMENT_PERSONA_NON_CUSTOMER'
    | 'SYSTEM_ERROR';
}

export class OrderEnvironmentResolutionError extends Error {
  constructor(message = 'Unable to resolve order environment.') {
    super(message);
    this.name = 'OrderEnvironmentResolutionError';
  }
}

/**
 * Resolves whether an incoming transaction order should be treated as LIVE or SANDBOX.
 * 
 * Rules:
 * 0. Management Persona (Admin/Manager) NEVER enters customer Sandbox (reason: 'MANAGEMENT_PERSONA_NON_CUSTOMER').
 * 1. If global store_settings.is_live_mode is FALSE -> All customer orders target SANDBOX.
 * 2. If store_settings.is_live_mode is TRUE:
 *    - Check for active sandbox session cookie ('dapay_sandbox_session' = 'active').
 *    - If no cookie -> LIVE.
 *    - If cookie exists, verify user authority in DB:
 *      * profiles.is_tester MUST be true.
 *      * If verified -> SANDBOX.
 *      * If unverified or non-tester -> LIVE (prevents cookie tampering).
 */
export async function resolveOrderEnvironment(
  req?: Request,
  userId?: string | null
): Promise<OrderEnvironmentResolution> {
  try {
    // 0. Management Persona Guard:
    // Admin and Manager are strictly Management & QA persona, not Customer Shopping persona.
    // They must never receive a customer Sandbox environment, even if the store is globally in sandbox.
    let userProfile: { is_tester?: boolean | null; role?: string | null } | null = null;
    if (userId) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('is_tester, role')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) throw new OrderEnvironmentResolutionError('Unable to verify user profile.');
      userProfile = profile;

      if (isManagementRole(profile?.role)) {
        return { isSandbox: false, reason: 'MANAGEMENT_PERSONA_NON_CUSTOMER' };
      }
    }

    // 1. Check Global Store Mode (canonical: store_settings.is_live_mode)
    const { data: storeSettings, error: storeSettingsError } = await supabaseAdmin
      .from('store_settings')
      .select('is_live_mode')
      .limit(1)
      .single();
    if (storeSettingsError || !storeSettings) {
      throw new OrderEnvironmentResolutionError('Unable to verify store environment.');
    }

    const isGlobalLive = storeSettings?.is_live_mode ?? true;

    if (!isGlobalLive) {
      return { isSandbox: true, reason: 'GLOBAL_STORE_SANDBOX' };
    }

    // 2. If store is LIVE, check if request contains an active sandbox session
    if (!req) {
      return { isSandbox: false, reason: 'LIVE_DEFAULT' };
    }

    const cookieHeader = req.headers.get('cookie') || '';
    const hasSandboxCookie = cookieHeader
      .split(';')
      .some(c => c.trim().startsWith(`${SANDBOX_SESSION_COOKIE}=active`));

    if (!hasSandboxCookie) {
      return { isSandbox: false, reason: 'LIVE_DEFAULT' };
    }

    // 3. Cookie exists -> Verify user authority in database
    if (!userId || !userProfile) {
      // Unauthenticated user attempting to claim sandbox session -> Rejected to LIVE
      return { isSandbox: false, reason: 'UNAUTHORIZED_FORCED_LIVE' };
    }

    if (userProfile.is_tester === true) {
      return { isSandbox: true, reason: 'AUTHORIZED_TESTER_SANDBOX' };
    }

    // Account does not have is_tester privilege
    return { isSandbox: false, reason: 'UNAUTHORIZED_FORCED_LIVE' };
  } catch (err) {
    console.error('❌ [RESOLVE_ENV] Error resolving order environment:', err);
    if (err instanceof OrderEnvironmentResolutionError) throw err;
    throw new OrderEnvironmentResolutionError();
  }
}

/**
 * Ensures a sandbox wallet exists for the specified tester.
 * Automatically initializes with 1,000,000 coins if not present.
 */
export async function ensureSandboxWallet(userId: string): Promise<{ balance: number; error: string | null }> {
  try {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('sandbox_wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchErr) {
      return { balance: 0, error: fetchErr.message };
    }

    if (existing) {
      return { balance: Number(existing.balance), error: null };
    }

    // Initialize with 1,000,000
    const initialBalance = 1000000;
    const { data: created, error: insertErr } = await supabaseAdmin
      .from('sandbox_wallets')
      .insert({
        user_id: userId,
        balance: initialBalance
      })
      .select('balance')
      .single();

    if (insertErr) {
      return { balance: 0, error: insertErr.message };
    }

    // Log initial grant
    await supabaseAdmin
      .from('sandbox_balance_logs')
      .insert({
        user_id: userId,
        amount: initialBalance,
        type: 'Bonus',
        description: 'Modal awal koin virtual sandbox',
        initial_balance: 0,
        final_balance: initialBalance
      });

    return { balance: initialBalance, error: null };
  } catch (err: any) {
    return { balance: 0, error: err.message };
  }
}
