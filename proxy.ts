import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

type IpCheckResult = {
  isBlocked: boolean;
  response?: NextResponse;
};

type AuthCheckResult = {
  requiresAction: boolean;
  response?: NextResponse;
};

function generateRequestNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildPrototypeCsp(nonce: string): string {
  const scriptSources = process.env.NODE_ENV === 'production'
    ? `'self' 'unsafe-inline' 'nonce-${nonce}' https://challenges.cloudflare.com`
    : `'self' 'unsafe-eval' 'unsafe-inline' 'nonce-${nonce}' https://challenges.cloudflare.com`;

  return `script-src ${scriptSources}; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://ptdezfwyamskazfwswxh.supabase.co wss://ptdezfwyamskazfwswxh.supabase.co https://challenges.cloudflare.com https://api.ipify.org;`;
}

/**
 * Validasi IP pengunjung terhadap database blacklist (PostgREST).
 * Fail-open jika terjadi kendala koneksi DB agar tidak menyebabkan downtime massal.
 */
async function checkBlockedIp(
  ip: string,
  isStaticPath: boolean
): Promise<IpCheckResult> {
  if (isStaticPath || ip === 'IP_Tidak_Diketahui') {
    return { isBlocked: false };
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // KITA TANYA KOLOM SPESIFIK SAJA (?select=ip_address), BUKAN SELECT * AGAR RINGAN
    const res = await fetch(`${supabaseUrl}/rest/v1/blocked_ips?ip_address=eq.${ip}&select=ip_address`, {
      headers: {
        'apikey': supabaseKey!,
        'Authorization': `Bearer ${supabaseKey!}`,
      },
      // Cache hasil pencarian 60 detik agar tidak nembak DB terus-terusan tiap ganti halaman
      next: { revalidate: 60 },
    });

    const data = await res.json();

    // Jika IP ditemukan di tabel blacklist, tendang paksa!
    if (data && data.length > 0) {
      return {
        isBlocked: true,
        response: new NextResponse(
          JSON.stringify({
            error: 'Akses Ditolak',
            message: 'IP Anda telah diblokir secara permanen dari server DaPay karena aktivitas mencurigakan.',
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        ),
      };
    }
  } catch (error) {
    // Jika ada masalah koneksi DB, biarkan lewat agar web tidak down massal
    console.error('Gagal cek blacklist IP:', error);
  }

  return { isBlocked: false };
}

/**
 * Validasi token autentikasi Supabase dan otorisasi role pengguna.
 */
async function validateAuthRoute(
  request: NextRequest,
  isAdminRoute: boolean,
  isUserRoute: boolean
): Promise<AuthCheckResult> {
  if (!isAdminRoute && !isUserRoute) {
    return { requiresAction: false };
  }

  const token = request.cookies.get('sb-access-token')?.value;

  // Jika tidak ada token di cookie sama sekali, lempar ke login
  if (!token) {
    return {
      requiresAction: true,
      response: NextResponse.redirect(new URL('/login', request.url)),
    };
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Validasi token asli langsung ke server Supabase (Edge-compatible)
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseKey!,
      },
    });

    // Jika response tidak ok (token hangus, palsu, atau kedaluwarsa)
    if (!res.ok) {
      // Hapus paksa cookie dan lempar ke halaman login dengan sinyal 'expired'
      const response = NextResponse.redirect(new URL('/login?session=expired', request.url));

      // Bersihkan cookie kustom dan seluruh cookie auth bawaan Supabase agar browser bersih total
      response.cookies.delete('sb-access-token');
      response.cookies.delete('sb-refresh-token'); // Tambahkan ini untuk mencegah error "Refresh Token Not Found"
      response.cookies.delete('userRole');

      return {
        requiresAction: true,
        response,
      };
    }

    const authUser = (await res.json()) as { id?: string };

    if (isAdminRoute) {
      if (!authUser.id) {
        return {
          requiresAction: true,
          response: NextResponse.redirect(new URL('/user', request.url)),
        };
      }

      const profileResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role`,
        {
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );

      if (!profileResponse.ok) {
        return {
          requiresAction: true,
          response: NextResponse.redirect(new URL('/user', request.url)),
        };
      }

      const profiles = (await profileResponse.json()) as Array<{ id?: string; role?: string | null }>;
      const role = profiles[0]?.role?.trim().toLowerCase();

      if (role !== 'manager' && role !== 'admin') {
        return {
          requiresAction: true,
          response: NextResponse.redirect(new URL('/user', request.url)),
        };
      }
    }

    // Jika mengakses /user, semua role (termasuk admin/member) boleh lewat selama token valid
    return { requiresAction: false };
  } catch (error) {
    console.error('Gagal validasi token:', error);
    return {
      requiresAction: true,
      response: NextResponse.redirect(new URL('/login', request.url)),
    };
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Ambil IP pengunjung dari header (Anti-Proxy)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : (request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'IP_Tidak_Diketahui');

  // 2. Bypass jalur statis (gambar, CSS) agar render UI tetap wus wus di bawah 200ms
  const isStaticPath = pathname.startsWith('/_next') || pathname.includes('.');

  // 3. Deteksi rute protected
  const isAdminRoute = pathname.startsWith('/admin');
  const isUserRoute = pathname.startsWith('/user');

  // =========================================================================
  // CONCURRENT FETCH / VALIDATION PHASE
  // =========================================================================
  const [ipResult, authResult] = await Promise.all([
    checkBlockedIp(ip, isStaticPath),
    validateAuthRoute(request, isAdminRoute, isUserRoute),
  ]);

  // =========================================================================
  // DETERMINISTIC SECURITY DECISION PHASE
  // =========================================================================

  // 1. Prioritas Utama: Blacklist IP (403 Forbidden)
  if (ipResult.isBlocked && ipResult.response) {
    return ipResult.response;
  }

  // 2. Prioritas Kedua: Autentikasi & Otorisasi Rute
  if (authResult.requiresAction && authResult.response) {
    return authResult.response;
  }

  // 3. Izin Akses
  if (process.env.DAPAY_NONCE_PROTOTYPE === 'true') {
    const nonce = generateRequestNonce();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Content-Security-Policy', buildPrototypeCsp(nonce));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Jalankan proxy di semua rute KECUALI file statis bawaan Next.js
    // agar IP blocker bekerja global, tapi tetap ngebut
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
