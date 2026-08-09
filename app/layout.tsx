import type { Metadata } from "next";
import { Geist, Geist_Mono, VT323 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { ToastHost } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const vt323 = VT323({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GigaWork — Autonomous AI Workforce",
  description: "One Prompt → Autonomous Execution → One Report.",
};

// Inline polyfill: prevents OKX Wallet / Coin98 / evmAsk.js from throwing
// "Cannot redefine property: ethereum" when multiple wallet extensions compete.
// Also normalizes 127.0.0.1 -> localhost and suppresses Privy "Origin not allowed" unhandled rejections in local dev.
const headPolyfill = `(function(){
  try {
    if (typeof location !== 'undefined' && location.hostname === '127.0.0.1') {
      location.replace(location.href.replace('//127.0.0.1', '//localhost'));
    }
  } catch(e) {}
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', function(event) {
        var reason = event && (event.reason || event);
        var msg = (reason && (reason.message || reason.stack || String(reason))) || '';
        if (msg.indexOf('Origin not allowed') !== -1 || msg.indexOf('auth.privy.io') !== -1 || (msg.indexOf('403') !== -1 && msg.indexOf('sessions') !== -1)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      window.addEventListener('error', function(event) {
        var msg = (event && (event.message || (event.error && event.error.message))) || '';
        if (msg.indexOf('Origin not allowed') !== -1) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  } catch(e) {}
  try {
    var orig = Object.defineProperty;
    Object.defineProperty = function(obj, prop, desc) {
      if (obj === window && prop === 'ethereum' && window.ethereum) return obj;
      return orig.call(this, obj, prop, desc);
    };
  } catch(e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} ${vt323.variable} h-full antialiased`}
    >
      <head>
        {/* Must run before any extension injects or Privy initializes — blocks parser intentionally */}
        <script dangerouslySetInnerHTML={{ __html: headPolyfill }} />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-[#08090d] text-white/90">
        <AuthProvider>
          {children}
          <ToastHost />
        </AuthProvider>
      </body>
    </html>
  );
}
