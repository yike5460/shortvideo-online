# Video Understanding Feature Design Document

## Overview

The Video Understanding feature allows users to ask questions about their videos and receive AI-powered insights. This feature leverages Amazon Nova to analyze video content and generate responses to user queries.

## User Interface

### Navigation

- A new "Ask" tab is added to the left sidebar navigation
- The tab uses a question mark icon to represent the feature

### Ask Page Layout

The Ask page is organized in a top-down layout with three main sections:

1. **Index Selection Area (Top)**
   - Standard dropdown list of available indexes
   - Dropdown becomes scrollable with fixed height when the list is too long
   - Indexes are sorted alphabetically by name
   - Each option shows the index name and video count
   - Empty state shows a message to create an index if none exist

2. **Video Selection Area (Middle)**
   - Grid of video thumbnails from the selected index
   - Each thumbnail shows the video title and duration
   - Selected video is highlighted with a border
   - Empty state shows a message to select an index first or upload videos if none exist
   - Loading indicator when fetching videos

3. **Question and Response Area (Bottom)**
   - Question input field with placeholder text
   - Sample questions for quick selection
   - Submit button to process the question
   - Response display area with typing animation during processing
   - Completed responses are marked with a checkmark

### UI Components

- **Index Selection Dropdown**
  - Standard dropdown list of available indexes
  - Dropdown becomes scrollable with fixed height when the list is too long
  - Indexes are sorted alphabetically by name
  - Each option shows index name and video count

- **Video Thumbnail Grid**
  - Scrollable grid of video thumbnails from the selected index
  - Each thumbnail shows video preview image and duration
  - Selection state is visually indicated

- **Question Input**
  - Text input field for entering questions
  - Sample question buttons for common queries
  - Submit button with loading state

- **Response Display**
  - Streaming text display with typing animation
  - Auto-scrolling to show new content
  - Completion indicator when response is finished

## Technical Architecture

### Frontend Components

1. **Ask Page Component**
   - Manages index selection, video selection, question input, and response display
   - Handles API communication for index listing, video listing, and question processing
   - Implements SSE (Server-Sent Events) for streaming responses

2. **Index Selection Component**
   - Renders index options with selection state
   - Handles click events for selection

3. **Video Thumbnail Component**
   - Renders video thumbnails with selection state
   - Handles click events for selection

4. **Question Input Component**
   - Manages question text input and sample question selection
   - Validates input before submission

5. **Response Display Component**
   - Renders streaming text responses
   - Implements auto-scrolling and typing animation

### Backend Components

1. **Video Understanding Lambda**
   - Handles API requests for video understanding
   - Initializes streaming sessions
   - Processes videos with Amazon Nova
   - Streams responses back to the client

2. **Sessions DynamoDB Table**
   - Stores session data for video understanding requests
   - Tracks session status and metadata
   - Implements TTL for automatic cleanup

3. **Amazon Nova Integration**
   - Processes video content using Amazon Nova model
   - Generates responses to user questions
   - Handles video analysis and understanding

### API Endpoints

1. **POST /videos/ask/init**
   - Initializes a streaming session
   - Parameters:
     - videoId: ID of the selected video
     - indexId: ID of the video's index
     - question: User's question text
   - Returns:
     - sessionId: Unique identifier for the streaming session

2. **GET /videos/ask/stream/{sessionId}**
   - Streams the response for a given session
   - Uses Server-Sent Events (SSE) for streaming
   - Events:
     - message: Contains chunks of the response text
     - complete: Indicates the response is complete
     - error: Indicates an error occurred

## Data Flow

1. User selects an index from the index grid
2. System loads videos from the selected index
3. User selects a video from the thumbnail grid
4. User enters a question or selects a sample question
3. Frontend sends initialization request to the backend
4. Backend creates a session and returns sessionId
5. Frontend connects to the streaming endpoint using the sessionId
6. Backend processes the video with Amazon Nova and streams the response
7. Frontend displays the streaming response with typing animation
8. Backend sends completion event when processing is finished
9. Frontend indicates completion to the user

## Implementation Details

### Frontend Implementation

The frontend is implemented using React with Next.js. Key components include:

- **AskPage**: Main page component that orchestrates the feature
- **VideoThumbnailGrid**: Component for displaying and selecting videos
- **QuestionInput**: Component for entering and submitting questions
- **ResponseDisplay**: Component for displaying streaming responses

CSS styles are implemented using Tailwind CSS with custom animations for the typing effect.

### Backend Implementation

The backend is implemented using AWS Lambda with TypeScript. Key components include:

- **VideoUnderstandingHandler**: Main Lambda function handler
- **InitHandler**: Handles session initialization
- **StreamHandler**: Handles response streaming
- **NovaClient**: Wrapper for Amazon Nova API

Infrastructure is defined using AWS CDK with a dedicated stack for Video Understanding resources.

## Security Considerations

- Authentication is required to access the feature
- Authorization checks ensure users can only access their own videos
- API requests are secured with proper IAM permissions
- Session data is stored securely in DynamoDB with TTL

## Performance Considerations

- Video processing is performed asynchronously
- Responses are streamed to provide immediate feedback
- Session data is cached to improve performance
- Large videos are processed in chunks to optimize memory usage

## Future Enhancements

- Support for video segments and timestamps in responses
- Visual highlighting of relevant video frames
- Multi-video analysis for comparative questions
- Custom prompt templates for different question types
- User feedback mechanism to improve responses over time

## Testing Strategy

- Unit tests for frontend components
- Integration tests for API endpoints
- End-to-end tests for the complete feature
- Performance testing for response time and streaming behavior
- Security testing for authentication and authorization

## Deployment Strategy

The feature will be deployed as part of the existing application infrastructure:

1. Frontend components are deployed with the Next.js application
2. Backend components are deployed using AWS CDK
3. Database resources are provisioned as part of the CDK stack
4. API Gateway endpoints are configured for the new Lambda functions

## Monitoring and Logging

- CloudWatch Logs for Lambda function logs
- CloudWatch Metrics for performance monitoring
- X-Ray for request tracing
- Custom metrics for feature usage and performance

## Conclusion

The Video Understanding feature provides a powerful way for users to interact with their videos using natural language questions. By leveraging Amazon Nova, the feature can provide detailed insights about video content, enhancing the overall value of the video search platform.