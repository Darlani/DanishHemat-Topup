/** @type {import('next').NextConfig} */
const scriptSrc = process.env.NODE_ENV === 'production'
  ? "'self' 'unsafe-inline' https://challenges.cloudflare.com"
  : "'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com";

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ptdezfwyamskazfwswxh.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
           {
            key: 'Content-Security-Policy',
            value: `script-src ${scriptSrc}; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://ptdezfwyamskazfwswxh.supabase.co wss://ptdezfwyamskazfwswxh.supabase.co https://challenges.cloudflare.com https://api.ipify.org;`
          },
        ],
      },
    ];
  },

compiler: {
    // Menghapus console.log di production demi keamanan dan kecepatan,
    // tapi menyisakan console.error buat jaga-jaga kalau ada bug fatal.
    removeConsole: process.env.NODE_ENV === "production" ? {
      exclude: ["error"],
    } : false,
  },

  experimental: {
    // Bersih dari fitur yang belum stabil
  },

  // INI MANTRA BARU YANG BENAR UNTUK NEXT.JS 15+ BOS!
  devIndicators: false,

async redirects() {
    return [
      {
        // Gunakan :slug* agar jika ada sub-path tetap terlempar ke URL baru
        source: '/ProductSection/:slug*',
        destination: '/:slug*',
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return [
      {
        // Tambahkan rute aplikasi (ref, register, user, auth, dsb) dan 'public' ke daftar pengecualian agar tidak ter-rewrite ke ProductSection
        source: '/:slug((?!admin|api|login|register|ref|user|checkout|forgot-password|setup-2fa|update-password|promotions|qris-analyzer|qris-generator|public|_next|static|favicon.ico).*)',
        destination: '/ProductSection/:slug',
      },
    ];
  },
};

export default nextConfig;
