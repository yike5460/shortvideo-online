## Index Creation Overview:
User tutorial from upload image/video, set index parameter/embedding model, progress panel for ongoing job and detailed page for indexed image or video. Each step layout and element in detail are described below.

### Step 1: Upload image/video Page
- Step indicator (1/2)
- Form layout with:
  - Text input for index name
  - Warning message about model selection
  - Model selection cards with detailed specifications
  - Navigation buttons (Cancel/Next)
- Clear visual hierarchy with cards and icons

### Step 2: Index Creation Page
- Step indicator (2/2)
- Index selector dropdown
- Large drop zone for file upload
- Detailed specification panel
- Upload requirements clearly listed
- Action buttons at bottom

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


Overall workflow is described below:
```mermaid
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
        M->>M: Select Amazon NOVA and/or
        M->>M: Select Transcribe
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
```

**Complete Process Flow:**

1. **Initial Entry**
   - User accesses the system
   - Views existing indexes or starts new creation

2. **Index Creation (Step 1/2)**
   - Enter index name
   - Select AI models (Amazon NOVA/Transcribe)
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
- Clear feedback mechanisms

## Video Search Overview:
User tutorial from input keyword to search video, display result "View by clip" and "View by video". Each step layout and element in detail are described below.

### Layout Analysis by Image

#### Search Interface
- Main search bar with placeholder "What are you looking for?"
- Search by image option in top-right
- Video listing with metadata (duration, creation date)
- Right sidebar with:
  - Index selector
  - Search options (Visual/Audio)
  - Advanced parameters panel
  - Confidence level slider
  - Toggle for confidence scores

#### Grid View Results (View by clip by default)
- Search query example: "GitHub App" with clear option
- View toggles: "View by clip" / "View by video"
- Grid layout of search results with:
  - Confidence indicators (High/Medium)
  - Thumbnail previews
  - Video source information
- Maintains consistent right sidebar

#### Timeline View (View by video)
- Same search interface but with timeline visualization
- Video progress bar with segments
- Current clip preview with timestamp
- Confidence level indicators
- Maintains consistent right sidebar layout

Overall workflow is described below:
```mermaid
  sequenceDiagram
    participant U as User
    participant S as Search Interface
    participant R as Results Processor
    participant V as View Controller
    participant F as Feedback System

    U->>S: Enter Search Query/Upload Image
    
    rect rgb(200, 255, 200)
        note right of S: Search Configuration
        S->>S: Select Index
        S->>S: Configure Search Options
        S->>S: Set Confidence Level
    end

    S->>R: Process Search
    
    rect rgb(200, 220, 255)
        note right of R: Results Display
        R-->>V: Generate Results
        
        V->>V: View Options
        alt View by Clip
            V-->>U: Display Grid Layout
        else View by Video
            V-->>U: Display Timeline View
        end
    end

    U->>F: Provide Result Feedback
    
    rect rgb(255, 220, 200)
        note right of F: Result Refinement
        F-->>R: Update Confidence Scores
        R-->>V: Refresh Results
        V-->>U: Show Updated Results
    end
```

**Complete Search Process Flow:**

1. **Search Initiation**
   - Text search input
   - Image-based search option
   - Index selection
   - Search option configuration

2. **Search Configuration**
   - Choose index from dropdown
   - Toggle Visual/Audio search
   - Set minimum confidence level
   - Adjust confidence threshold
   - Toggle confidence score display

3. **Results Visualization**
   - View by Clip:
     - Grid layout
     - Confidence indicators
     - Thumbnail previews
   - View by Video:
     - Timeline visualization
     - Segment markers
     - Current frame preview

4. **Interaction Features**
   - Result filtering
   - Confidence level adjustment
   - Feedback collection
   - Result refinement

The interface follows a modern, clean design system with:
- Clear hierarchy
- Progressive disclosure
- Consistent spacing
- Material design influences
- Clear feedback mechanisms
- Progress indicators
- Multiple view options
- Advanced configuration options

## User Registration and Login

### UX interaction and UI Layout overview

#### Registration Interface
- Clean, minimal form with:
  - Email input field
  - Password input with strength indicator
  - Confirm password field
  - Terms of service checkbox
  - Registration button
- Social login options (Google, GitHub)
- Link to login page for existing users
- Clear error messaging and validation

#### Login Interface
- Streamlined login form with:
  - Email/username input
  - Password input with show/hide toggle
  - "Remember me" checkbox
  - Forgot password link
- Social login options
- Link to registration for new users
- Security features display (2FA if enabled)

#### Password Recovery Flow
- Email input for reset link
- Reset token validation
- New password setup form
- Success confirmation screen

