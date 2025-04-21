'use client'

import { useState } from 'react'
import { XMarkIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'

const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

interface S3ConnectorFormProps {
  onSubmit: (connectorData: { name: string; roleArn: string }) => Promise<void>
  onCancel: () => void
}

export default function S3ConnectorForm({ onSubmit, onCancel }: S3ConnectorFormProps) {
  const [name, setName] = useState('')
  const [roleArn, setRoleArn] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Generate a unique external ID for the trust relationship
  const [externalId] = useState(() => {
    const randomId = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15)
    return `video-search-${randomId}`
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate inputs
    if (!name.trim()) {
      setError('Connector name is required')
      return
    }
    
    if (!roleArn.trim()) {
      setError('IAM Role ARN is required')
      return
    }
    
    // Validate ARN format
    const arnRegex = /^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/
    if (!arnRegex.test(roleArn)) {
      setError('Invalid IAM Role ARN format. It should look like: arn:aws:iam::123456789012:role/RoleName')
      return
    }
    
    setIsSubmitting(true)
    setError(null)
    
    try {
      await onSubmit({ name, roleArn })
    } catch (err) {
      console.error('Error creating S3 connector:', err)
      setError(err instanceof Error ? err.message : 'Failed to create S3 connector')
    } finally {
      setIsSubmitting(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard')
      })
      .catch(err => {
        console.error('Failed to copy:', err)
      })
  }

  // Generate the trust relationship JSON
  const trustRelationshipJson = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: 'arn:aws:iam::ACCOUNT_ID:role/video-search-service-role'
        },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: {
            'sts:ExternalId': externalId
          }
        }
      }
    ]
  }, null, 2)

  // Generate the policy JSON
  const policyJson = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          's3:ListBucket'
        ],
        Resource: [
          'arn:aws:s3:::your-bucket-name'
        ]
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject'
        ],
        Resource: [
          'arn:aws:s3:::your-bucket-name/*'
        ]
      }
    ]
  }, null, 2)

  // Handle click outside to close the modal
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
        {/* Fixed header with close button that stays at the top */}
        <div className="sticky top-0 bg-white z-10 pb-2 mb-4 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Create S3 Connector</h2>
            <button
              onClick={onCancel}
              className="p-2 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Connector Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My S3 Connector"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-primary-500 focus:ring-primary-500"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="roleArn" className="block text-sm font-medium text-gray-700 mb-1">
                IAM Role ARN
              </label>
              <input
                id="roleArn"
                type="text"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                placeholder="arn:aws:iam::123456789012:role/S3ConnectorRole"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-primary-500 focus:ring-primary-500"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                External ID (for trust relationship)
              </label>
              <div className="flex">
                <input
                  type="text"
                  value={externalId}
                  readOnly
                  className="flex-1 rounded-l-lg border border-gray-300 px-4 py-2 bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(externalId)}
                  className="rounded-r-lg border border-l-0 border-gray-300 px-3 py-2 bg-gray-50 hover:bg-gray-100"
                >
                  <ClipboardDocumentIcon className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Instructions for IAM Role Setup</h3>
              <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                <li>Create an IAM role in your AWS account</li>
                <li>
                  Use the following trust relationship:
                  <div className="relative mt-1">
                    <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">{trustRelationshipJson}</pre>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(trustRelationshipJson)}
                      className="absolute top-2 right-2 p-1 bg-white rounded hover:bg-gray-200"
                      title="Copy to clipboard"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                </li>
                <li>
                  Attach a policy with these permissions (update bucket name):
                  <div className="relative mt-1">
                    <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">{policyJson}</pre>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(policyJson)}
                      className="absolute top-2 right-2 p-1 bg-white rounded hover:bg-gray-200"
                      title="Copy to clipboard"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                </li>
                <li>Enter the role ARN above</li>
              </ol>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Creating...' : 'Create Connector'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}