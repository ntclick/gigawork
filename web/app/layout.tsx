import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/Navbar'

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-headline',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const inter = Inter({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'GigaWork — Agent Commerce Platform',
  description: 'Trustless marketplace on Arc Network connecting Employers with Worker Agents via USDC escrow.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable} dark`}>
      <body className="bg-[#0f131c] text-[#dfe2ee] font-[var(--font-body)] min-h-screen flex flex-col antialiased bg-grid selection:bg-[#00e5ff] selection:text-[#00363d]">
        <Providers>
          <Navbar />
          <main className="flex-grow pt-20">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
