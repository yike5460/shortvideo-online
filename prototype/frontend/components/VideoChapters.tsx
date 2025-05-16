import React from 'react';

// Interface for parsed chapters
interface Chapter {
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  thumbnailUrl?: string;
}

// Function to parse markdown chapters into structured data
function parseChapters(content: string): Chapter[] {
  console.log("Parsing chapters from content:", content);
  
  // Normalize content: fix potential issues with whitespace and newlines
  const normalizedContent = content
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')  // Reduce multiple newlines
    .trim();
  
  console.log("Normalized content:", normalizedContent);
  
  const chapters: Chapter[] = [];
  
  // Try multiple parsing strategies
  
  // Strategy 1: Extract chapters using regex pattern for the entire chapter structure
  try {
    console.log("Trying parsing strategy 1");
    const chapterRegex = /##\s+Chapter\s+\d+:[\s\n]*([^\n\[]+)[\s\n]*\[(\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{2}:\d{2}(?::\d{2})?)\][\s\n]*([\s\S]*?)(?=##\s+Chapter|$)/gi;
    
    let match;
    while ((match = chapterRegex.exec(normalizedContent)) !== null) {
      const title = match[1]?.trim() || '';
      const startTime = match[2]?.trim() || '00:00';
      const endTime = match[3]?.trim() || '00:00';
      const description = match[4]?.trim() || '';
      
      console.log(`Found chapter: "${title}" [${startTime} - ${endTime}]`);
      
      if (title) {
        chapters.push({
          title,
          startTime,
          endTime,
          description
        });
      }
    }
  } catch (error) {
    console.error("Error in parsing strategy 1:", error);
  }
  
  // Strategy 2: If strategy 1 failed, try extracting chapters by splitting on chapter headers
  if (chapters.length === 0) {
    try {
      console.log("Trying parsing strategy 2");
      
      // Find all chapter headers
      const headerMatches = Array.from(normalizedContent.matchAll(/##\s+Chapter\s+\d+:[^\n]*/gi));
      
      if (headerMatches.length > 0) {
        // Process each chapter
        for (let i = 0; i < headerMatches.length; i++) {
          const headerMatch = headerMatches[i];
          if (!headerMatch.index) continue;
          
          // Extract the chapter header
          const header = headerMatch[0];
          
          // Extract the title from the header
          const titleMatch = header.match(/##\s+Chapter\s+\d+:\s*(.*)/i);
          const title = titleMatch ? titleMatch[1].trim() : '';
          
          // Determine the end of this chapter (start of next chapter or end of content)
          const nextHeaderIndex = i < headerMatches.length - 1 ? headerMatches[i + 1].index : normalizedContent.length;
          
          // Extract the chapter content
          const chapterContent = normalizedContent.substring(
            headerMatch.index + header.length,
            nextHeaderIndex
          ).trim();
          
          // Extract timestamp
          const timeMatch = chapterContent.match(/\[(\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{2}:\d{2}(?::\d{2})?)\]/);
          const startTime = timeMatch ? timeMatch[1].trim() : '00:00';
          const endTime = timeMatch ? timeMatch[2].trim() : '00:00';
          
          // Extract description (everything after the timestamp)
          let description = '';
          if (timeMatch && timeMatch.index !== undefined) {
            description = chapterContent.substring(timeMatch.index + timeMatch[0].length).trim();
          } else {
            description = chapterContent;
          }
          
          console.log(`Found chapter using strategy 2: "${title}" [${startTime} - ${endTime}]`);
          
          if (title) {
            chapters.push({
              title,
              startTime,
              endTime,
              description
            });
          }
        }
      }
    } catch (error) {
      console.error("Error in parsing strategy 2:", error);
    }
  }
  
  // Strategy 3: Manual line-by-line parsing as a last resort
  if (chapters.length === 0) {
    try {
      console.log("Trying parsing strategy 3");
      
      const lines = normalizedContent.split('\n');
      let currentChapter: Partial<Chapter> | null = null;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Check for chapter header
        const headerMatch = line.match(/##\s+Chapter\s+\d+:\s*(.*)/i);
        if (headerMatch) {
          // Save previous chapter if exists
          if (currentChapter && currentChapter.title) {
            chapters.push({
              title: currentChapter.title,
              startTime: currentChapter.startTime || '00:00',
              endTime: currentChapter.endTime || '00:00',
              description: currentChapter.description || ''
            });
          }
          
          // Start new chapter
          currentChapter = {
            title: headerMatch[1].trim(),
            description: ''
          };
          continue;
        }
        
        // Check for timestamp
        if (currentChapter) {
          const timeMatch = line.match(/\[(\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{2}:\d{2}(?::\d{2})?)\]/);
          if (timeMatch) {
            currentChapter.startTime = timeMatch[1].trim();
            currentChapter.endTime = timeMatch[2].trim();
            continue;
          }
          
          // Add to description if not empty
          if (line && currentChapter.description !== undefined) {
            currentChapter.description += (currentChapter.description ? '\n' : '') + line;
          }
        }
      }
      
      // Add the last chapter
      if (currentChapter && currentChapter.title) {
        console.log(`Found chapter using strategy 3: "${currentChapter.title}"`);
        chapters.push({
          title: currentChapter.title,
          startTime: currentChapter.startTime || '00:00',
          endTime: currentChapter.endTime || '00:00',
          description: currentChapter.description || ''
        });
      }
    } catch (error) {
      console.error("Error in parsing strategy 3:", error);
    }
  }
  
  console.log(`Parsed ${chapters.length} chapters:`, chapters);
  return chapters;
}

interface ChapterProps {
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  thumbnailUrl?: string;
  onPlay?: (time: string) => void;
}

const VideoChapter: React.FC<ChapterProps> = ({
  title,
  startTime,
  endTime,
  description,
  thumbnailUrl,
  onPlay
}) => {
  const handlePlay = () => {
    if (onPlay) {
      onPlay(startTime);
    }
  };

  // Default thumbnail image
  const defaultThumbnail = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%23cccccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='2' width='20' height='20' rx='2.18' ry='2.18'%3E%3C/rect%3E%3Cline x1='7' y1='2' x2='7' y2='22'%3E%3C/line%3E%3Cline x1='17' y1='2' x2='17' y2='22'%3E%3C/line%3E%3Cline x1='2' y1='12' x2='22' y2='12'%3E%3C/line%3E%3Cline x1='2' y1='7' x2='7' y2='7'%3E%3C/line%3E%3Cline x1='2' y1='17' x2='7' y2='17'%3E%3C/line%3E%3Cline x1='17' y1='17' x2='22' y2='17'%3E%3C/line%3E%3Cline x1='17' y1='7' x2='22' y2='7'%3E%3C/line%3E%3C/svg%3E";

  return (
    <div className="video-chapter">
      <div className="chapter-content">
        <div className="chapter-thumbnail">
          <img
            src={thumbnailUrl || defaultThumbnail}
            alt={`Thumbnail for ${title}`}
            className="thumbnail-image"
          />
          <button className="thumbnail-play-button" onClick={handlePlay}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
              <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="chapter-details">
          <h3 className="chapter-title">{title}</h3>
          <div className="chapter-timestamp" onClick={handlePlay}>
            <button className="play-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
              </svg>
            </button>
            <span>{startTime} - {endTime}</span>
          </div>
          <p className="chapter-description">{description}</p>
        </div>
      </div>
    </div>
  );
};

interface VideoChaptersProps {
  content: string;
  videoThumbnailUrl?: string;
  onPlayChapter?: (time: string) => void;
}

// Function to detect if a message contains chapters
export function isChapterResponse(content: string): boolean {
  // Check for at least one chapter header
  const hasChapterHeaders = (content.match(/##\s+Chapter\s+\d+:/gi)?.length ?? 0) >= 1;
  
  // Additional check: must have at least one timestamp pattern
  const hasTimestamps = (content.match(/\[\d{2}:\d{2}(?::\d{2})?\s*-\s*\d{2}:\d{2}(?::\d{2})?\]/gi)?.length ?? 0) >= 1;
  
  return hasChapterHeaders && hasTimestamps;
}

// Debug function to log chapter parsing results
export function debugChapterParsing(content: string): void {
  console.log("Content to parse:", content);
  console.log("Content length:", content.length);
  console.log("Is chapter response:", isChapterResponse(content));
  
  // Check for chapter headers
  const chapterHeaders = content.match(/##\s+Chapter\s+\d+:/gi);
  console.log("Chapter headers found:", chapterHeaders);
  
  // Check for timestamps
  const timestamps = content.match(/\[\d{2}:\d{2}(?::\d{2})?\s*-\s*\d{2}:\d{2}(?::\d{2})?\]/gi);
  console.log("Timestamps found:", timestamps);
  
  // Parse and log chapters
  const chapters = parseChapters(content);
  console.log("Parsed chapters:", chapters);
}

const VideoChapters: React.FC<VideoChaptersProps> = ({ content, videoThumbnailUrl, onPlayChapter }) => {
  const [parsedContent, setParsedContent] = React.useState<Chapter[]>([]);
  const [parseAttempted, setParseAttempted] = React.useState(false);
  
  // Parse chapters when content is complete (when streaming is done)
  React.useEffect(() => {
    // Only parse if we have content
    if (content) {
      console.log("Attempting to parse chapters from content");
      
      try {
        const chapters = parseChapters(content);
        setParsedContent(chapters);
        setParseAttempted(true);
        
        // Debug logging
        if (chapters.length === 0) {
          console.log("No chapters parsed from content");
          console.log("Content:", content);
        } else {
          console.log(`Parsed ${chapters.length} chapters:`, chapters);
        }
      } catch (error) {
        console.error("Error parsing chapters:", error);
        setParseAttempted(true);
      }
    }
  }, [content]);
  
  // If no chapters were parsed, return the original content
  if (parsedContent.length === 0) {
    return <div className="original-content">{content}</div>;
  }
  
  return (
    <div className="video-chapters">
      {parsedContent.map((chapter, index) => (
        <VideoChapter
          key={index}
          title={chapter.title}
          startTime={chapter.startTime}
          endTime={chapter.endTime}
          description={chapter.description}
          thumbnailUrl={videoThumbnailUrl}
          onPlay={onPlayChapter}
        />
      ))}
    </div>
  );
};

export default VideoChapters;