Overall workflow is described below:
```mermaid
  sequenceDiagram
    participant U as User
    participant A as Auth Interface
    participant C as Cloudflare Auth
    participant D as Database
    participant E as Email Service

    rect rgb(200, 255, 200)
        note right of A: Registration Flow
        U->>A: Click Register
        A->>A: Display Registration Form
        U->>A: Submit Details
        A->>C: Validate & Hash Password
        C->>D: Store User Data
        C->>E: Send Verification Email
        E-->>U: Receive Verification Link
    end

    rect rgb(200, 220, 255)
        note right of A: Login Flow
        U->>A: Enter Credentials
        A->>C: Authenticate
        alt Valid Credentials
            C->>D: Fetch User Data
            C-->>U: Generate JWT Token
            C-->>U: Redirect to Dashboard
        else Invalid Credentials
            C-->>U: Show Error Message
        end
    end

    rect rgb(255, 220, 200)
        note right of A: Password Recovery
        U->>A: Request Password Reset
        A->>C: Verify Email
        C->>E: Send Reset Link
        U->>A: Set New Password
        A->>C: Update Credentials
        C-->>U: Confirm Reset
    end
```

### Implementation Architecture

#### Security Implementation
1. **Authentication Layer**
   - Cloudflare Workers for serverless auth endpoints
   - Argon2id for password hashing
   - JWT tokens with short expiry
   - CSRF token protection
   - Rate limiting on auth endpoints

2. **Database Structure (Cloudflare D1)**
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    created_at TIMESTAMP,
    last_login TIMESTAMP,
    verification_status BOOLEAN,
    two_factor_enabled BOOLEAN,
    failed_attempts INTEGER,
    reset_token TEXT,
    reset_token_expiry TIMESTAMP
);

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    created_at TIMESTAMP,
    expires_at TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

3. **API Endpoints (Cloudflare Functions)**
```typescript
// Authentication endpoints
/api/auth/register
/api/auth/login
/api/auth/logout
/api/auth/verify-email
/api/auth/forgot-password
/api/auth/reset-password
/api/auth/refresh-token
```

4. **Integration Flexibility**
- Modular auth service architecture
- Abstract authentication provider interface
- Easy migration path to Amazon Cognito:
```typescript
interface AuthProvider {
    register(email: string, password: string): Promise<User>;
    login(email: string, password: string): Promise<Session>;
    verifyEmail(token: string): Promise<boolean>;
    resetPassword(token: string, newPassword: string): Promise<boolean>;
}

// Implementation for Cloudflare D1
class CloudflareAuthProvider implements AuthProvider {
    // Implementation details...
}

// Implementation for Amazon Cognito
class CognitoAuthProvider implements AuthProvider {
    // Implementation details...
}
```

#### Performance Optimizations
1. **Caching Strategy**
   - Cache user sessions in Cloudflare KV
   - Distributed session management
   - Edge-optimized JWT validation

2. **Security Headers**
```typescript
{
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'"
}
```

3. **Rate Limiting**
```typescript
const rateLimit = {
    login: '5 requests per minute',
    register: '3 requests per minute',
    passwordReset: '2 requests per hour'
}
```

4. **Progressive Enhancement**
- Graceful fallback for JavaScript-disabled browsers
- Accessible form validation
- Optimistic UI updates
- Offline support for authenticated sessions

The implementation provides a secure, performant authentication system that can be easily extended or migrated to more complex solutions like Amazon Cognito when needed. The use of Cloudflare's edge functions and D1 database ensures low-latency responses while maintaining high security standards.

NOTE: Below are the mock process on current:
1. When a new user registers:
    - They fill out the registration form
    - On submit, they're redirected to the verification page
    - A verification email would be sent (mocked in this version)
    - They must verify their email before they can log in
2. When a user tries to log in:
    - If using test account (test@example.com/password123), they get immediate access
    - If using a registered but unverified account, they see a verification required message
    - If using an invalid account, they see an error message
3. On the verification page:
    - Users see their registration email
    - They can request a new verification email
    - They can return to the login page
    - If they try to access the verification page directly without registering, they're redirected to landing

## Deployment to Cloudflare Pages

### Prerequisites

1. A Cloudflare account
2. The repository pushed to GitHub
3. Node.js version 18 or higher

### Deployment Steps

1. Log in to your Cloudflare dashboard
2. Go to Pages > Create a project
3. Connect your GitHub repository
4. Configure the build settings:
   - Framework preset: Next.js
   - Build command: `npm run build`
   - Build output directory: `out`
   - Node.js version: 18
   - Root directory: `/prototype/frontend`

5. Configure environment variables in Cloudflare Pages:
   - Copy variables from `.env.example`
   - Add them in the Cloudflare Pages dashboard under Settings > Environment variables

### Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Test production build locally
npx serve out
```

### Important Notes

1. The app is configured for static export using `next export`
2. All API calls should use environment variables for the base URL
3. Images are configured to be unoptimized for static hosting
4. Client-side routing is handled by the Cloudflare Pages configuration

### Troubleshooting

1. If images don't load, check the `remotePatterns` in `next.config.js`
2. For routing issues, verify the `pages.config.js` configuration
3. Environment variables must be prefixed with `NEXT_PUBLIC_` for client-side use
