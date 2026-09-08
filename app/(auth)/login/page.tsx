"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { Lock, Mail, ArrowRight, Loader2, AlertCircle, Store, UserPlus, ShieldAlert, ChevronLeft, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { Turnstile } from '@marsidev/react-turnstile'; 

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // EFEK PEMBUNUH SESI (HARD LOGOUT) JIKA TOKEN HABIS DARI SERVER
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("session") === "expired") {
        const killSession = async () => {
          await supabase.auth.signOut(); // Hapus sesi VIP di server Supabase
          localStorage.clear(); // Bersihkan sisa data lokal
          document.cookie = "sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
          document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
          // Karena data bersih dan di-signOut, Navbar.tsx PASTI otomatis berubah jadi "Sign In"
        };
        killSession();
      }
    }
  }, []);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
const [errorMsg, setErrorMsg] = useState("");
  
  // State baru untuk mengontrol tampilan PIN & Password
  const [isPinStage, setIsPinStage] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tempProfile, setTempProfile] = useState<any>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null); 
  
  // --- STATE UNTUK LOGIN GOOGLE ---
  const [socialLoading, setSocialLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Deteksi jika kita sedang di localhost (development)
    const isLocal = typeof window !== "undefined" && window.location.hostname === "localhost";

    // Bypass blokir kalau lagi ngoding di lokal, tapi tetap ketat di server sungguhan
    if (!captchaToken && !isLocal) {
      setErrorMsg("Tolong selesaikan verifikasi keamanan, Bos!");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      type LoginResponse = {
        success?: boolean;
        error?: string;
        user?: {
          id: string;
          email: string;
          full_name: string;
          role?: string;
        };
        session?: {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };
      };

      let result: LoginResponse | null = null;
      const rawText = await res.text();

      if (rawText) {
        try {
          result = JSON.parse(rawText) as LoginResponse;
        } catch {
          result = null;
        }
      }

      if (!res.ok) {
        const errorMessage =
          result?.error ||
          (res.status >= 500
            ? "Server sedang mengalami kendala. Silakan coba lagi beberapa saat."
            : "Gagal login. Silakan periksa kembali email dan password Anda.");
        throw new Error(errorMessage);
      }

      if (!result || typeof result !== "object") {
        throw new Error("Server sedang mengalami kendala. Silakan coba lagi beberapa saat.");
      }

      if (!result.session?.access_token || !result.user) {
        throw new Error(result.error || "Sesi login tidak valid. Silakan coba lagi.");
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });

      if (sessionError) throw sessionError;

      // Cek role dari response (jika tidak ada anggap member biasa)
      const userRole = result.user?.role || 'member';

      if (userRole === 'admin' || userRole === 'manager') {
        // Cek ke backend Supabase apakah admin/manager ini sudah mengaktifkan 2FA
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        // Pakai .all dan sesuaikan nama properti dengan typing Supabase (factor_type)
        const totpFactor = mfaData?.all?.find((f) => f.factor_type === 'totp' && f.status === 'verified');

        if (totpFactor) {
          // Jika sudah punya 2FA, simpan ID factor-nya dan tampilkan form PIN
          setTempProfile({ ...result.user, factorId: totpFactor.id });
          setIsPinStage(true);
        } else {
          // Jika role Admin/Manager tapi belum pasang 2FA, pasang cookie sesi lalu arahkan ke Setup
          const expiresIn = result.session.expires_in;
          document.cookie = `sb-access-token=${result.session.access_token}; path=/; max-age=${expiresIn}; Secure; SameSite=Lax`;
          router.push("/setup-2fa");
        }
      } else {
        // Jika member biasa, bebas akses tanpa 2FA
        localStorage.setItem("userEmail", result.user.email);
        localStorage.setItem("userName", result.user.full_name);

        // Ambil umur token otomatis dari pusat (Supabase)
        const expiresIn = result.session.expires_in;

        // Simpan token ke cookie agar proxy.ts bisa membacanya
        document.cookie = `sb-access-token=${result.session.access_token}; path=/; max-age=${expiresIn}; Secure; SameSite=Lax`;
        document.cookie = `userRole=member; path=/; max-age=${expiresIn}; Secure; SameSite=Lax`;

        // KEMBALIKAN PENANDA LOKAL UNTUK NAVBAR
        localStorage.setItem("isUser", "true");

        router.push("/user");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal login. Silakan coba lagi.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      // Validasi PIN langsung ke Backend Supabase Auth untuk keamanan ekstra
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: tempProfile.factorId,
        code: pin.trim()
      });

      if (error) {
        setErrorMsg("KODE SALAH ATAU KADALUARSA! Coba lagi.");
        setPin("");
        return;
      }

