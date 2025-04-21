# Frontend Design for Multi-Source Video Upload

## 1. Overview

This document details the frontend design for extending the existing video upload functionality to support multiple cloud storage sources, including:

- Amazon S3 (Phase 1 - immediate implementation)
- Google Drive (Future phase)
- Microsoft OneDrive (Future phase)
- (Existing) Local file upload
- (Existing) YouTube URL import

The design focuses on creating a modular, extensible interface that maintains the current user experience while adding new import options.

## 2. UI Component Structure

### 2.1 Updated Component Hierarchy

```
UploadStep
├── SourceSelector
│   ├── LocalUploadTab
│   ├── YouTubeTab
│   ├── S3Tab (Phase 1)
│   ├── GoogleDriveTab (Future)
│   └── OneDriveTab (Future)
├── FileSelectionArea
│   ├── LocalDropzone (existing)
│   ├── YouTubeUrlInput (existing)
│   ├── S3FileBrowser (Phase 1)
│   ├── GoogleDriveFileBrowser (Future)
│   └── OneDriveFileBrowser (Future)
├── SelectedFilesList
└── UploadControls
```

### 2.2 New Components

1. **SourceSelector**: A tabbed interface allowing users to switch between different upload sources
2. **S3FileBrowser**: Component for browsing and selecting files from connected S3 buckets
3. **GoogleDriveFileBrowser**: Component for browsing and selecting files from Google Drive (future)
4. **OneDriveFileBrowser**: Component for browsing and selecting files from OneDrive (future)
5. **ConnectorSelector**: Dropdown to select from configured connectors for each source type

## 3. UI Design

### 3.1 Source Selection Tabs

```
┌─────────┬──────────┬─────────┬───────────┬────────────┐
│  Local  │ YouTube  │   S3    │  G Drive  │  OneDrive  │
└─────────┴──────────┴─────────┴───────────┴────────────┘
```

- Horizontal tab layout at the top of the upload area
- Active tab is highlighted
- Each tab shows a relevant icon and label
- Responsive design collapses to dropdown on mobile
- Google Drive and OneDrive tabs will be disabled/hidden in Phase 1

### 3.2 S3 File Browser (Phase 1)

```
┌─────────────────────────────────────────────────────┐
│ Select S3 Connector:  [Dropdown of connectors]  [+] │
├─────────────────────────────────────────────────────┤
│ Bucket: [Dropdown of buckets]                       │
├─────────────────────────────────────────────────────┤
│ Search: [Search box]                   [Filter ▼]   │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ Name           │ Size    │ Type    │ Modified   │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ □ video1.mp4   │ 24.5 MB │ MP4     │ Yesterday  │ │
│ │ □ video2.mov   │ 156 MB  │ MOV     │ 3 days ago │ │
│ │ □ video3.avi   │ 78.2 MB │ AVI     │ 1 week ago │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [Load More]                                         │
└─────────────────────────────────────────────────────┘
```

- Connector dropdown with "Add New" button
- Bucket selection dropdown
- Search and filter functionality
- File listing with checkboxes for selection
- Pagination with "Load More" button
- File details including size, type, and last modified date

### 3.3 S3 Connector Creation Modal (Phase 1)

```
┌─────────────────────────────────────────────────────┐
│ Create S3 Connector                           [✕]   │
├─────────────────────────────────────────────────────┤
│ Connector Name:                                     │
│ [                                             ]     │
│                                                     │
│ IAM Role ARN:                                       │
│ [                                             ]     │
│                                                     │
│ External ID: (auto-generated)                       │
│ [abc123def456ghi789]                                │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Instructions for IAM Role Setup                 │ │
│ │                                                 │ │
│ │ 1. Create an IAM role in your AWS account       │ │
│ │ 2. Use the following trust relationship:        │ │
│ │    [Copy to clipboard]                          │ │
│ │ 3. Attach a policy with these permissions:      │ │
│ │    [Copy to clipboard]                          │ │
│ │ 4. Enter the role ARN above                     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [Cancel]                              [Create]      │
└─────────────────────────────────────────────────────┘
```

- Form for entering connector name and IAM role ARN
- Auto-generated external ID for security
- Clear instructions for IAM role setup
- Copy-to-clipboard buttons for trust relationship and policy JSON

### 3.4 Google Drive File Browser (Future Phase)

