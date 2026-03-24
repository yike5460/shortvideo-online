'use client'

import { useState } from 'react'
import { autoClipsApi } from '@/lib/api'
import type { ClipSuggestion, ClipStyle } from '@/lib/api/auto-clips'

interface AutoClipsPanelProps {
  videoId: string;
  indexId: string;
  onAddToCart?: (clip: ClipSuggestion) => void;
}

const STYLE_OPTIONS: { value: ClipStyle; label: string; description: string }[] = [
  { value: 'highlights', label: 'Highlights', description: 'Most engaging moments' },
  { value: 'tutorial', label: 'Tutorial', description: 'Key instructional moments' },
  { value: 'montage', label: 'Montage', description: 'Visually diverse moments' },
  { value: 'storytelling', label: 'Story', description: 'Narrative arc clips' },
];

const DURATION_OPTIONS = [
  { value: 15, label: '15s', platform: 'TikTok/Reels' },
  { value: 30, label: '30s', platform: 'TikTok/Reels' },
  { value: 60, label: '60s', platform: 'YouTube Shorts' },
];

export default function AutoClipsPanel({ videoId, indexId, onAddToCart }: AutoClipsPanelProps) {
  const [clips, setClips] = useState<ClipSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<ClipStyle>('highlights');
  const [targetDuration, setTargetDuration] = useState(30);
  const [count, setCount] = useState(5);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await autoClipsApi.generateAutoClips(videoId, indexId, {
        targetDuration,
        count,
        style,
      });
      setClips(result.clips);
    } catch (err: any) {
      setError(err.message || 'Failed to generate clips');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-lg font-semibold mb-4">Auto-Clips Generator</h3>

      {/* Controls */}
      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Style
          </label>
          <div className="flex gap-2 flex-wrap">
            {STYLE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStyle(opt.value)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  style === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                }`}
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Target Duration
          </label>
          <div className="flex gap-2">
            {DURATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTargetDuration(opt.value)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  targetDuration === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                }`}
                title={opt.platform}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Number of clips: {count}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          {loading ? 'Generating...' : 'Generate Auto-Clips'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {clips.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {clips.length} clip{clips.length !== 1 ? 's' : ''} suggested
          </h4>
          {clips.map(clip => (
            <div
              key={clip.clipId}
              className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 hover:border-blue-400 transition-colors"
            >
              <div className="flex items-start gap-3">
                {clip.thumbnailUrl && (
                  <img
                    src={clip.thumbnailUrl}
                    alt={clip.title}
                    className="w-24 h-16 object-cover rounded"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h5 className="font-medium text-sm truncate">{clip.title}</h5>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                    {' '}({Math.round(clip.duration / 1000)}s)
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                    {clip.description}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                      Quality: {clip.qualityScore}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                      Engagement: {clip.engagementScore}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {clip.tags.slice(0, 5).map((tag, i) => (
                      <span
                        key={i}
                        className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {clip.previewUrl && (
                  <a
                    href={clip.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Preview
                  </a>
                )}
                {onAddToCart && (
                  <button
                    onClick={() => onAddToCart(clip)}
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Add to Cart
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
