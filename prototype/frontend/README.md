## Overview:
User tutorial from upload image/video, set index parameter/embedding model, progress panel for ongoing job and detailed page for indexed image or video. Each step layout and element in detail are described below.

### Step 1: Upload image/video Page
- Step indicator (2/2)
- Index selector dropdown
- Large drop zone for file upload
- Detailed specification panel
- Upload requirements clearly listed
- Action buttons at bottom

### Step 2: Index Creation Page
- Step indicator (1/2)
- Form layout with:
  - Text input for index name
  - Warning message about model selection
  - Model selection cards with detailed specifications
  - Navigation buttons (Cancel/Next)
- Clear visual hierarchy with cards and icons

### Step 3: Progress Panel
- Tab navigation between "My videos" and "Sample videos"
- Free plan notification banner with learn more link
- Two-column layout:
  - Left: Create index CTA card
  - Right: Index preview card with creation date
- Material design influenced UI elements

### Step 4: Index Detail Page
- Header with index name and ID
- Two-model display (Amazon NOVA and VideoCLIP-XL) with visual/audio indicators
- Status panel showing video count and indexing progress
- Preview thumbnail of video being processed
- Clean, minimal design with dark mode support






Let me create a mermaid sequence diagram showing the complete workflow:

````artifact
id: workflow-diagram
name: Video Indexing Workflow
type: mermaid
content: |-
  sequenceDiagram
    participant U as User
    participant I as Index Creation
    participant M as Model Selection
    participant P as Processing
    participant R as Results

    U->>I: Click "Create Index"
    I->>M: Enter Index Name
    
    rect rgb(200, 255, 200)
        note right of M: Step 1/2
        M->>M: Select Marengo 2.7 and/or
        M->>M: Select Pegasus 1.1
        M->>M: Configure Model Options
    end

    M->>P: Click "Next"
    
    rect rgb(200, 220, 255)
        note right of P: Step 2/2
        P->>P: Upload Video File
        P->>P: Validate Requirements
        P->>P: Start Processing
    end

    P-->>R: Indexing Progress
    
    rect rgb(255, 220, 200)
        note right of R: Results View
        R-->>R: Show Progress Status
        R-->>R: Display Video Preview
        R-->>R: Update Index Status
    end
    
    R-->>U: Complete Index Creation
````

**Complete Process Flow:**

1. **Initial Entry**
   - User accesses the system
   - Views existing indexes or starts new creation

2. **Index Creation (Step 1/2)**
   - Enter index name
   - Select AI models (Marengo 2.7/Pegasus 1.1)
   - Configure visual/audio options
   - Models cannot be changed after creation

3. **Upload Process (Step 2/2)**
   - Select or drag-and-drop video files
   - System validates:
     - Duration (4sec-30min/2hr)
     - Resolution (360p-4k)
     - File size (≤2GB)
     - Audio requirements

4. **Processing Stage**
   - Shows indexing progress
   - Displays preview thumbnails
   - Updates status in real-time

5. **Results View**
   - Displays processed videos
   - Shows index details
   - Provides access to video analysis

The interface follows a modern, clean design system with:
- Clear hierarchy
- Progressive disclosure
- Consistent spacing
- Material design influences
- Dark mode support
- Clear feedback mechanisms