```
┌─────────────────────────────────────────────────────┐
│ Connect to Google Drive:  [Connect Button]          │
├─────────────────────────────────────────────────────┤
│ Folder: [Breadcrumb navigation]                     │
├─────────────────────────────────────────────────────┤
│ Search: [Search box]                   [Filter ▼]   │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ [Folder icon] My Videos                         │ │
│ │ [File icon] □ presentation_video.mp4            │ │
│ │ [File icon] □ product_demo.mp4                  │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [Load More]                                         │
└─────────────────────────────────────────────────────┘
```

- OAuth-based authentication flow
- Folder navigation with breadcrumbs
- File and folder icons
- Similar selection and pagination mechanisms

### 3.5 OneDrive File Browser (Future Phase)

Similar layout to Google Drive File Browser, with Microsoft-specific authentication.

### 3.6 Selected Files List

```
┌─────────────────────────────────────────────────────┐
│ Selected Files (3)                                  │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ video1.mp4 (Local)                       [✕]    │ │
│ │ 24.5 MB                                         │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ https://youtube.com/watch?v=abc123 (YouTube)    │ │
│ │                                          [✕]    │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ product_demo.mp4 (S3)                    [✕]    │ │
│ │ 35.7 MB                                         │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- Consistent display of selected files regardless of source
- Source indicator for each file
- Remove button for each file
- File size and other relevant metadata

## 4. User Flow

### 4.1 S3 Connector Setup Flow (Phase 1)

1. User navigates to the upload page
2. User selects the "S3" tab
3. User clicks "+" button next to the connector dropdown
4. System displays the connector creation modal
5. User enters connector name and IAM role ARN
6. System validates the inputs
7. User clicks "Create"
8. System creates the connector and adds it to the dropdown
9. User can now select the connector and browse S3 buckets

### 4.2 S3 Import Flow (Phase 1)

1. User selects the "S3" tab
2. User selects an existing S3 connector from dropdown
3. System displays available buckets
4. User selects a bucket
5. System displays files in the bucket with pagination
6. User can search or filter files
7. User selects files by checking checkboxes
8. Selected files appear in the "Selected Files" list
9. User clicks "Upload" to start the import process
10. System shows progress for each file
11. Upon completion, user is redirected to the video library or processing status page

### 4.3 Google Drive Import Flow (Future Phase)

1. User selects the "Google Drive" tab
2. If not connected, user clicks "Connect" and completes OAuth flow
3. System displays Google Drive files and folders
4. User navigates folders and/or searches for files
5. User selects files by checking checkboxes
6. Selected files appear in the "Selected Files" list
7. User clicks "Upload" to start the import process
8. System shows progress for each file
9. Upon completion, user is redirected to the video library or processing status page

### 4.4 OneDrive Import Flow (Future Phase)

Similar to Google Drive flow, with Microsoft-specific authentication.

## 5. Implementation Details

### 5.1 Integration with Existing UploadStep Component

The current `UploadStep.tsx` component will be refactored to:

1. Maintain backward compatibility
2. Support the tabbed interface for source selection
3. Conditionally render the appropriate file browser based on selected tab
4. Handle file selection from multiple sources in a unified way
5. Track upload progress for all sources consistently

### 5.2 State Management

```typescript
// Extended state for UploadStep component
const [selectedSource, setSelectedSource] = useState<'local' | 'youtube' | 's3' | 'gdrive' | 'onedrive'>('local');
const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
const [selectedFiles, setSelectedFiles] = useState<Array<{
  file: File | null;  // null for remote files
  name: string;
  size: number;
  source: 'local' | 'youtube' | 's3' | 'gdrive' | 'onedrive';
  sourceId: string;   // URL, S3 path, Drive ID, etc.
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}>>([]);
```

### 5.3 Component Props

```typescript
// S3FileBrowser props (Phase 1)
interface S3FileBrowserProps {
  connectorId: string | null;
  onConnectorChange: (connectorId: string) => void;
  onFileSelect: (files: Array<{name: string, size: number, path: string}>) => void;
  onCreateConnector: () => void;
}

// S3ConnectorForm props (Phase 1)
interface S3ConnectorFormProps {
  onSubmit: (connectorData: {name: string, roleArn: string}) => Promise<void>;
  onCancel: () => void;
}

// Future phase components will have similar prop interfaces
```

### 5.4 API Integration (Phase 1 - S3)

```typescript
// Function to fetch S3 connectors
const fetchS3Connectors = async (): Promise<Array<{id: string, name: string}>> => {
  const response = await fetch(`${API_ENDPOINT}/connectors/s3`, {
    headers: {
      'Authorization': `Bearer ${session.token}`
    }
  });
  return response.json();
};

