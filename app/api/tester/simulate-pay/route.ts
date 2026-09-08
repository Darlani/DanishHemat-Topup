import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/utils/serverAuth';
import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { sandboxExecutionSimulator } from '@/lib/providers/sandbox/simulator';

export const dynamic = 'force-dynamic';

async function getAuthenticatedUser(req: Request) {
  const authentication = await authenticateRequest(req);
  if (authentication.ok) return authentication.user;

  const cookieStore = req.headers.get('cookie') || '';
  const accessTokenMatch = cookieStore.match(/sb-access-token=([^;]+)/i);
  const token = accessTokenMatch?.[1] ? decodeURIComponent(accessTokenMatch[1]).trim() : '';
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  return error || !user ? null : user;
}

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Autentikasi diperlukan.' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, is_tester')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: 'Tidak dapat memverifikasi akses tester.' }, { status: 503 });
    }

    const role = profile?.role?.trim().toLowerCase();
    if (role !== 'member' || profile?.is_tester !== true) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const orderIdInput = typeof body.order_id === 'string' ? body.order_id.trim() : '';

    if (!orderIdInput) {
      return NextResponse.json({ error: 'Order ID wajib disertakan.' }, { status: 400 });
    }

    // 1. Ambil data pesanan dari sandbox_orders
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdInput);
    let query = supabaseAdmin
      .from('sandbox_orders')
      .select('id, order_id, status, sku, customer_no, user_id, email, used_balance')
      .eq('user_id', user.id);

    if (isUUID) {
      query = query.or(`id.eq.${orderIdInput},order_id.eq.${orderIdInput}`);
    } else {
      query = query.eq('order_id', orderIdInput);
    }

    const { data: initialOrder, error: fetchErr } = await query.maybeSingle();
    const order = initialOrder;

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
    }

    // 2. Status Guard: Hanya pesanan Pending yang boleh disimulasikan pembayarannya
    if (order.status !== 'Pending') {
      return NextResponse.json(
        { error: `Pesanan sudah dalam status '${order.status}' dan tidak dapat disimulasikan bayar.` },
        { status: 400 }
      );
    }

    // 4. Dispatch ke Sandbox Simulator (Ubah status ke 'Diproses')
    const dispatchResult = await sandboxExecutionSimulator.dispatchSandboxOrder({
      id: order.id,
      order_id: order.order_id,
      sku: order.sku,
      customer_no: order.customer_no,
    });

    if (!dispatchResult.success) {
      return NextResponse.json(
        { error: dispatchResult.message || 'Gagal mengubah status pesanan ke Diproses.' },
        { status: 500 }
      );
    }

    // 5. Opsi autoResolve (default: true untuk kenyamanan instan tester di halaman invoice)
    const autoResolve = body.auto_resolve !== false;
    let finalOutcome = { status: 'Diproses', sn: null as string | null };

    if (autoResolve) {
      const resolution = await sandboxExecutionSimulator.resolveSandboxOrder({
        id: order.id,
        order_id: order.order_id,
        customer_no: order.customer_no,
        user_id: order.user_id,
        user_email: order.email,
        used_balance: order.used_balance,
      });

      if (resolution.resolved) {
        finalOutcome = {
          status: resolution.finalStatus,
          sn: resolution.sn || null,
        };
      }
    }

    return NextResponse.json({
      success: true,
      order_id: order.order_id,
      status: finalOutcome.status,
      sn: finalOutcome.sn,
      message: `Simulasi pembayaran berhasil diproses (Status: ${finalOutcome.status}).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan internal server.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
