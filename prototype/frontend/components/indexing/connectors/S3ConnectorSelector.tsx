'use client'

import { useState, useEffect } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { connectorsApi } from '@/lib/api'

interface S3Connector {
  id: string
  name: string
}

interface S3ConnectorSelectorProps {
  selectedConnectorId: string | null
  onConnectorChange: (connectorId: string) => void
  onCreateConnector: () => void
  disabled?: boolean
}

export default function S3ConnectorSelector({
  selectedConnectorId,
  onConnectorChange,
  onCreateConnector,
  disabled = false
}: S3ConnectorSelectorProps) {
  const [connectors, setConnectors] = useState<S3Connector[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchConnectors = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await connectorsApi.fetchConnectors()
        setConnectors(data)
        
        // If we have connectors and none is selected, select the first one
        if (data.length > 0 && !selectedConnectorId) {
          onConnectorChange(data[0].id)
        }
      } catch (err) {
        console.error('Error fetching S3 connectors:', err)
        setError(err instanceof Error ? err.message : 'Failed to load S3 connectors')
      } finally {
        setIsLoading(false)
      }
    }

    fetchConnectors()
  }, [selectedConnectorId, onConnectorChange])

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Select S3 Connector
      </label>
      <div className="flex gap-2">
        <select
          value={selectedConnectorId || ''}
          onChange={(e) => onConnectorChange(e.target.value)}
          disabled={disabled || isLoading || connectors.length === 0}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <option value="">Loading connectors...</option>
          ) : connectors.length === 0 ? (
            <option value="">No connectors available</option>
          ) : (
            connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={onCreateConnector}
          disabled={disabled || isLoading}
          className="p-2 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Create new connector"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}