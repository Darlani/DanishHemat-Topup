"use client";

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { 
  Gamepad2, LogOut, Search, Loader2, X, 
  Globe, Newspaper, Tag, ReceiptText, UserCircle, Menu
} from 'lucide-react';
import TransactionHistoryModal from '@/components/TransactionHistoryModal'; 
import { supabase } from "@/utils/supabaseClient";
import { Turnstile } from '@marsidev/react-turnstile';
import SandboxSessionControl from '@/components/sandbox/SandboxSessionControl';

interface NavbarProps {
  isSidebarOpen?: boolean;
  setIsSidebarOpen?: (val: boolean) => void;
}

export default function Navbar({ isSidebarOpen = false, setIsSidebarOpen }: NavbarProps) {
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true); // State baru untuk loading
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // --- STATE PENCARIAN & MODAL ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [suggestionText, setSuggestionText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const isAdminPage = pathname.startsWith('/admin');
  const isLoginPage = pathname === '/login'; // Aturan untuk mendeteksi halaman login

useEffect(() => {
    const checkAuth = async () => {
      if (typeof window !== "undefined") {
        // Jangan paksa signOut jika sedang berada di halaman login, setup 2FA, atau register
        if (pathname === '/login' || pathname === '/setup-2fa' || pathname === '/register') {
          setIsCheckingAuth(false);
          return;
        }

        // 1. CEK COOKIE TERLEBIH DAHULU SEBAGAI PATOKAN UTAMA (1 HARI)
        const hasCookie = document.cookie.includes('sb-access-token');
        if (!hasCookie) {
          // Jika cookie hangus, paksa hapus sesi di frontend agar Navbar langsung "Sign In"
          await supabase.auth.signOut();
          localStorage.removeItem("isAdmin");
          localStorage.removeItem("isUser");
          setRole(null);
          setIsCheckingAuth(false);
          return;
        }

        // 2. Cek user asli langsung ke server Supabase demi keamanan
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (!user || error) {
          localStorage.removeItem("isAdmin");
          localStorage.removeItem("isUser");
          setRole(null);
          setIsCheckingAuth(false); // Stop loading karena sesi habis
          return;
        }

        // Jika sesi masih valid, jalankan logika set role
        const isAdmin = localStorage.getItem("isAdmin") === "true";
        const isUser = localStorage.getItem("isUser") === "true";
        if (isAdmin) setRole('admin');
        else if (isUser) setRole('user');
        else setRole(null);
        
        setIsCheckingAuth(false); // Stop loading karena sesi valid
      }
    };
    checkAuth();

    // Listener agar UI dan Server (proxy.ts) selalu sinkron
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        localStorage.removeItem("isAdmin");
        localStorage.removeItem("isUser");
        setRole(null);
        // Bersihkan cookie juga biar server benar-benar tahu kita logout
        document.cookie = "sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
        document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
      } else if (event === 'TOKEN_REFRESHED' && session) {
        // SINKRONISASI: Ambil umur token terbaru dari pusat dan segera update cookie-nya!
        const refreshExpiresIn = session.expires_in;
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${refreshExpiresIn}; Secure; SameSite=Lax`;
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [pathname]);

  // Listener untuk membuka modal dari BottomNav
  useEffect(() => {
    const handleOpenHistory = () => setIsHistoryOpen(true);
    window.addEventListener('openHistoryModal', handleOpenHistory);
    return () => window.removeEventListener('openHistoryModal', handleOpenHistory);
  }, []);

  // Klik luar tutup dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Logika Pencarian
  useEffect(() => {
    const fetchSearch = async () => {
      const keyword = searchQuery.trim();
      if (!keyword) {
        setSearchResults([]);
        setShowDropdown(false);
        return;
      }
      setIsSearching(true);
      setShowDropdown(true);

      try {
        const { data } = await supabase
          .from('brands')
          .select('name, slug, image_url, active')
          .or(`name.ilike.%${keyword}%,slug.ilike.%${keyword}%`)
          .eq('active', true)
          .limit(8);
        if (data) setSearchResults(data);
      } catch (err) {
        console.error("Gagal cari:", err);
      } finally {
        setIsSearching(false);
      }
    };
    const timer = setTimeout(fetchSearch, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

const handleLogout = async () => {
    if (confirm("Yakin ingin keluar?")) {
      // 1. Hapus sesi langsung dari server Supabase
      await supabase.auth.signOut();
      
      // 2. Hapus cookie keamanan agar proxy.ts tahu kita sudah logout
      document.cookie = "sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
      
      // 3. Bersihkan memori lokal
      localStorage.clear();
      window.location.href = "/";
    }
  };

  // Deteksi environment agar Turnstile tidak memblokir saat di localhost
  const isLocal = typeof window !== "undefined" && window.location.hostname === "localhost";

  const handleSendSuggestion = async () => {
    // Kalau di lokal, token kosong tidak masalah (dibypass)
    if (!suggestionText.trim() || (!captchaToken && !isLocal)) return alert("Selesaikan verifikasi keamanan dulu!");
    setIsSending(true);
    try {
      const { error } = await supabase.from('product_suggestions').insert([{ content: suggestionText.trim() }]);
      if (error) throw error;
      alert("Saran diterima! Makasih ya Bos.");
      setSuggestionText(""); setCaptchaToken(null); setIsSuggestionOpen(false);
    } catch (err) {
      alert("Gagal kirim.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <nav className={`bg-[#0f172a] border-b border-slate-800 sticky top-0 z-50 shadow-xl w-full transition-all duration-300 ${isAdminPage ? (isSidebarOpen ? "md:pl-0" : "md:pl-0") : ""}`}>
        <div className={`mx-auto px-4 md:px-12 py-3 flex items-center justify-between transition-all duration-300 ${isAdminPage ? "max-w-7xl" : "max-w-7xl"}`}>
          
          <div className="flex items-center gap-3 shrink-0">
            {/* TOMBOL MENU KHUSUS ADMIN MOBILE */}
            {isAdminPage && setIsSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
                className="md:hidden p-2 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg transition-colors"
              >
                <Menu size={20} />
              </button>
            )}

            {/* LOGO */}
          <Link href="/" className="flex items-center shrink-0">
            <Image
              src="/images/DaPay.svg"
              alt="DanisPay"
              width={1269}
              height={313}
              priority
              className="h-7 sm:h-8 w-auto"
            />
          </Link>
        </div> {/* Penutup div pembungkus Menu & Logo */}

          {/* SEARCH BAR (Tengah) */}
          <div ref={searchRef} className="flex-1 max-w-md mx-4 sm:mx-8 relative">
            <div className="relative w-full group">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery && setShowDropdown(true)}
                placeholder="Cari produk..."
                className="w-full bg-slate-900/50 border border-slate-700 text-white text-[10px] sm:text-[11px] font-black uppercase italic py-2.5 px-8 sm:px-10 rounded-xl focus:outline-none focus:border-blue-500 transition-all"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500" size={14} />
              {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" size={14} />}
            </div>

            {/* DROPDOWN HASIL (Tetap sama) */}
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-999">
                <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                  {isSearching ? (
                    <div className="p-4 text-center text-slate-400 text-[10px] font-bold uppercase italic">Mencari...</div>
                  ) : searchResults.length > 0 ? (
                    <div className="py-2">
                      {searchResults.map((item: any, idx: number) => (
                        <div key={idx} onClick={() => { router.push(`/ProductSection/${item.slug}`); setShowDropdown(false); setSearchQuery(""); }} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-50 last:border-0">
                          <div className="w-10 h-10 relative rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                            {item.image_url ? ( <Image src={item.image_url} alt={item.name} fill sizes="40px" className="object-cover" priority={idx < 4} /> ) : ( <div className="w-full h-full flex items-center justify-center bg-blue-100 text-blue-600 font-bold text-[10px]">{item.name?.charAt(0)}</div> )}
                          </div>
                          <p className="text-sm font-bold text-slate-800 truncate">{item.name}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center">
                      <p className="text-slate-500 text-[13px] font-medium leading-relaxed">Game yang dicari tidak tersedia</p>
                      <button type="button" onClick={() => { setIsSuggestionOpen(true); setShowDropdown(false); }} className="text-blue-700 text-[14px] font-bold hover:underline mt-1 block w-full">Kasih saran game</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* MENU KANAN (Responsif) */}
          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            {/* Bahasa: Muncul di Mobile & Desktop */}
            <button className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors">
              <Globe size={18} />
              <span className="hidden sm:inline text-[10px] font-bold uppercase">ID</span>
            </button>

            {/* Menu Desktop: Sembunyi di HP (md:hidden) */}
            <div className="hidden md:flex items-center gap-5 border-l border-slate-700 pl-5">
              <Link href="/news" className="flex items-center gap-1.5 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wide transition-colors"><Newspaper size={14} /> News</Link>
              <Link href="/promo" className="flex items-center gap-1.5 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wide transition-colors"><Tag size={14} /> Promo</Link>
              
              <button onClick={() => setIsHistoryOpen(true)} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wide transition-colors">
                 <ReceiptText size={14} /> Lacak Pesanan
              </button>

          {isCheckingAuth ? (
                <div className="flex items-center gap-2 ml-2 border-l border-slate-700 pl-4">
                  {/* Skeleton Loading UI agar terlihat pro */}
                  <div className="h-8 w-20 bg-slate-800 animate-pulse rounded-lg"></div>
                </div>
              ) : role && !isLoginPage ? (
                <div className="flex items-center gap-2 ml-2 border-l border-slate-700 pl-4">
                  <SandboxSessionControl variant="navbar" />
                  <Link href={role === 'admin' ? "/admin" : "/user"} className="flex items-center gap-1.5 bg-blue-600/10 text-blue-500 px-4 py-2 rounded-lg text-[10px] font-bold uppercase border border-blue-500/20 hover:bg-blue-600 hover:text-white transition-all">
                    <UserCircle size={14} /> Akun
                  </Link>
                  <button onClick={handleLogout} className="p-2 bg-rose-600/10 text-rose-500 border border-rose-500/20 rounded-lg hover:bg-rose-600 hover:text-white transition-all">
                    <LogOut size={14} />
                  </button>
                </div>
              ) : (
                <Link href="/login" className="ml-2 border-l border-slate-700 pl-4">
                  <button className="flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20">
                    Sign In
                  </button>
                </Link>
              )}
            </div>
          </div>

        </div>
      </nav>

      {/* --- MODAL SARAN (Sama seperti sebelumnya) --- */}
      {isSuggestionOpen && (
        <div 
          className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          style={{ zIndex: 1000 }}
        >
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-800 uppercase italic">Kasih saran produk</h3>
              <button onClick={() => setIsSuggestionOpen(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6">
              <textarea value={suggestionText} onChange={(e) => setSuggestionText(e.target.value)} placeholder="Ketik di sini" className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none text-slate-800 placeholder:text-slate-400" />
              <div className="mt-4 flex justify-center"><Turnstile siteKey={isLocal ? "1x00000000000000000000AA" : "0x4AAAAAACkQAA6L_WPQSSms"} onSuccess={(t) => setCaptchaToken(t)} onExpire={() => setCaptchaToken(null)} options={{ theme: 'light' }} /></div>
              <button onClick={handleSendSuggestion} disabled={isSending || !suggestionText.trim() || (!captchaToken && !isLocal)} className="w-full mt-6 bg-blue-700 text-white py-4 rounded-full font-black uppercase italic hover:bg-blue-800 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
                {isSending ? <Loader2 className="animate-spin mx-auto" /> : (!captchaToken && !isLocal) ? "Verifikasi Dulu Bos" : "Kirim Saran"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RIWAYAT / LACAK PESANAN */}
      <TransactionHistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}