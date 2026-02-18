import { Heart, MessageCircle, Share2, Play, Music, MapPin } from 'lucide-react';
import { Content } from './HomePage';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface ContentCardProps {
  content: Content;
}

export default function ContentCard({ content }: ContentCardProps) {
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${days}天前`;
  };

  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return `${(num / 10000).toFixed(1)}w`;
    }
    return num.toString();
  };

  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      {/* Media Content */}
      {content.type === 'image' && content.media && (
        <div className="relative w-full">
          <ImageWithFallback
            src={content.media}
            alt={content.content}
            className="w-full h-auto object-cover"
          />
        </div>
      )}

      {content.type === 'video' && content.media && (
        <div className="relative w-full aspect-video bg-gray-900">
          <ImageWithFallback
            src={content.media}
            alt={content.content}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
            <div className="w-14 h-14 bg-white bg-opacity-90 rounded-full flex items-center justify-center">
              <Play size={24} className="text-gray-900 ml-1" />
            </div>
          </div>
        </div>
      )}

      {content.type === 'audio' && (
        <div className="w-full aspect-video bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
          <div className="text-white flex flex-col items-center gap-3">
            <Music size={48} />
            <p className="text-sm">音频内容</p>
          </div>
        </div>
      )}

      {/* Content Text */}
      <div className="p-3">
        <p className="text-sm text-gray-800 line-clamp-3 mb-3">
          {content.content}
        </p>

        {/* User Info */}
        <div className="flex items-center gap-2 mb-3">
          <ImageWithFallback
            src={content.avatar}
            alt={content.userName}
            className="w-6 h-6 rounded-full object-cover"
          />
          <span className="text-xs text-gray-600">{content.userName}</span>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-gray-500">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Heart size={16} />
              <span className="text-xs">{formatNumber(content.likes)}</span>
            </div>
            <div className="flex items-center gap-1">
              <MessageCircle size={16} />
              <span className="text-xs">{formatNumber(content.comments)}</span>
            </div>
          </div>
          <button className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <Share2 size={16} />
          </button>
        </div>

        {/* Time */}
        <div className="mt-2 text-xs text-gray-400">
          {formatTime(content.timestamp)}
        </div>

        {/* Location - Masked GPS */}
        {content.location && (
          <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
            <MapPin size={12} />
            <span>
              {content.location.city}
              {content.location.district && ` · ${content.location.district}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
