# LAPORAN AUDIT KEAMANAN & ARSITEKTUR SANDBOX DAPAY (HASIL KONSENSUS FINAL)

**Tanggal Pembaruan:** 8 September 2026  
**Status Dokumen:** Laporan Audit Final Hasil Konsensus & Verifikasi Lapangan  
**Target Lingkup:** Sub-sistem Marketing Sandbox / Tester Program, Order Routing, dan Boundary Keamanan  

---

## 1. Ringkasan Eksekutif & Batasan Konteks

Audit independen ini membedah secara mendalam sub-sistem Sandbox DaPay. Tujuan utama evaluasi adalah membedakan secara tegas antara:
1. **Kerentanan Keamanan Nyata (*Security Vulnerability*)** yang dapat dieksploitasi oleh penyerang.
2. **Kelemahan Logika & Inkonsistensi Arsitektur (*Architectural Gaps & Logic Inconsistencies*)** akibat proses transisi migrasi data.
3. **Praktik Higienitas Keamanan (*Security Hygiene & Best Practices*)** yang merupakan standar operasional web modern.

### Batasan Arsitektur DaPay:
- Sandbox DaPay adalah **Marketing Sandbox / Tester Program** untuk simulasi transaksi produk digital (PPOB, pulsa, game voucher) bagi calon merchant/UMKM.
- Sandbox ini **bukan OS/Container execution sandbox** (seperti Docker/gVisor/microVM) karena aplikasi tidak mengeksekusi kode biner, shell script, atau AI-agent runtime arbitrer.
- Fokus audit ditekankan pada **isolasi transaksi finansial, otentikasi identitas, otorisasi role, dan integritas routing order**.

---

## 2. Matriks Temuan Audit Terverifikasi (F-01 s/d F-13)

Berikut adalah tabel matriks evaluasi lengkap yang membandingkan temuan audit awal dengan hasil verifikasi faktual codebase:

