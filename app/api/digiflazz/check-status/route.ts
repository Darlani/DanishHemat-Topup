import { NextResponse } from 'next/server';
import { requireAdminOrManager } from '@/utils/serverAuth';
import { supabaseAdmin } from '@/utils/supabaseAdmin';
import { DigiflazzAdapter } from '@/lib/providers/adapters/digiflazz.adapter';

interface WebhookDetailItem {
  meter_awal?: string;
  meter_akhir?: string;
  [key: string]: unknown;
}

interface WebhookDesc {
  nama?: string;
  nama_pelanggan?: string;
  tarif?: string;
  daya?: string;
  stand_meter?: string | number;
  detail?: WebhookDetailItem[];
  tagihan?: {
    detail?: WebhookDetailItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface OrderRecord {
  id: string;
  order_id: string;
  api_ref_id: string | null;
  sku: string;
  customer_no: string;
  user_id: string | null;
  email: string | null;
  user_contact: string | null;
  payment_method: string | null;
  total_amount: number;
  status: string;
  category: string | null;
  product_name: string;
  price: number | null;
  used_balance: number | null;
  buy_price: number | null;
  provider_used: string | null;
  vendor_sku: string | null;
  sn: string | null;
  created_at: string;
  is_sandbox?: boolean | null;
}

// 1. FUNGSI LAPOR TELEGRAM
async function reportToTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('💀 Telegram Gagal:', errMsg);
  }
}

const digiflazzAdapter = new DigiflazzAdapter();

