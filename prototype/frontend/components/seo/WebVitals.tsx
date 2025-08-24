'use client'

import { useEffect } from 'react'
import { onCLS, onFCP, onFID, onLCP, onTTFB, onINP } from 'web-vitals'

// Report web vitals to analytics service
function sendToAnalytics(metric: any) {
  // Replace with your analytics service
  // For Google Analytics 4:
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', metric.name, {
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      event_category: 'Web Vitals',
      event_label: metric.id,
      non_interaction: true,
    })
  }
  
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Web Vitals]', metric)
  }
}

export default function WebVitals() {
  useEffect(() => {
    // Core Web Vitals
    onCLS(sendToAnalytics) // Cumulative Layout Shift
    onFID(sendToAnalytics) // First Input Delay (deprecated, use INP)
    onLCP(sendToAnalytics) // Largest Contentful Paint
    
    // Additional metrics
    onFCP(sendToAnalytics) // First Contentful Paint
    onTTFB(sendToAnalytics) // Time to First Byte
    onINP(sendToAnalytics) // Interaction to Next Paint (replaces FID)
  }, [])

  return null
}