import Script from 'next/script'

interface FAQItem {
  question: string
  answer: string
}

interface FAQStructuredDataProps {
  items: FAQItem[]
}

export default function FAQStructuredData({ items }: FAQStructuredDataProps) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": items.map(item => ({
      "@type": "Question",
      "name": item.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": item.answer
      }
    }))
  }

  return (
    <Script
      id="faq-structured-data"
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData),
      }}
    />
  )
}

// Default FAQs for the platform
export const defaultFAQs: FAQItem[] = [
  {
    question: "What is Know Your Moments?",
    answer: "Know Your Moments is an AI-powered video search and analysis platform that allows you to find exact moments in videos using natural language queries, visual recognition, and multimodal search capabilities."
  },
  {
    question: "How does the AI video search work?",
    answer: "Our platform uses advanced multimodal embedding engines to process visual elements, audio components, and text within videos. This allows you to search using text descriptions, images, audio clips, or even other video segments to find exactly what you're looking for."
  },
  {
    question: "Can I search for specific brands or products in videos?",
    answer: "Yes! Our AI can detect and identify brands, logos, products, and specific objects within videos. You can search for brand appearances, product placements, or any visual element across your entire video library."
  },
  {
    question: "What video formats are supported?",
    answer: "We support all major video formats including MP4, AVI, MOV, MKV, and more. Videos can be uploaded directly or connected through cloud storage solutions like AWS S3."
  },
  {
    question: "How accurate is the video analysis?",
    answer: "Our AI models achieve over 95% accuracy in object detection, scene recognition, and speech transcription. The platform continuously learns and improves from user interactions to provide even better results over time."
  },
  {
    question: "Is there a free trial available?",
    answer: "Yes! We offer a free tier that allows you to get started with basic features. You can upload and analyze videos, perform searches, and experience the core functionality without any credit card required."
  },
  {
    question: "How long does it take to process videos?",
    answer: "Processing time depends on video length and quality. Typically, a 10-minute video is fully indexed and searchable within 2-3 minutes. Longer videos are processed proportionally, with real-time status updates."
  },
  {
    question: "Can I integrate this with my existing workflow?",
    answer: "Absolutely! We provide REST APIs and SDKs for seamless integration with your existing video management systems, content platforms, and workflows."
  }
]