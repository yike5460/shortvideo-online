# Video Clip Cart Feature Design

## Overview

This document outlines the design for a new feature that allows users to store selected video clips in a temporary cart/folder. This enhancement will enable users to search with different keywords multiple times and accumulate selected clips from various searches before performing operations like merging, downloading, or exporting.

## Current System Understanding

The current system allows:
1. Searching for videos and viewing results in "View by Clip" or "View by Video" modes
2. Selecting multiple segments from a single video in the "View by Video" mode
3. Performing operations on selected segments (merge, download, export CSV)
4. Merging selected segments into a new video clip

The limitation is that users can only work with segments from one search at a time, and selections are lost when performing a new search.

## Feature Requirements

1. Allow users to store selected video clips in a temporary cart
2. Enable users to perform multiple searches and add clips from each search to the cart
3. Provide a cart interface for viewing and managing stored clips
4. Support operations on cart items (select, merge, download clips/CSV, clear)
5. Integrate with existing backend functionality

## Technical Design

### 1. Data Structure

```typescript
interface CartItem {
  videoId: string;
  indexId: string;
  segment: VideoSegment;
  addedAt: number; // timestamp
  source: string; // search query that found this clip
}

interface Cart {
  items: CartItem[];
  lastUpdated: number;
}
```

### 2. Frontend Components

- **Cart Icon Component**: Shows count of items in cart and opens cart panel when clicked
- **Cart Panel Component**: Displays cart items grouped by video, with selection and action controls
- **Add to Cart Button Component**: Added to video segments in search results

### 3. State Management

React Context will be used to manage the cart state across the application, with the following key functions:
- addToCart
- removeFromCart
- clearCart
- isInCart
- getItemCount

### 4. Backend Integration

The cart will primarily be a client-side feature, using the existing backend APIs for operations like merging clips. No new backend endpoints are needed for the basic cart functionality.

## Implementation Plan

### Phase 1: Core Cart Functionality (2 weeks)
1. Create cart context and state management
2. Implement cart icon and panel components
3. Add "Add to Cart" buttons to search results
4. Integrate with existing merge functionality

### Phase 2: Enhanced Features (2 weeks)
1. Improve cart UI with grouping and filtering
2. Add batch operations for cart items
3. Implement cart persistence using localStorage
4. Add animations and improved UX

### Phase 3: Advanced Features (Future)
1. Server-side cart persistence
2. Cross-video merging capabilities
3. Saved carts functionality
4. Sharing features

## Technical Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance issues with large carts | High | Implement virtualized lists, pagination, and optimize rendering |
| Browser storage limitations | Medium | Implement cleanup policies, warn users about size limits |
| Merging clips from different videos | High | Research technical feasibility, implement server-side processing |
| User confusion with new UI | Medium | Add tooltips, onboarding guidance, and clear visual cues |
| API compatibility | Medium | Ensure backward compatibility, version APIs appropriately |

## Conclusion

The proposed Video Clip Cart feature will significantly enhance the user experience by allowing users to collect and manage video clips across multiple searches. This feature builds on the existing functionality while adding new capabilities that make the platform more flexible and powerful for users working with multiple video clips.

The implementation is designed to be modular and scalable, with a phased approach that delivers immediate value while setting the foundation for more advanced features in the future.