export async function POST(req: Request) {
  try {
    // --- 1. OTORISASI ADMIN & MANAGER (Bearer Token Otoritatif) ---
    const auth = await requireAdminOrManager(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    // --- 2. VALIDASI REQUEST BODY ---
    const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
    const orderIdInput = typeof body?.order_id === 'string' ? body.order_id.trim() : '';

    if (!orderIdInput) {
      return NextResponse.json({ error: 'Order ID diperlukan' }, { status: 400 });
    }

    // --- 3. RESOLVE ORDER TABLE EXPLICITLY ---
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdInput);
    const liveQuery = supabaseAdmin
      .from('orders')
      .select(
        'id, order_id, api_ref_id, sku, customer_no, user_id, email, user_contact, payment_method, total_amount, status, category, product_name, price, used_balance, buy_price, provider_used, vendor_sku, sn, created_at'
      )
      .limit(2);
    const sandboxQuery = supabaseAdmin
      .from('sandbox_orders')
      .select('id')
      .limit(2);

    if (isUUID) {
      liveQuery.or(`id.eq.${orderIdInput},order_id.eq.${orderIdInput}`);
      sandboxQuery.or(`id.eq.${orderIdInput},order_id.eq.${orderIdInput}`);
    } else {
      liveQuery.eq('order_id', orderIdInput);
      sandboxQuery.eq('order_id', orderIdInput);
    }

    const [{ data: liveMatches, error: liveError }, { data: sandboxMatches, error: sandboxError }] = await Promise.all([
      liveQuery,
      sandboxQuery,
    ]);

    if (liveError || sandboxError) {
      return NextResponse.json({ error: 'Status pesanan tidak dapat diverifikasi.' }, { status: 500 });
    }

    if ((liveMatches?.length || 0) > 1 || (sandboxMatches?.length || 0) > 1) {
      return NextResponse.json({ error: 'Permintaan status pesanan tidak valid.' }, { status: 409 });
    }

    const hasLiveMatch = (liveMatches?.length || 0) === 1;
    const hasSandboxMatch = (sandboxMatches?.length || 0) === 1;

    if (hasLiveMatch && hasSandboxMatch) {
      return NextResponse.json({ error: 'Permintaan status pesanan tidak valid.' }, { status: 409 });
    }

    if (hasSandboxMatch) {
      return NextResponse.json({ error: 'Status pesanan tidak tersedia.' }, { status: 403 });
    }

    if (!hasLiveMatch) {
      return NextResponse.json({ error: 'Order tidak ditemukan di DB' }, { status: 404 });
    }

    const order = liveMatches[0] as OrderRecord;

    // --- 5. PROTEKSI ORDER > 90 HARI ---
    const createdDate = new Date(order.created_at);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    if (createdDate < ninetyDaysAgo) {
      return NextResponse.json(
        { error: 'Order terlalu lama (> 90 hari), dilarang cek status!' },
        { status: 403 }
      );
    }

    // --- 6. PROVIDER ATTRIBUTION GUARD ---
    if (order.provider_used && order.provider_used.toUpperCase() !== 'DIGIFLAZZ') {
      return NextResponse.json(
        { error: `Order menggunakan provider ${order.provider_used}, bukan Digiflazz.` },
        { status: 400 }
      );
    }

    // --- 7. STATUS GUARD: HANYA ORDER DIPROSES YANG BISA DICEK KE VENDOR ---
    if (order.status !== 'Diproses') {
      return NextResponse.json(
        {
          success: false,
          status: order.status,
          message: `Order saat ini berstatus ${order.status}. Cek status vendor hanya berlaku untuk order berstatus Diproses.`,
        },
        { status: 400 }
      );
    }

    const targetRefId = order.api_ref_id || order.order_id;
    const targetSku = order.vendor_sku || order.sku;
    const kategori = (order.category || '').toLowerCase();
    const isPostpaid = kategori.includes('pascabayar') || kategori.includes('ppob');
    const isTokenPLN = kategori.includes('pln') || kategori.includes('token');

    console.log(
      `🔍 [CHECK-STATUS] Menjemput bola untuk Inv: ${targetRefId} (${isPostpaid ? 'Pascabayar' : 'Prabayar'})`
    );

    // --- 8. DELEGASI CEK STATUS KE DIGIFLAZZ ADAPTER ---
    const checkResult = await digiflazzAdapter.checkStatus({
      orderId: order.order_id,
      correlationRefId: targetRefId,
      vendorSku: targetSku,
      destination: order.customer_no,
      additionalMetadata: isPostpaid ? { commands: 'status-pasca' } : undefined,
    });

    // ====================================================================
    // SKENARIO A: UNKNOWN TRANSPORT (Timeout / Respon tidak terbaca)
    // Pertahankan Diproses, jangan retry, jangan refund, jangan ubah attribution
    // ====================================================================
    if (checkResult.transportOutcome === 'UNKNOWN') {
      console.log(
        `⏳ [CHECK-STATUS] Order ${order.order_id} transport UNKNOWN (${checkResult.errorMessage || 'Timeout'}). Pertahankan Diproses.`
      );
      return NextResponse.json(
        {
          success: false,
          status: 'UNKNOWN',
          normalizedStatus: checkResult.normalizedStatus,
          rawStatus: checkResult.rawStatus,
          transportOutcome: 'UNKNOWN',
          error: `Koneksi ke vendor timeout (${checkResult.errorMessage || 'Check-status timeout'}). Status order tetap Diproses.`,
        },
        { status: 504 }
      );
    }

    // ====================================================================
    // SKENARIO B: PENDING
    // Pertahankan Diproses, perbarui sn jika ada, jangan retry, jangan refund
    // ====================================================================
    if (checkResult.normalizedStatus === 'PENDING') {
      const sn = checkResult.serialNumber;
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (sn && sn !== 'NO-SN') {
        updatePayload.sn = sn;
      }
      await supabaseAdmin.from('orders').update(updatePayload).eq('id', order.id);

      return NextResponse.json({
        success: true,
        status: checkResult.rawStatus || 'Pending',
        normalizedStatus: 'PENDING',
        rawStatus: checkResult.rawStatus,
        transportOutcome: checkResult.transportOutcome,
        sn: sn || order.sn,
        message: checkResult.errorMessage || 'Transaksi masih diproses di supplier.',
      });
    }

    // ====================================================================
    // STALE ATTEMPT PROTECTION (Sebelum menerapkan mutasi terminal)
    // ====================================================================
    const { data: freshOrder, error: freshErr } = await supabaseAdmin
      .from('orders')
      .select('id, api_ref_id, status')
      .eq('id', order.id)
      .single();

    if (freshErr || !freshOrder || freshOrder.status !== 'Diproses') {
      console.warn(
        `⚠️ [CHECK-STATUS] Order ${order.order_id} bukan lagi Diproses (status: ${freshOrder?.status}). Abaikan mutasi.`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Order sudah tidak dalam status Diproses (status saat ini: ${freshOrder?.status || 'Unknown'}). Mutasi diabaikan.`,
        },
        { status: 409 }
      );
    }

    const freshRefId = freshOrder.api_ref_id || order.order_id;
    if (freshRefId !== targetRefId) {
      console.warn(
        `⚠️ [CHECK-STATUS] Mengabaikan hasil status usang untuk Order ${order.order_id}. Aktif di DB: ${freshRefId}, dicek: ${targetRefId}.`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Target attempt telah berubah (aktif: ${freshRefId}, dicek: ${targetRefId}). Hasil vendor usang diabaikan.`,
        },
        { status: 409 }
      );
    }

    // ====================================================================
    // SKENARIO C: SUKSES (BERHASIL)
    // ====================================================================
    if (checkResult.normalizedStatus === 'SUCCESS') {
      const sn = checkResult.serialNumber || order.sn || 'SN-TERBIT';
      const rawResp = checkResult.rawResponse as
        | { data?: { customer_name?: string; price?: number } }
        | undefined;

      const updatePayload: Record<string, unknown> = {
        status: 'Berhasil',
        sn,
        notes: 'Sukses via Cek Status Admin',
        updated_at: new Date().toISOString(),
      };

      if (isPostpaid || isTokenPLN) {
        const descObj = checkResult.metadata;
        if (descObj) {
          updatePayload.desc = descObj;
          const typedDesc = descObj as WebhookDesc;
          const detail = typedDesc.detail?.[0] || typedDesc.tagihan?.detail?.[0];

          updatePayload.customer_name =
            typedDesc.nama ||
            typedDesc.nama_pelanggan ||
            rawResp?.data?.customer_name ||
            null;

          const tarif = typedDesc.tarif || '';
          const daya = typedDesc.daya || '';
          if (tarif || daya) {
            updatePayload.segment_power = `${tarif}${daya ? '/' + daya : ''}`;
          }

          if (detail?.meter_awal && detail?.meter_akhir) {
            updatePayload.stand_meter = `${detail.meter_awal} - ${detail.meter_akhir}`;
          } else if (typedDesc.stand_meter) {
            updatePayload.stand_meter = String(typedDesc.stand_meter);
          }

          if (isPostpaid) {
            updatePayload.raw_tagihan = rawResp?.data?.price || 0;
          }
        }
      }

      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id)
        .eq('status', 'Diproses')
        .select();

      if (updateErr) {
        console.error(`🔥 [CHECK-STATUS] Gagal update order ${order.order_id} ke Berhasil:`, updateErr);
        return NextResponse.json(
          { error: 'Gagal memperbarui status order ke Berhasil: ' + updateErr.message },
          { status: 500 }
        );
      }

      // Notifikasi & Struk HANYA setelah mutasi database berhasil
      if (updatedRows && updatedRows.length > 0) {
        let currentAttempt = 1;
        const matchId = order.api_ref_id?.match(/-R(\d+)$/);
        if (matchId) currentAttempt = parseInt(matchId[1], 10);
        const retryText = currentAttempt > 1 ? `\n🔄 AUTO-RETRY AKTIF! ${currentAttempt}x` : '';

        const hargaJual = (order.price || 0) + (order.used_balance || 0);
        const labaBersih = hargaJual - (order.buy_price || 0);

        console.log(`✅ [CHECK-STATUS] Pesanan ${order.order_id} SUKSES! SN: ${sn}`);
        await reportToTelegram(
          `✅ <b>TRANSAKSI BERHASIL (Via Detektif)!</b> 🚀${retryText}\n\n📦 Produk: ${order.product_name}\n💰 Harga Jual: Rp ${hargaJual.toLocaleString('id-ID')}\n💵 Est. Laba: Rp ${labaBersih.toLocaleString('id-ID')}\n👤 User: ${order.user_id ? 'MEMBER' : 'GUEST'}\n🆔 Inv: <code>${order.order_id}</code>\n📦 SN: <code>${sn}</code>\n🔄 Status: DIPROSES ➡️ BERHASIL`
        );

        // Automatic Resend Struk (Success Check-Status)
        const targetContactSuccess = order.user_contact || order.email;
        if (targetContactSuccess && targetContactSuccess.includes('@')) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000';
          fetch(`${siteUrl}/api/transaction/send-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.order_id,
              productName: order.product_name,
              status: 'Berhasil',
              paymentMethod: order.payment_method,
              totalAmount: order.total_amount,
              userContact: targetContactSuccess,
            }),
          }).catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('Gagal auto-receipt check-status success:', errMsg);
          });
        }
      }

      return NextResponse.json({
        success: true,
        status: checkResult.rawStatus || 'Sukses',
        normalizedStatus: 'SUCCESS',
        rawStatus: checkResult.rawStatus,
        transportOutcome: checkResult.transportOutcome,
        sn,
        message: checkResult.errorMessage || 'Transaksi Berhasil',
      });
    }

    // ====================================================================
    // SKENARIO D: GAGAL (TERMINAL FAILURE)
    // Gunakan public.refund_failed_order_atomic
    // Zero inline retry, zero JS balance calculation, zero direct balance_logs insert
    // ====================================================================
    if (checkResult.normalizedStatus === 'FAILED') {
      const failureReason = checkResult.errorMessage || 'Stok Kosong / Gangguan Vendor';

      const { data: refundSuccess, error: rpcErr } = await supabaseAdmin.rpc(
        'refund_failed_order_atomic',
        {
          p_order_id: order.id,
          p_reason: failureReason,
        }
      );

      if (rpcErr) {
        console.error(`🔥 [CHECK-STATUS] Gagal RPC refund_failed_order_atomic untuk ${order.order_id}:`, rpcErr);
        return NextResponse.json(
          { error: 'Gagal rekonsiliasi refund otomatis: ' + rpcErr.message },
          { status: 500 }
        );
      }

      if (refundSuccess === true) {
        let currentAttempt = 1;
        const matchId = targetRefId?.match(/-R(\d+)$/);
        if (matchId) currentAttempt = parseInt(matchId[1], 10);
        const retryText = currentAttempt > 1 ? `\n🔄 AUTO-RETRY HABIS: ${currentAttempt}x` : '';

        const nominalTotal = (order.price || 0) + (order.used_balance || 0);
        const userStatus = order.user_id ? 'MEMBER (Koin Kembali)' : 'GUEST (Butuh Refund Manual)';

        await reportToTelegram(
          `❌ <b>TRANSAKSI GAGAL (Via Detektif)!</b> 😭${retryText}\n\n📦 Produk: ${order.product_name}\n💰 Nominal: Rp ${nominalTotal.toLocaleString('id-ID')}\n⚠️ Alasan: ${failureReason}\n👤 User: ${userStatus}\n🆔 Inv: <code>${order.order_id}</code>\n🔄 Status: DIPROSES ➡️ GAGAL`
        );

        // Automatic Resend Struk (Failed Check-Status)
        const targetContactFail = order.user_contact || order.email;
        if (targetContactFail && targetContactFail.includes('@')) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000';
          fetch(`${siteUrl}/api/transaction/send-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.order_id,
              productName: order.product_name,
              status: 'Gagal',
              paymentMethod: order.payment_method,
              totalAmount: order.total_amount,
              userContact: targetContactFail,
              reason: failureReason,
            }),
          }).catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('Gagal auto-receipt check-status fail:', errMsg);
          });
        }

        return NextResponse.json({
          success: true,
          status: checkResult.rawStatus || 'Gagal',
          normalizedStatus: 'FAILED',
          rawStatus: checkResult.rawStatus,
          transportOutcome: checkResult.transportOutcome,
          message: failureReason,
        });
      } else {
        return NextResponse.json({
          success: false,
          status: checkResult.rawStatus || 'Gagal',
          normalizedStatus: 'FAILED',
          message: 'Order sudah terselesaikan sebelumnya atau tidak memenuhi syarat refund.',
        });
      }
    }

    return NextResponse.json({
      success: true,
      status: checkResult.rawStatus || 'Unknown',
      normalizedStatus: checkResult.normalizedStatus,
      rawStatus: checkResult.rawStatus,
      transportOutcome: checkResult.transportOutcome,
      sn: checkResult.serialNumber || order.sn,
      message: checkResult.errorMessage || 'Status diperiksa',
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('🔥 Error Check Status:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
