# Production Transformation Plan: Know Your Moments

## Vision
Transform from internal prototype to a production SaaS product targeting video creators, MCNs, and content agencies who need AI-powered video search, auto-slicing, and content tagging.

## Target Audience Pain Points (from market analysis)
1. Post-production editing = 50-70% of production time
2. Material screening/tagging is manual and slow
3. Cross-platform format adaptation (YouTube 16:9 vs TikTok 9:16) is tedious
4. Long video → short clips conversion is high-demand (Opus Clip validated)

## Architecture Transformation: Self-hosted GPU → SaaS APIs

### Current (Prototype)
- Qwen-VL on ECS Fargate (GPU) for video understanding
- Self-hosted video-embedding service (GPU) for embeddings
- Multiple AI backends (Nova, Qwen-VL, Gemini) with inconsistent integration

### Target (Production)
- **Video Understanding**: Amazon Nova Pro via Bedrock + Google Gemini 2.5 Flash (already integrated)
- **Embeddings**: Amazon Bedrock Titan Multimodal Embeddings (managed, no GPU needed)
- **Transcription**: Amazon Transcribe (already used) + Whisper API as fallback
- **Remove**: ECS GPU instances for Qwen-VL and video-embedding containers
- **Result**: ~80% infrastructure cost reduction, zero GPU management

## Work Streams

### Stream 1: Backend Architecture (backend-architect)
- Replace self-hosted embedding with Bedrock Titan Multimodal Embeddings
- Consolidate video understanding to Nova + Gemini (remove Qwen-VL dependency)
- Remove ECS video-embedding service from CDK stack
- Remove @amazon.com email restriction in Cognito pre-signup
- Enable Redis caching (currently commented out)
- Add API rate limiting and usage tracking
- Clean up hardcoded values and TODO items

### Stream 2: Frontend UI/UX (frontend-engineer)
- Remove @amazon.com email restriction from RegisterForm
- Create centralized API client with retry/error handling
- Redesign with production SaaS theme (clean, professional)
- Refactor large components (videos/page.tsx = 1400+ lines)
- Remove mock data and placeholder values
- Mobile-responsive layout
- Add proper loading states and error boundaries

### Stream 3: Core Features (feature-engineer)
- Polish video search with better result presentation
- Enhance auto-slice feature for "long video → short clips" use case
- Complete ads-tagging/content analysis pipeline
- Add cross-platform export (auto-adapt aspect ratios)
- Improve cart/merge UX for production workflows