| ID | Temuan Awal | Hasil Audit Ulang | Bagian yang Sesuai | Bagian yang Tidak Sesuai / Perlu Koreksi | Rekomendasi Perbaikan |
|---|---|:---:|---|---|---|
| **F-01** | `POST /api/tester/simulate-pay` tanpa autentikasi dan ownership check | **Sesuai — HIGH** | `app/api/tester/simulate-pay/route.ts:7-78` tidak memanggil autentikasi dan tidak membandingkan `order.user_id` dengan user pemanggil | Dampak terbatas ke `sandbox_orders`, bukan saldo LIVE. Klaim “tidak dapat menyentuh LIVE” sesuai source route saat ini (ada proteksi mutlak di baris 31–50 yang menolak order LIVE) | Wajibkan autentikasi session, verifikasi `profiles.is_tester = true`, validasi kepemilikan `order.user_id === user.id`, gunakan response generik untuk mencegah IDOR/enumerasi order |
| **F-02** | Payload JWT dipercaya tanpa verifikasi cryptographic signature | **Sesuai — HIGH** | `app/api/tester/session/route.ts:14-45`, `:64-74`, `:91-101` mendecode JWT manual (`parseJwtPayload`) dan langsung mengembalikan `sub` sebelum verifikasi `auth.getUser()` | Syarat eksploitasi perlu dipertegas: profil target harus terdaftar sebagai tester (`is_tester = true`) agar sesi sandbox aktif, sehingga penyerang tidak bisa sembarang mengaktifkan akun non-tester | Hapus `parseJwtPayload()` sebagai sumber identitas. Selalu panggil `supabaseAdmin.auth.getUser(token)` secara kriptografis sebelum membaca user ID |
| **F-03** | Engine menganggap sandbox hanya dari global store setting | **Sesuai, dampak laporan kurang tepat — HIGH** | `lib/providers/engine.ts:273-300` membaca `store_settings.is_live_mode`, lalu memanggil sandbox simulator | Engine mengambil order dari `orders` (LIVE), tetapi simulator mengupdate `sandbox_orders` memakai ID order LIVE. Ini bukan langsung live balance bleed; melainkan query update di `sandbox_orders` menghasilkan 0 row (kebuntuan logika) dan engine memberi hasil sukses palsu | Pisahkan jalur berdasarkan tabel/order environment. Engine LIVE hanya memproses `orders`; simulator hanya menerima baris dari `sandbox_orders` |
| **F-04** | Middleware memakai cookie `userRole` untuk akses `/admin` | **Sesuai terbatas — MEDIUM** | `proxy.ts:75-77`, `:114-125` mengambil role dari cookie yang dapat diubah client secara bebas | Laporan awal terlalu luas bila menyebut “membobol admin”. Temuan membuktikan bypass gate halaman visual `/admin`, namun belum membuktikan bypass API admin karena endpoint `/api/admin/*` memiliki secondary gate di DB (`requireAdminOrManager`) | Ambil role dari sesi tervalidasi atau DB. API admin tetap wajib melakukan authorization server-side yang ketat |
| **F-05** | Resolver environment fail-open ke LIVE saat terjadi error | **Sesuai — HIGH** | `lib/auth/tester.ts:53-64` memakai `?? true`; `:92-96` mengembalikan `SYSTEM_FALLBACK_LIVE` saat catch error | Laporan benar. Kegagalan query atau transient timeout dapat mengubah transaksi yang seharusnya sandbox menjadi pesanan LIVE riil | Terapkan prinsip Fail-Closed: return error, batalkan pembuatan order, jangan default ke LIVE saat request memiliki konteks sesi sandbox |
| **F-06** | `DELETE /api/tester/session` tanpa auth/CSRF | **Tidak sesuai severity — LOW / Informational** | `app/api/tester/session/route.ts:234-246` memang tanpa autentikasi | Endpoint hanya menghapus cookie browser pemanggil (`maxAge: 0`). Tidak mengubah database, saldo, maupun data order. Dampak CSRF sangat minim (hanya de-autentikasi sesi tester lokal) | Turunkan severity. Auth/CSRF boleh ditambah sebagai hygiene, tetapi bukan prioritas utama keamanan transaksi |
| **F-07** | Cookie sandbox menggunakan flag `httpOnly: false` | **Sesuai — LOW** | `app/api/tester/session/route.ts:214-220` menetapkan `httpOnly: false` | Laporan benar bahwa XSS dapat membaca cookie. Namun cookie hanya berisi flag string `active`, bukan token otentikasi / bearer credential | Ubah ke `httpOnly: true`; endpoint `GET /api/tester/session` sudah tersedia untuk pembacaan status banner di sisi UI React |
| **F-08** | IP blacklist fail-open dan header IP dapat dipalsukan | **Sesuai bersyarat — MEDIUM** | `proxy.ts:26-60` membiarkan request lewat jika DB error; `:141-145` mengambil `x-forwarded-for` langsung | Header spoofing hanya valid bila aplikasi dapat diakses langsung tanpa reverse proxy yang menimpa header. Di belakang trusted reverse proxy (mis. Cloudflare), header client ditimpa dengan aman | Validasi trusted proxy atau gunakan header platform tepercaya (`cf-connecting-ip`). Pertimbangkan fail-closed untuk rute sensitif tertentu |
| **F-09** | Konfigurasi `allowedDevOrigins: ["*"]` | **Sesuai sebagai risiko operasional — LOW / MEDIUM** | `next.config.ts:3` memang diset wildcard | Bukan kerentanan produksi otomatis. Dampak risiko muncul jika developer menjalankan server dev di jaringan publik dan terkoneksi ke database produksi | Batasi ke `localhost`, `127.0.0.1`, dan domain staging resmi. Pisahkan credential dev dan production secara mutlak |
| **F-10** | CSP mengizinkan `unsafe-eval` dan `unsafe-inline` | **Sesuai sebagai hardening gap — LOW / MEDIUM** | `next.config.ts:18-20` berisi kedua directive tersebut | Ini melemahkan CSP, tetapi bukan exploit mandiri tanpa adanya sumber injeksi XSS lain | Hilangkan secara bertahap. Gunakan nonce/hash dan audit pustaka frontend yang masih membutuhkan inline/eval |
| **F-11** | Server memegang service-role key dan vendor secrets | **Tidak sesuai sebagai vulnerability — Security Control / Hygiene** | `utils/supabaseAdmin.ts` memang memakai `SUPABASE_SERVICE_ROLE_KEY` di server-side | Server-side secret storage adalah pola arsitektur normal pada Next.js BFF. Source yang diperiksa belum membuktikan secret bocor ke client bundle, log, atau public repository | Turunkan menjadi hygiene audit. Verifikasi berkala file `.gitignore`, client bundle exclusion, dan batasan scope environment variables |
| **F-12** | Source, Payload, dan Migration belum 100% tersinkronisasi | **Temuan Baru — HIGH (Arsitektur)** | `app/api/orders/create/route.ts:324` masih menyertakan payload `is_sandbox`; migration `20260906200000` telah menghapus kolom `orders.is_sandbox`; RPC routing `20260906190000:734-738` masih membaca payload tersebut | Tidak tercantum di file audit lama. Klaim bahwa “semua application queries sudah memakai table boundary murni” belum sepenuhnya sinkron karena RPC masih butuh flag payload dan engine masih memakai global mode | Sinkronkan route, RPC, engine, dan schema. Pastikan routing Sandbox murni berdasarkan resolusi server yang tegas tanpa kopling sisa skema lama |
| **F-13** | Klaim “Gate 1–8 PASS, Zero-Bleed” pada audit sebelumnya | **Temuan Baru — Tidak Terverifikasi (Secara Audit Independen)** | File laporan audit sebelumnya mencantumkan status pengujian Gate 1–8 telah lolos | Pengujian dijalankan pada lingkungan scratch developer lokal. Belum ada rekaman automated test CI/CD resmi atau bukti log query bertanda tangan yang terlampir permanen di repositori | Beri label “Belum Terverifikasi secara Independen” sampai bukti test run formal dan assertion log terekam dalam artefak audit |

