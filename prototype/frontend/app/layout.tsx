import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/lib/auth/AuthContext'
import { ToastProvider } from '@/components/ui/Toast'
import { CartProvider } from '@/lib/cart/CartContext'
import ClientLayout from '@/components/layout/ClientLayout'
import WebVitals from '@/components/seo/WebVitals'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// Move metadata to a separate file to avoid 'use client' conflict
export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#4F46E5" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
      </head>
      <body className={inter.className}>
        <WebVitals />
        <AuthProvider>
          <ToastProvider>
            <CartProvider>
              <ClientLayout>{children}</ClientLayout>
            </CartProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