// Jika berhasil, Supabase otomatis menaikkan sesi ke AAL2
      localStorage.setItem("userEmail", tempProfile.email);
      localStorage.setItem("userName", tempProfile.full_name);
      
// Ambil session terbaru yang sudah AAL2 setelah verifikasi PIN
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        const expiresInAdmin = sessionData.session.expires_in;
        document.cookie = `sb-access-token=${sessionData.session.access_token}; path=/; max-age=${expiresInAdmin}; Secure; SameSite=Lax`;
        document.cookie = `userRole=${tempProfile.role}; path=/; max-age=${expiresInAdmin}; Secure; SameSite=Lax`;
      }
      
      // KEMBALIKAN PENANDA LOKAL UNTUK NAVBAR ADMIN
      localStorage.setItem("isAdmin", "true");
      
      router.push("/admin");
    } catch (err) {
      setErrorMsg("Gagal terhubung ke server keamanan!");
    } finally {
      setLoading(false);
    }
  };

  // --- FUNGSI LOGIN GOOGLE ---
  const handleGoogleLogin = async () => {
    setSocialLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/user`
        }
      });
      if (error) throw error;
    } catch (error: any) {
      setErrorMsg("Gagal login dengan Google.");
      setSocialLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-blue-500 selection:text-white">
      
      {/* Background Decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-125 h-125 bg-blue-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-125 h-125 bg-emerald-600/10 rounded-full blur-[120px]"></div>
      </div>

      <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 md:p-12 rounded-[40px] shadow-2xl w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        
        {/* Header Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex p-4 bg-linear-to-br from-blue-600 to-blue-800 rounded-3xl shadow-lg shadow-blue-500/30 mb-6 transform rotate-3 hover:rotate-0 transition-transform duration-500">
              <Store size={32} className="text-white" />
          </div>
          <h1 className="text-3xl text-white font-black italic tracking-tighter uppercase mb-2">
            DANISH <span className="text-blue-500">STORE</span>
          </h1>
          <p className="text-slate-400 text-xs font-medium tracking-widest uppercase">
            {isPinStage ? "Verifikasi Keamanan" : "Masuk ke Dashboard"}
          </p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-6 bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="text-rose-500 shrink-0 mt-0.5" size={18} />
            <p className="text-rose-400 text-xs font-bold leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {!isPinStage ? (
          /* FORM TAHAP 1: EMAIL & PASSWORD + SOSMED DIBUNGKUS FRAGMENT */
          <>
            <form onSubmit={handleLogin} className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 font-bold tracking-widest uppercase ml-3">Email Akses</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  <input
                    type="email"
                    required
                    className="w-full bg-slate-900/50 border border-white/10 text-white text-sm rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent block pl-12 p-4 placeholder-slate-600 transition-all outline-none font-medium"
                    placeholder="email@anda.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

<div className="space-y-1">
                {/* Header Label & Lupa Password */}
                <div className="flex justify-between items-end px-3">
                  <label className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Password</label>
                  <Link href="/forgot-password" className="text-[10px] font-bold tracking-widest uppercase text-slate-500 hover:text-blue-400 transition-colors">
                    Lupa Password?
                  </Link>
                </div>
                
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    // Tambahkan pr-12 agar teks tidak tertimpa ikon mata di sebelah kanan
                    className="w-full bg-slate-900/50 border border-white/10 text-white text-sm rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent block pl-12 pr-12 p-4 placeholder-slate-600 transition-all outline-none font-medium"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />

                  {/* Tombol Mata (Show/Hide) */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* POSISI WIDGET CAPTCHA DI SINI */}
              <div className="flex justify-center pt-2">
                <Turnstile 
                  // Pakai Dummy Key kalau di lokal, pakai Real Key kalau di production
                  siteKey={typeof window !== "undefined" && window.location.hostname === "localhost" ? "1x00000000000000000000AA" : "0x4AAAAAACkQAA6L_WPQSSms"}
                  onSuccess={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken(null)}
                  options={{
                    theme: 'dark', // Pakai dark biar nyatu sama bg login
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !captchaToken} 
                className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-black italic uppercase py-4 rounded-2xl shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 transition-all transform active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : !captchaToken ? (
                  "Verifikasi Keamanan..."
                ) : (
                  <>MASUK SEKARANG <ArrowRight size={20} /></>
                )}
              </button>
            </form>

            {/* --- PEMBATAS & LOGIN SOSMED --- */}
            <div className="mt-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center text-[10px] font-bold tracking-widest uppercase">
                  <span className="bg-[#0B0E14] px-4 text-slate-500">Atau Masuk Lebih Cepat</span>
                </div>
              </div>
              
              <div className="mt-6">
                <button 
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={socialLoading}
                  className="w-full bg-white text-slate-900 hover:bg-slate-100 py-3.5 rounded-2xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-white/5 disabled:opacity-50"
                >
                  {socialLoading ? (
                    <Loader2 className="animate-spin text-slate-900" size={18} />
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Lanjutkan dengan Google
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* FORM TAHAP 2: KHUSUS PIN ADMIN */
          <form onSubmit={handleVerifyPin} className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="text-center bg-amber-500/10 border border-amber-500/20 p-4 rounded-[25px]">
              <ShieldAlert className="text-amber-500 mx-auto mb-2" size={28} />
              <p className="text-white text-xs font-black italic uppercase tracking-widest">
                {tempProfile?.role} Detected
              </p>
              <p className="text-slate-400 text-[10px] lowercase font-medium">Input pin keamanan anda</p>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-amber-500 font-bold tracking-widest uppercase block text-center mb-2">Input 6-Digit Pin</label>
              <input
                type="password"
                maxLength={6}
                required
                autoFocus
                className="w-full bg-slate-900/50 border border-amber-500/30 text-white text-2xl tracking-[0.8em] text-center rounded-2xl focus:ring-2 focus:ring-amber-500 focus:border-transparent block p-4 placeholder-slate-800 transition-all outline-none font-black"
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black italic uppercase py-4 rounded-2xl shadow-lg shadow-amber-500/30 transition-all transform active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : "KONFIRMASI AKSES"}
            </button>

            <button 
              type="button" 
              onClick={() => { setIsPinStage(false); setPin(""); setCaptchaToken(null); }}
              className="w-full text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:text-white transition-colors flex items-center justify-center gap-1"
            >
              <ChevronLeft size={14}/> Kembali ke Login
            </button>
          </form>
        )}

        {/* FOOTER LINK: Hanya muncul di tahap login awal */}
        {!isPinStage && (
          <div className="mt-8 pt-6 border-t border-white/10 text-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-3">Belum punya akun?</p>
              <Link href="/register" className="inline-flex items-center gap-2 text-xs font-black text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-wider group">
                  <UserPlus size={14} className="group-hover:scale-110 transition-transform"/> DAFTAR MEMBER BARU
              </Link>
          </div>
        )}
      </div>
      
      <div className="absolute bottom-6 text-center w-full">
         <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.3em]">System by Danish Top Up</p>
      </div>
    </div>
  );
}