---

## 3. Rekapitulasi Kategori Temuan

```text
                        ┌──────────────────────────────────────────────────────────┐
                        │              KLASIFIKASI TEMUAN AUDIT                    │
                        └──────────────────────────┬───────────────────────────────┘
                                                   │
         ┌─────────────────────────┬───────────────┴───────────────┬─────────────────────────┐
         │                         │                               │                         │
         ▼                         ▼                               ▼                         ▼
[VULNERABILITY NYATA]   [ARSITEKTUR & LOGIKA]             [PENGURANGAN SEVERITY]    [BUKAN VULNERABILITY]
• F-02: JWT Unsigned    • F-03: Engine Desync Logic       • F-06: Session DELETE    • F-11: Service-Role Storage
• F-01: Simulate-Pay    • F-05: Resolver Fail-Open          (Turun ke Low/Info)       (Adalah Pattern Wajar BFF)
• F-04: Cookie Gate     • F-12: Payload/RPC Desync        • F-08: IP Spoofing
                        • F-13: Unverified Evidence         (Tergantung Proxy)
```

1. **Sesuai dan Tetap Prioritas Tinggi (Critical/High Vulnerability):**
   - **F-02**: Pemalsuan identitas JWT akibat ketiadaan verifikasi kriptografis.
   - **F-01**: Endpoint mutasi pesanan sandbox tanpa proteksi sesi dan validasi kepemilikan.
   - **F-05**: Logika resolver environment yang *fail-open* ke mode produksi saat error.
2. **Sesuai tetapi Dampak/Severity Perlu Dikoreksi (Medium):**
   - **F-03**: Inkonsistensi engine terhadap tabel `sandbox_orders` (berakibat silent failure, bukan kebocoran saldo).
   - **F-04**: Bypass visual middleware halaman admin (API backend masih memverifikasi database).
   - **F-08, F-09, F-10**: Aspek hardening perimeter jaringan, origin, dan CSP.
