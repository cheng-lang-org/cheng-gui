import { memo, useMemo } from 'react';
import { Heart, Play, Music, MapPin, DollarSign } from 'lucide-react';
import { Content } from './HomePage';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useLocale } from '../i18n/LocaleContext';
import { formatContentLocationLabel, openContentLocationInMap } from '../utils/contentLocation';
import { sanitizeContent } from '../utils/sanitize';

interface ContentCardProps {
  content: Content;
  onClick?: (content: Content) => void;
}

/**
 * 根据内容长度决定文字截断行数。
 * 区分中文（CJK宽字符）和英文来更精确地判断实际行数。
 */
function textLineClamp(text: string, hasMediaBlock: boolean): string {
  // 估算"视觉长度"：CJK 字符算 2，其余算 1
  let visualLen = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    visualLen += code > 0x2E7F ? 2 : 1;
  }
  if (hasMediaBlock) {
    return visualLen <= 60 ? 'line-clamp-2' : 'line-clamp-3';
  }
  if (visualLen <= 80) return 'line-clamp-3';
  if (visualLen <= 180) return 'line-clamp-4';
  return 'line-clamp-5';
}

/**
 * 格式化时间戳为相对时间
 */
function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
}

/**
 * 格式化数字（万为单位）
 */
function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
  return num.toString();
}

function resolveCoverMedia(content: Content): string {
  if (content.coverMedia && content.coverMedia.trim().length > 0) {
    return content.coverMedia;
  }
  if (content.media && content.media.trim().length > 0) {
    return content.media;
  }
  if (content.mediaItems && content.mediaItems.length > 0) {
    return content.mediaItems[0];
  }
  return '';
}

function resolveMediaAspectRatio(content: Content, contentType: Content['type']): number {
  const fallbackRatio = contentType === 'video' ? 16 / 9 : contentType === 'audio' ? 1 : 3 / 4;
  const rawRatio = typeof content.mediaAspectRatio === 'number' ? content.mediaAspectRatio : fallbackRatio;
  return Math.min(1.4, Math.max(0.75, rawRatio));
}

function isSameMediaItems(a?: string[], b?: string[]): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function locationSignature(location: Content['location'] | undefined): string {
  if (!location || typeof location !== 'object') {
    return '';
  }
  const raw = location as unknown as Record<string, unknown>;
  const publicLocation = (raw.public && typeof raw.public === 'object'
    ? raw.public
    : raw) as Record<string, unknown>;
  const preciseLocation = (raw.precise && typeof raw.precise === 'object'
    ? raw.precise
    : raw) as Record<string, unknown>;
  return [
    asText(publicLocation.country),
    asText(publicLocation.province),
    asText(publicLocation.city),
    asText(publicLocation.district),
    String(preciseLocation.latitude ?? ''),
    String(preciseLocation.longitude ?? ''),
    String(preciseLocation.accuracy ?? ''),
    asText(raw.commit),
    asText(raw.nonce),
  ].join('|');
}

/**
 * 内容卡片组件 - 使用 memo 优化避免不必要的重渲染
 */
