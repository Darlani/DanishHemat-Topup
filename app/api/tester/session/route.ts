import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { SANDBOX_SESSION_COOKIE, ensureSandboxWallet } from '@/lib/auth/tester';

export const dynamic = 'force-dynamic';

async function verifyToken(token: string): Promise<{ id: string; email?: string } | null> {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id, email: user.email };
}

async function getAuthenticatedUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();

  if (token) {
    return verifyToken(token);
  }

  // Fallback to cookie-based auth
  const cookieStore = req.headers.get('cookie') || '';

  // 1. Check sb-access-token cookie (used by DaPay)
  const sbAccessTokenMatch = cookieStore.match(/sb-access-token=([^;]+)/i);
  if (sbAccessTokenMatch?.[1]) {
    try {
      const raw = decodeURIComponent(sbAccessTokenMatch[1]).trim();
      return verifyToken(raw);
    } catch {
      // ignore
    }
  }

  // 2. Check sb-*-auth-token cookie (Supabase standard)
  const tokenMatch = cookieStore.match(/sb-[a-z0-9]+-auth-token=([^;]+)/i);
  if (tokenMatch && tokenMatch[1]) {
    try {
      const decoded = decodeURIComponent(tokenMatch[1]);
      let parsed = JSON.parse(decoded);
      if (Array.isArray(parsed) && parsed[0]) parsed = parsed[0];
      const rawToken = typeof parsed === 'string' ? parsed : parsed?.access_token;
      if (rawToken) {
        return verifyToken(rawToken);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * GET /api/tester/session
 * Returns current tester status, sandbox session status, and sandbox wallet balance.
 * Direct DB query in parallel ensures 100% accurate, real-time tester authorization.
 */
export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get('cookie') || '';
    const hasAuthCredential = Boolean(
      req.headers.get('authorization')?.trim()
      || /(?:^|;)\s*sb-access-token=/.test(cookieHeader)
      || /(?:^|;)\s*sb-[a-z0-9]+-auth-token=/.test(cookieHeader),
    );
    const user = await getAuthenticatedUser(req);
    if (!user) {
      if (hasAuthCredential) {
        return NextResponse.json({ error: 'Autentikasi tidak valid.' }, { status: 401 });
      }
      return NextResponse.json({ 
        authenticated: false, 
        isTester: false, 
        isSandboxActive: false,
        sandboxBalance: 0 
      });
    }

    const hasSandboxCookie = cookieHeader
      .split(';')
      .some(c => c.trim().startsWith(`${SANDBOX_SESSION_COOKIE}=active`));

    // Parallel direct DB query: zero stale cache risk
    const [profileRes, walletRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('is_tester, role')
        .eq('id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('sandbox_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle()
    ]);

    if (profileRes.error || walletRes.error) {
      return NextResponse.json({ error: 'Tidak dapat memverifikasi status Sandbox.' }, { status: 503 });
    }

    const userRole = (profileRes.data?.role || '').trim().toLowerCase();
    const isStaff = userRole === 'admin' || userRole === 'manager';
    // STRICT PERSONA SEPARATION:
    // Admin and Manager are strictly Management & QA persona, never Customer Shopping Persona.
    const isTester = !isStaff && profileRes.data?.is_tester === true;
    let sandboxBalance = Number(walletRes.data?.balance || 0);

    if (isTester && !walletRes.data) {
      const walletEnsured = await ensureSandboxWallet(user.id);
      sandboxBalance = walletEnsured.balance;
    }

    return NextResponse.json({
      authenticated: true,
      userId: user.id,
      isTester,
      isSandboxActive: isTester && hasSandboxCookie,
      sandboxBalance
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tester/session
 * Explicitly Opt-In: Enables Sandbox Session for 1 hour.
 * Protected: Requires profiles.is_tester === true and role !== admin/manager.
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Autentikasi diperlukan.' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_tester, role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: 'Tidak dapat memverifikasi akses tester.' }, { status: 503 });
    }

    const role = (profile?.role || '').trim().toLowerCase();
    if (role === 'admin' || role === 'manager') {
      return NextResponse.json(
        { error: 'Akses Ditolak: Akun Admin/Manager tidak diperkenankan mengaktifkan sesi belanja tester konsumen. Gunakan Sandbox Test Center untuk pengujian.' },
        { status: 403 }
      );
    }

    if (profile?.is_tester !== true) {
      return NextResponse.json(
        { error: 'Akses Ditolak: Akun Anda belum memiliki izin tester (profiles.is_tester = false).' },
        { status: 403 }
      );
    }

    // Ensure sandbox wallet exists
    const walletRes = await ensureSandboxWallet(user.id);

    const response = NextResponse.json({
      success: true,
      message: 'Mode Sandbox aktif untuk sesi ini (berlaku 1 jam).',
      sandboxBalance: walletRes.balance
    });

    // Set HttpOnly cookie valid for 1 hour (3600 seconds)
    response.cookies.set(SANDBOX_SESSION_COOKIE, 'active', {
      httpOnly: false, // Accessible by UI to display alert banner, but verified securely server-side
      path: '/',
      maxAge: 3600,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/tester/session
 * Instant Disarm: Deactivates Sandbox Session and returns immediately to LIVE.
 */
export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    message: 'Mode Sandbox dinonaktifkan. Anda kembali ke Mode LIVE.'
  });

  response.cookies.set(SANDBOX_SESSION_COOKIE, '', {
    path: '/',
    maxAge: 0,
    sameSite: 'lax'
  });

  return response;
}