// Function to create S3 connector
const createS3Connector = async (name: string, roleArn: string): Promise<{id: string}> => {
  const response = await fetch(`${API_ENDPOINT}/connectors/s3`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.token}`
    },
    body: JSON.stringify({ name, roleArn })
  });
  return response.json();
};

// Function to list S3 buckets
const listS3Buckets = async (connectorId: string): Promise<string[]> => {
  const response = await fetch(`${API_ENDPOINT}/connectors/s3/${connectorId}/buckets`, {
    headers: {
      'Authorization': `Bearer ${session.token}`
    }
  });
  return response.json();
};

// Function to list files in S3 bucket
const listS3Files = async (
  connectorId: string, 
  bucket: string, 
  prefix: string = '',
  continuationToken?: string
): Promise<{
  files: Array<{name: string, size: number, lastModified: string, type: string}>,
  nextContinuationToken?: string
}> => {
  const params = new URLSearchParams();
  if (prefix) params.append('prefix', prefix);
  if (continuationToken) params.append('continuationToken', continuationToken);
  
  const response = await fetch(
    `${API_ENDPOINT}/connectors/s3/${connectorId}/buckets/${bucket}?${params.toString()}`, 
    {
      headers: {
        'Authorization': `Bearer ${session.token}`
      }
    }
  );
  return response.json();
};

// Function to import S3 files
const importS3Files = async (
  connectorId: string,
  files: Array<{bucket: string, key: string}>,
  indexId: string
): Promise<Array<{videoId: string}>> => {
  const response = await fetch(`${API_ENDPOINT}/videos/import/s3`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.token}`
    },
    body: JSON.stringify({
      connectorId,
      files,
      indexId
    })
  });
  return response.json();
};
```

### 5.5 Responsive Design Considerations

- On mobile devices, the tabbed interface collapses to a dropdown
- File browsers adjust column visibility based on screen width
- Touch-friendly controls for mobile users
- Responsive grid layout for file listings on smaller screens

## 6. Code Structure

```
prototype/frontend/
  components/
    indexing/
      UploadStep.tsx                # Main component (refactored)
      SourceSelector.tsx            # Tab interface for sources
      connectors/
        S3ConnectorSelector.tsx     # S3 connector dropdown (Phase 1)
        S3ConnectorForm.tsx         # Form to create/edit S3 connectors (Phase 1)
      sources/
        S3FileBrowser.tsx           # S3 file browser (Phase 1)
        GoogleDriveFileBrowser.tsx  # Google Drive file browser (Future)
        OneDriveFileBrowser.tsx     # OneDrive file browser (Future)
      SelectedFilesList.tsx         # Unified selected files display
      UploadProgress.tsx            # Progress tracking component
```

## 7. Implementation Phases

### 7.1 Phase 1: S3 Integration

1. Implement the SourceSelector component with tabs for Local, YouTube, and S3
2. Implement S3ConnectorSelector and S3ConnectorForm components
3. Implement S3FileBrowser component
4. Update UploadStep to handle S3 file selection and import
5. Implement backend API endpoints for S3 connector operations

### 7.2 Future Phases

1. **Google Drive Integration**:
   - Implement GoogleDriveFileBrowser component
   - Add OAuth authentication flow for Google Drive
   - Implement backend API endpoints for Google Drive operations

2. **OneDrive Integration**:
   - Implement OneDriveFileBrowser component
   - Add OAuth authentication flow for Microsoft
   - Implement backend API endpoints for OneDrive operations

## 8. Error Handling

The design includes comprehensive error handling for various scenarios:

1. **Connector Creation Errors**:
   - Invalid IAM role ARN format
   - Insufficient permissions
   - Role assumption failures

2. **Bucket Listing Errors**:
   - No buckets available
   - Permission denied

3. **File Browsing Errors**:
   - Empty bucket
   - Network failures
   - Pagination errors

4. **Import Errors**:
   - File too large
   - Unsupported file format
   - Transfer failures

Each error scenario will have appropriate user feedback and recovery options.

## 9. Extensibility

The design is structured to allow easy addition of more cloud storage providers in the future:

1. The SourceSelector component is designed to accept additional tabs
2. The file selection and upload logic is abstracted to handle different source types
3. The state management approach can accommodate additional source types
4. The component hierarchy allows for plugging in new file browser components

This modular approach ensures that the system can be extended without major refactoring.