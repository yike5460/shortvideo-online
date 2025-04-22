# S3 Connector Search Functionality Fix

## Issue
The search box to filter videos in the S3 bucket is currently making API calls to the backend for each search query. According to the feedback, we need to implement client-side filtering instead of invoking the backend API.

## Current Implementation
Currently, in the `S3FileBrowser.tsx` component:
1. When the search query changes, it triggers a new API call with the search query as a prefix parameter
2. The backend filters the files based on this prefix
3. The component displays only the files returned by the backend

## Proposed Solution
We need to modify the component to:
1. Fetch all files from the bucket without filtering by search query on the backend
2. Store these files in state
3. Implement client-side filtering based on the search query
4. Update the UI to display only the filtered files

## Implementation Details

### 1. Modify the useEffect hook for fetching files
The current implementation fetches files when the bucket changes or search query changes. We should modify it to only fetch files when the bucket changes, not when the search query changes.

```typescript
// Fetch files when bucket changes (remove searchQuery dependency)
useEffect(() => {
  if (!connectorId || !selectedBucket) {
    setFiles([])
    return
  }

  const fetchFiles = async (token?: string) => {
    setIsLoadingFiles(true)
    setError(null)
    try {
      let url = `${API_ENDPOINT}/connectors/s3/${connectorId}/buckets/${selectedBucket}?`
      
      // Remove search query parameter
      
      // Add continuation token if provided
      if (token) {
        url += `continuationToken=${encodeURIComponent(token)}`
      }
      
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (token) {
        // Append to existing files if using continuation token
        setFiles(prev => [...prev, ...data.files])
      } else {
        // Replace files if this is a new bucket
        setFiles(data.files)
      }
      
      // Update continuation token and hasMore flag
      setContinuationToken(data.nextContinuationToken || null)
      setHasMore(!!data.nextContinuationToken)
    } catch (err) {
      console.error('Error fetching S3 files:', err)
      setError(err instanceof Error ? err.message : 'Failed to load S3 files')
    } finally {
      setIsLoadingFiles(false)
    }
  }

  // Reset continuation token and fetch files
  setContinuationToken(null)
  fetchFiles()
}, [connectorId, selectedBucket]) // Remove searchQuery dependency
```

### 2. Add client-side filtering for the search query
Create a new derived state for filtered files based on the search query:

```typescript
// Add this before the return statement
const filteredFiles = files.filter(file => {
  if (!searchQuery) return true
  return file.name.toLowerCase().includes(searchQuery.toLowerCase())
})

// Filter to only show video files from the filtered files
const videoFiles = filteredFiles.filter(file => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension === 'mp4' || extension === 'mov' || extension === 'avi'
})
```

### 3. Update the handleSearch function
The handleSearch function should prevent the default form submission and not trigger any API calls:

```typescript
const handleSearch = (e: React.FormEvent) => {
  e.preventDefault()
  // No API call needed, the filtering happens in the derived state
}
```

### 4. Update the handleLoadMore function
The handleLoadMore function should not include the search query parameter:

```typescript
const handleLoadMore = () => {
  if (connectorId && selectedBucket && continuationToken) {
    // Fetch more files using the continuation token
    const fetchMoreFiles = async () => {
      setIsLoadingFiles(true)
      setError(null)
      try {
        let url = `${API_ENDPOINT}/connectors/s3/${connectorId}/buckets/${selectedBucket}?`
        
        // Remove search query parameter
        
        // Add continuation token
        url += `continuationToken=${encodeURIComponent(continuationToken)}`
        
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
        
        if (!response.ok) {
          throw new Error(`Failed to fetch more files: ${response.statusText}`)
        }
        
        const data = await response.json()
        
        // Append to existing files
        setFiles(prev => [...prev, ...data.files])
        
        // Update continuation token and hasMore flag
        setContinuationToken(data.nextContinuationToken || null)
        setHasMore(!!data.nextContinuationToken)
      } catch (err) {
        console.error('Error fetching more S3 files:', err)
        setError(err instanceof Error ? err.message : 'Failed to load more S3 files')
      } finally {
        setIsLoadingFiles(false)
      }
    }
    
    fetchMoreFiles()
  }
}
```

### 5. Update the UI to display the filtered files
The UI is already set up to display the videoFiles array, which will now be derived from the filteredFiles array. No changes needed here.

## Benefits of This Approach
1. **Improved Performance**: Filtering happens on the client side, eliminating network requests for each search query
2. **Better User Experience**: Search results appear instantly as the user types
3. **Reduced Backend Load**: Fewer API calls to the backend server
4. **Offline Capability**: Once the files are loaded, users can search even if the connection is temporarily lost

## Implementation Steps
1. Switch to Code mode
2. Open the `prototype/frontend/components/indexing/sources/S3FileBrowser.tsx` file
3. Make the changes outlined above
4. Test the search functionality to ensure it works correctly

## Note
This implementation assumes that the number of files in a bucket is manageable for client-side filtering. If buckets can contain thousands of files, we may need to consider a hybrid approach or pagination with server-side filtering.