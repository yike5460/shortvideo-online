import Script from 'next/script'

interface VideoStructuredDataProps {
  title: string
  description: string
  thumbnailUrl: string
  uploadDate: string
  duration: string
  videoUrl?: string
  embedUrl?: string
  contentUrl?: string
}

export default function VideoStructuredData({
  title,
  description,
  thumbnailUrl,
  uploadDate,
  duration,
  videoUrl,
  embedUrl,
  contentUrl,
}: VideoStructuredDataProps) {
  // Convert duration from format like "01:00:00" to ISO 8601 duration
  const convertToISO8601Duration = (duration: string) => {
    const parts = duration.split(':')
    if (parts.length === 3) {
      const hours = parseInt(parts[0])
      const minutes = parseInt(parts[1])
      const seconds = parseInt(parts[2])
      return `PT${hours > 0 ? `${hours}H` : ''}${minutes > 0 ? `${minutes}M` : ''}${seconds}S`
    }
    return 'PT0S'
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": title,
    "description": description,
    "thumbnailUrl": thumbnailUrl,
    "uploadDate": uploadDate,
    "duration": convertToISO8601Duration(duration),
    "contentUrl": contentUrl || videoUrl,
    "embedUrl": embedUrl,
    "interactionStatistic": {
      "@type": "InteractionCounter",
      "interactionType": { "@type": "WatchAction" },
      "userInteractionCount": Math.floor(Math.random() * 10000) // Replace with actual view count
    },
    "publisher": {
      "@type": "Organization",
      "name": "Know Your Moments",
      "logo": {
        "@type": "ImageObject",
        "url": "https://knowyourmoments.com/logo.png"
      }
    }
  }

  return (
    <Script
      id={`video-structured-data-${title.replace(/\s+/g, '-').toLowerCase()}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData),
      }}
    />
  )
}