3. **Sesuai tetapi Severity Terlalu Tinggi (Low/Informational):**
   - **F-06**: Endpoint penghapusan cookie lokal tanpa dampak mutasi data.
   - **F-07**: Cookie sandbox `httpOnly: false` untuk kebutuhan banner UI.
4. **Bukan Merupakan Vulnerability Mandiri (Security Control):**
   - **F-11**: Penyimpanan service-role di server Next.js adalah pola baku arsitektur web backend.
5. **Temuan Baru yang Belum Ada di Laporan Awal:**
   - **F-12**: Inkonsistensi penamaan flag payload `is_sandbox` terhadap skema database yang sudah bersih.
   - **F-13**: Status pengujian Gate 1–8 diklasifikasikan sebagai *belum terverifikasi independen* sebelum disertakan rekaman log formal.

---

## 4. Urutan Prioritas Perbaikan yang Disepakati

Sesuai konsensus, rencana perbaikan akan dieksekusi dengan urutan prioritas teknis berikut:

$$\mathbf{F\text{-}02 \;\longrightarrow\; F\text{-}01 \;\longrightarrow\; F\text{-}05 \;\longrightarrow\; (F\text{-}12 \,/\, F\text{-}03) \;\longrightarrow\; F\text{-}04}$$

### Rincian Rencana Tindakan:

1. **Prioritas 1 — F-02 ([`app/api/tester/session/route.ts`](file:///c:/Users/arlan/my-ecommerce/app/api/tester/session/route.ts))**:
   - Hapus fungsi parser manual `parseJwtPayload()`.
   - Wajibkan pemanggilan `supabaseAdmin.auth.getUser(token)` untuk memvalidasi token secara kriptografis sebelum membaca identitas user.
2. **Prioritas 2 — F-01 ([`app/api/tester/simulate-pay/route.ts`](file:///c:/Users/arlan/my-ecommerce/app/api/tester/simulate-pay/route.ts))**:
   - Pasang middleware otentikasi sesi Supabase.
   - Tambahkan pengecekan hak tester (`profiles.is_tester = true`).
   - Enforce kepemilikan pesanan: `order.user_id === authenticatedUser.id`.
3. **Prioritas 3 — F-05 ([`lib/auth/tester.ts`](file:///c:/Users/arlan/my-ecommerce/lib/auth/tester.ts))**:
   - Ubah blok `catch` pada `resolveOrderEnvironment`: jika request membawa konteks sandbox tetapi terjadi kegagalan database/sistem, lemparkan error (*fail-closed*), jangan pernah mengalihkan ke LIVE (`SYSTEM_FALLBACK_LIVE`).
4. **Prioritas 4 — F-12 & F-03 ([`lib/providers/engine.ts`](file:///c:/Users/arlan/my-ecommerce/lib/providers/engine.ts) & Alur Order)**:
   - Bersihkan ketergantungan flag global di `engine.ts`; konfirmasikan bahwa tabel `orders` hanya diproses oleh provider LIVE.
   - Selaraskan routing payload di checkout dan RPC agar pemisahan `orders` vs `sandbox_orders` berjalan secara tuntas.
5. **Prioritas 5 — F-04 ([`proxy.ts`](file:///c:/Users/arlan/my-ecommerce/proxy.ts))**:
   - Hapus otorisasi berbasis cookie mentah `userRole` di middleware proxy.
   - Ambil role pengguna dari token sesi terenkripsi atau validasi profil server-side.

---

## 5. Kesimpulan Akhir

Laporan audit ini telah diselaraskan sepenuhnya dengan realitas teknis aplikasi DaPay. Tidak ada kerentanan eksekusi biner/OS container karena sistem berada pada lingkup e-commerce murni. 

Dengan memprioritaskan perbaikan pada **F-02, F-01, F-05, F-12/F-03, dan F-04**, seluruh celah keamanan otentikasi web dan integritas pemisahan data Sandbox vs LIVE akan tertutup secara sempurna tanpa mengorbankan stabilitas bisnis yang telah berjalan.