function ContentCardInner({ content, onClick }: ContentCardProps) {
  const { locale, t } = useLocale();
  const coverMedia = resolveCoverMedia(content);
  const contentType: Content['type'] = content.type === 'text' && coverMedia ? 'image' : content.type;
  const mediaAspectRatio = resolveMediaAspectRatio(content, contentType);
  const hasMediaBlock = contentType !== 'text';

  // 缓存计算结果
  const lineClampClass = textLineClamp(content.content, hasMediaBlock);
  const sanitizedContent = useMemo(() => sanitizeContent(content.content), [content.content]);
  const formattedTime = formatTime(content.timestamp);
  const formattedLikes = formatNumber(content.likes);
  const locationLabel = formatContentLocationLabel(content.location, locale);

  const isPaid = !!content.extra?.isPaid;
  const price = typeof content.extra?.price === 'number' ? content.extra.price : 0;
  const isMediaPreviewable = contentType === 'video' || contentType === 'audio';

  const handleLocationClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      try {
        const result = await openContentLocationInMap(content.location, locale);
        if (result === 'no_coordinates' && typeof window !== 'undefined') {
          window.alert(t.content_location_noCoordinates);
        }
      } catch {
        if (typeof window !== 'undefined') {
          window.alert(t.content_location_openFailed);
        }
      }
    })();
  };

  return (
    <div
      onClick={() => onClick?.(content)}
      className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      style={{ minHeight: content.publishCategory === 'app' ? 'auto' : 100 }}
    >
      {/* 应用发布特殊样式 */}
      {content.publishCategory === 'app' ? (
        <div className="flex items-center p-3 gap-3">
          {/* App Icon */}
          <div className="w-12 h-12 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-100 flex items-center justify-center">
            {content.media ? (
              <ImageWithFallback src={content.media} alt={content.content} className="w-full h-full object-cover" />
            ) : (
              <div className="text-2xl select-none">
                {(content.extra as any)?.appMeta?.icon || '📱'}
              </div>
            )}
          </div>
          {/* App Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base text-gray-900 truncate">{content.content}</h3>
            <p className="text-xs text-gray-400 truncate font-mono mt-0.5">
              {content.userId}
            </p>
          </div>
        </div>
      ) : null}

      {content.publishCategory !== 'app' && (
        <>
          {/* 图片类型 */}
          {contentType === 'image' && (
            <div className="relative w-full bg-gray-100" style={{ aspectRatio: mediaAspectRatio }}>
              {coverMedia ? (
                <ImageWithFallback
                  src={coverMedia}
                  alt={content.content}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">图片内容</div>
              )}
              {isPaid && (
                <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow">
                  <DollarSign size={10} />¥{price}
                </div>
              )}
            </div>
          )}

          {/* 视频类型 */}
          {contentType === 'video' && (
            <div className="relative w-full bg-gray-900" style={{ aspectRatio: mediaAspectRatio }}>
              {coverMedia ? (
                <ImageWithFallback
                  src={coverMedia}
                  alt={content.content}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <div className="w-12 h-12 bg-white bg-opacity-90 rounded-full flex items-center justify-center">
                  <Play size={20} className="text-gray-900 ml-0.5" />
                </div>
              </div>
              {isPaid && (
                <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow">
                  试看 ¥{price}
                </div>
              )}
            </div>
          )}

          {/* 音频类型 */}
          {contentType === 'audio' && (
            <div
              className="w-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
              style={{ aspectRatio: mediaAspectRatio }}
            >
              <div className="text-white flex items-center gap-2 drop-shadow-sm">
                <Music size={24} />
                <span className="text-sm font-medium">音频内容</span>
              </div>
              {isPaid && (
                <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow">
                  试听 ¥{price}
                </div>
              )}
            </div>
          )}

          {/* 内容区域 */}
          <div className="p-3">
            {/* 内容文字 — 动态行数截断 */}
            <p className={`text-sm text-gray-800 mb-2 leading-relaxed ${lineClampClass}`}>
              {sanitizedContent}
            </p>

            {/* 底部信息栏 */}
            <div className="flex items-center justify-between text-gray-400 mt-auto">
              <span className="text-xs truncate max-w-[50%]">{content.userName}</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <Heart size={12} />
                  <span className="text-[10px]">{formattedLikes}</span>
                </div>
                <span className="text-[10px]">{formattedTime}</span>
              </div>
            </div>

            {/* 位置信息 */}
            {locationLabel && (
              <button
                type="button"
                onClick={handleLocationClick}
                title={t.content_location_openInMap}
                className="mt-1.5 flex items-start gap-1 text-[10px] text-blue-500 hover:text-blue-600 transition-colors text-left"
              >
                <MapPin size={10} />
                <span className="break-all leading-tight">{locationLabel}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 使用 memo 并自定义比较函数，只在 content 关键字段变化时才重渲染
const ContentCard = memo(ContentCardInner, (prevProps, nextProps) => {
  const prev = prevProps.content;
  const next = nextProps.content;

  return (
    prev.id === next.id &&
    prev.type === next.type &&
    prev.likes === next.likes &&
    prev.comments === next.comments &&
    prev.timestamp === next.timestamp &&
    prev.content === next.content &&
    prev.media === next.media &&
    prev.coverMedia === next.coverMedia &&
    prev.mediaAspectRatio === next.mediaAspectRatio &&
    isSameMediaItems(prev.mediaItems, next.mediaItems) &&
    prev.publishCategory === next.publishCategory &&
    prevProps.onClick === nextProps.onClick &&
    prev.extra?.isPaid === next.extra?.isPaid &&
    prev.extra?.price === next.extra?.price &&
    locationSignature(prev.location) === locationSignature(next.location)
  );
});

export default ContentCard;
