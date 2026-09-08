import crypto from "crypto";
import { NextResponse } from "next/server";
import { isPaymentAllowed } from "@/utils/LogicPembayaran";
import { authenticateRequest, isManagementRole } from "@/utils/serverAuth";
import { supabaseAdmin } from "@/utils/supabaseAdmin";
import { OrderEnvironmentResolutionError, resolveOrderEnvironment } from "@/lib/auth/tester";

type DatabaseProduct = {
  id?: string;
  sku: string;
  name?: string | null;
  price?: number | null;
  cost?: number | null;
  discount?: number | null;
  cashback?: number | null;
  is_active?: boolean | null;
  categories?: { name?: string | null }[] | null;
};

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function rpcFailure(message: string) {
  if (message.includes("ORDER_RESERVATION")) {
    return NextResponse.json(
      { error: "Reservasi nominal pembayaran tidak lagi tersedia. Silakan ulangi checkout." },
      { status: 409 },
    );
  }

  if (message.includes("ORDER_PENDING_TOTAL_COLLISION")) {
    return NextResponse.json(
      { error: "Nominal pembayaran baru saja dipakai. Silakan ulangi checkout." },
      { status: 409 },
    );
  }

  return NextResponse.json({ error: "Gagal membuat pesanan." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body request tidak valid." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body request tidak valid." }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const sku = typeof input.sku === "string" ? input.sku.trim() : "";
    const paymentMethod =
      typeof input.payment_method === "string" ? input.payment_method.trim() : "";
    const reservationId =
      typeof input.reservationId === "string" ? input.reservationId.trim() : "";
    const requestedCoinAmount = safeNonNegativeInteger(input.used_balance);
    const requestedVoucherAmount = safeNonNegativeInteger(input.voucher_amount);
    const requestedVoucherCode =
      typeof input.voucher_code === "string" ? input.voucher_code.trim() : "";

    if (
      !sku ||
      !paymentMethod ||
      !reservationId ||
      requestedCoinAmount === null ||
      requestedVoucherAmount === null
    ) {
      return NextResponse.json({ error: "Data checkout tidak lengkap." }, { status: 400 });
    }

    // The new reservation flow has no trusted server-side voucher redemption
    // primitive yet. Never turn a client-provided discount into a payable base.
    if (requestedVoucherAmount > 0 || requestedVoucherCode) {
      return NextResponse.json(
        { error: "Voucher belum tersedia untuk checkout dengan nominal unik." },
        { status: 409 },
      );
    }

    const voucherAmount = 0;

    // Mixed/full Koin intentionally stays unavailable until the remaining
    // state writers and expiry-refund protocol are deployed together.
    if (requestedCoinAmount > 0 || paymentMethod.includes("Koin DaPay")) {
      return NextResponse.json(
        { error: "Pembayaran dengan Koin DaPay sedang tidak tersedia." },
        { status: 409 },
      );
    }

    const authorization = request.headers.get("authorization");
    let authenticatedUserId: string | null = null;

    if (authorization) {
      const authentication = await authenticateRequest(request);
      if (!authentication.ok) {
        return NextResponse.json(
          { error: authentication.message },
          { status: authentication.status },
        );
      }
      authenticatedUserId = authentication.user.id;

      // AUTHORITATIVE MANAGEMENT PERSONA BARRIER
      // Admin and Manager are strictly Management & QA Persona, never Customer Shopping Persona.
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", authenticatedUserId)
        .maybeSingle();

      if (isManagementRole(profile?.role)) {
        return NextResponse.json(
          {
            error:
              "Akses Ditolak: Akun Manajemen (Admin/Manager) tidak diperkenankan membuat transaksi pesanan konsumen (LIVE maupun Sandbox). Gunakan Sandbox Test Center untuk pengujian operasional.",
          },
          { status: 403 },
        );
      }
    }

    let dbProduct: DatabaseProduct | null = null;
    let productType: "manual" | "provider" = "provider";

    const { data: semiAutoData } = await supabaseAdmin
      .from("product_semi_auto")
      .select("id, sku, name, price_numeric, cost_numeric, discount, cashback, is_active, categories(name)")
      .eq("sku", sku)
      .maybeSingle();

    if (semiAutoData) {
      dbProduct = {
        ...semiAutoData,
        price: semiAutoData.price_numeric,
        cost: semiAutoData.cost_numeric,
      };
      productType = "manual";
    } else {
      const { data: providerData } = await supabaseAdmin
        .from("product_automatic")
        .select("sku, name, price, cost, discount, cashback, is_active, categories(name)")
        .eq("sku", sku)
        .maybeSingle();
      dbProduct = providerData;
    }

    if (!dbProduct) {
      return NextResponse.json({ error: "Produk tidak ditemukan di rak database!" }, { status: 400 });
    }

    if (dbProduct.is_active !== true) {
      return NextResponse.json(
        { error: "Produk sedang tidak aktif atau tidak tersedia." },
        { status: 400 },
      );
    }

    // Server-side verification: Validasi kelayakan etalase & status brand aktif
    const { data: unifiedProduct, error: unifiedErr } = await supabaseAdmin
      .from("product_unified_view")
      .select("id, is_active, is_storefront_eligible, brand_id")
      .eq("sku", sku)
      .maybeSingle();

    if (unifiedErr || !unifiedProduct || !unifiedProduct.is_active || !unifiedProduct.is_storefront_eligible) {
      return NextResponse.json(
        { error: "Produk saat ini sedang tidak tersedia di etalase." },
        { status: 400 },
      );
    }

    if (unifiedProduct.brand_id) {
      const { data: brandData } = await supabaseAdmin
        .from("brands")
        .select("active")
        .eq("id", unifiedProduct.brand_id)
        .maybeSingle();

      if (brandData && brandData.active !== true) {
        return NextResponse.json(
          { error: "Kategori/Brand produk ini sedang tidak aktif." },
          { status: 400 },
        );
      }
    }

    const category = dbProduct.categories?.[0]?.name?.toLowerCase() || "";
    const isPascabayar =
      productType === "provider" &&
      (category.includes("pascabayar") || dbProduct.sku.toLowerCase() === "pln");

    // This route has no durable, server-verifiable inquiry record to reload by
    // reference. Do not derive payment authority from browser inquiry details.
    if (isPascabayar) {
      return NextResponse.json(
        { error: "Checkout Pascabayar belum tersedia untuk nominal unik." },
        { status: 409 },
      );
    }

    let expectedBaseAmount: number;
    let rawTagihan = 0;
    let buyPrice: number;
    let price: number;
    let itemLabel = typeof input.item_label === "string" ? input.item_label : null;
    let customerName: string | null = null;
    let segmentPower: string | null = null;
    let standMeter: string | null = null;
    let description: unknown = null;
    let apiRefId: string;

    if (isPascabayar) {
      const inquiry =
        input.inquiry_result && typeof input.inquiry_result === "object" && !Array.isArray(input.inquiry_result)
          ? (input.inquiry_result as Record<string, unknown>)
          : null;
      const tagihan = safeNonNegativeInteger(inquiry?.amount);
      const supplierAdmin = safeNonNegativeInteger(inquiry?.adminSupplier);
      const storeAdmin = safeNonNegativeInteger(dbProduct.price);
      const denda = safeNonNegativeInteger(
        (inquiry?.desc as { detail?: Array<{ denda?: unknown }> } | undefined)?.detail?.[0]?.denda,
      ) ?? 0;

      if (tagihan === null || supplierAdmin === null || storeAdmin === null) {
        return NextResponse.json({ error: "Data tagihan tidak valid." }, { status: 400 });
      }

      rawTagihan = tagihan;
      price = tagihan + storeAdmin + denda;
      buyPrice = tagihan + supplierAdmin + denda;
      expectedBaseAmount = price - voucherAmount;
      itemLabel = typeof inquiry?.period === "string" ? `Tagihan ${inquiry.period}` : "Tagihan Listrik";
      customerName = typeof inquiry?.customerName === "string" ? inquiry.customerName : null;
      segmentPower = typeof inquiry?.segmentPower === "string" ? inquiry.segmentPower : null;
      standMeter = typeof inquiry?.standMeter === "string" ? inquiry.standMeter : null;
      description = inquiry?.desc ?? { info: "Waiting for payment..." };
      apiRefId = typeof inquiry?.ref_id === "string" && inquiry.ref_id.trim() ? inquiry.ref_id : "";
    } else {
      const productPrice = safeNonNegativeInteger(dbProduct.price);
      const productDiscount = safeNonNegativeInteger(dbProduct.discount) ?? 0;
      const productCost = safeNonNegativeInteger(dbProduct.cost) ?? 0;

      if (productPrice === null) {
        return NextResponse.json({ error: "Harga produk tidak valid." }, { status: 500 });
      }

      expectedBaseAmount = Math.floor(productPrice * (1 - productDiscount / 100)) - voucherAmount;
      price = productPrice;
      buyPrice = productCost;
      apiRefId = "";
    }

    if (!Number.isSafeInteger(expectedBaseAmount) || expectedBaseAmount <= 0) {
      return NextResponse.json({ error: "Nominal pembayaran tidak valid." }, { status: 400 });
    }

    const cleanPaymentMethod = paymentMethod.split(" + ")[0];
    const { data: payData } = await supabaseAdmin
      .from("payment_accounts")
      .select("name, is_maintenance, start_hour, end_hour, min_price")
      .eq("name", cleanPaymentMethod)
      .maybeSingle();

    if (typeof payData?.name !== "string" || !payData.name.trim()) {
      return NextResponse.json({ error: "Metode pembayaran tidak tersedia." }, { status: 403 });
    }

    if (!isPaymentAllowed(payData.name, dbProduct.name || "General", expectedBaseAmount, payData)) {
      return NextResponse.json({ error: "Metode pembayaran tidak tersedia." }, { status: 403 });
    }

    let cashback = 0;
    if (authenticatedUserId) {
      const { data: userProfile } = await supabaseAdmin
        .from("profiles")
        .select("member_type")
        .eq("id", authenticatedUserId)
        .maybeSingle();
      if (userProfile?.member_type?.toLowerCase() === "special") {
        cashback = safeNonNegativeInteger(dbProduct.cashback) ?? 0;
      }
    }

    let envRes: Awaited<ReturnType<typeof resolveOrderEnvironment>>;
    try {
      envRes = await resolveOrderEnvironment(request, authenticatedUserId);
    } catch (error) {
      if (error instanceof OrderEnvironmentResolutionError) {
        return NextResponse.json(
          { error: "Lingkungan transaksi tidak dapat diverifikasi. Silakan coba lagi." },
          { status: 503 },
        );
      }
      throw error;
    }
    const isSandbox = envRes.isSandbox;

    const orderId = `DANISH-${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`;
    const orderPayload = {
      order_id: orderId,
      api_ref_id: apiRefId || orderId,
      sku: dbProduct.sku,
      product_name: dbProduct.name || "Produk Digital",
      item_label: itemLabel,
      customer_no: typeof input.customer_no === "string" ? input.customer_no : null,
      buy_price: buyPrice,
      price,
      discount: isPascabayar ? 0 : safeNonNegativeInteger(dbProduct.discount) ?? 0,
      voucher_code: null,
      voucher_amount: voucherAmount,
      cashback,
      payment_method: payData.name,
      product_type: productType,
      manual_product_id: productType === "manual" ? dbProduct.id : null,
      sn: null,
      user_contact: typeof input.user_contact === "string" ? input.user_contact : null,
      referred_by: typeof input.referred_by === "string" ? input.referred_by : null,
      category: category || "umum",
      ip_address: typeof input.ip_address === "string" ? input.ip_address : null,
      device_id: typeof input.device_id === "string" ? input.device_id : null,
      raw_tagihan: rawTagihan,
      customer_name: customerName,
      segment_power: segmentPower,
      stand_meter: standMeter,
      desc: description,
    };

    const { data: createdOrder, error: rpcError } = await supabaseAdmin.rpc(
      "create_pending_order_from_reservation",
      {
        p_reservation_id: reservationId,
        p_external_base_amount: String(expectedBaseAmount),
        p_authenticated_user_id: authenticatedUserId,
        p_environment: isSandbox ? "SANDBOX" : "LIVE",
        p_order_data: orderPayload,
      },
    );

    if (rpcError) {
      return rpcFailure(rpcError.message || "");
    }

    const result = createdOrder as { id?: string; order_id?: string } | null;
    if (!result?.order_id) {
      return NextResponse.json({ error: "Gagal membuat pesanan." }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: result.id, order_id: result.order_id });
  } catch {
    return NextResponse.json({ error: "Gagal membuat pesanan." }, { status: 500 });
  }
}
