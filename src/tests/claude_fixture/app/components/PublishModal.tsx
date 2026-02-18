import { useState } from 'react';
import { X, Image, Video, Music, FileText, Camera, AlertCircle } from 'lucide-react';

interface PublishModalProps {
  onClose: () => void;
}

type ContentType = 'text' | 'image' | 'video' | 'audio';

export default function PublishModal({ onClose }: PublishModalProps) {
  const [selectedType, setSelectedType] = useState<ContentType | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const contentTypes = [
    { type: 'image' as ContentType, icon: Image, label: '图片', color: 'bg-blue-500' },
    { type: 'video' as ContentType, icon: Video, label: '视频', color: 'bg-purple-500' },
    { type: 'audio' as ContentType, icon: Music, label: '音频', color: 'bg-pink-500' },
    { type: 'text' as ContentType, icon: FileText, label: '文字', color: 'bg-green-500' },
  ];

  const handlePublish = () => {
    // 这里会调用后端API进行内容发布
    console.log('Publishing:', { type: selectedType, content, files });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
      <div className="bg-white w-full max-h-[90vh] rounded-t-3xl overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
          <h3 className="font-semibold text-lg">发布内容</h3>
          <button
            onClick={handlePublish}
            disabled={!selectedType || !content}
            className={`px-6 py-2 rounded-full font-medium transition-colors ${selectedType && content
                ? 'bg-purple-500 text-white hover:bg-purple-600 hover:shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
          >
            发布
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4">
          {/* Content Type Selection */}
          {!selectedType && (
            <div className="space-y-4">
              <h4 className="text-sm text-gray-600 font-medium">选择内容类型</h4>
              <div className="grid grid-cols-2 gap-3">
                {contentTypes.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.type}
                      onClick={() => setSelectedType(type.type)}
                      className="p-6 bg-gray-50 rounded-2xl hover:shadow-md transition-all flex flex-col items-center gap-3 border-2 border-transparent hover:border-purple-200"
                    >
                      <div className={`w-14 h-14 ${type.color} rounded-2xl flex items-center justify-center`}>
                        <Icon size={28} className="text-white" />
                      </div>
                      <span className="font-medium">{type.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* AI Filter Notice */}
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
                <AlertCircle size={20} className="text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">内容审核说明</p>
                  <p className="text-xs text-blue-700">
                    发布的内容将通过AI实时扫描，确保符合当地法律法规。包括但不限于：裸露人体、暴力血腥、毒品、军火、政治敏感等内容将被自动过滤。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Content Editor */}
          {selectedType && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {contentTypes.map((type) => {
                    if (type.type === selectedType) {
                      const Icon = type.icon;
                      return (
                        <div key={type.type} className="flex items-center gap-2">
                          <div className={`w-8 h-8 ${type.color} rounded-lg flex items-center justify-center`}>
                            <Icon size={18} className="text-white" />
                          </div>
                          <span className="font-medium">{type.label}</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  重新选择
                </button>
              </div>

              {/* Text Input */}
              <textarea
                placeholder="分享你的想法..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-40 p-4 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />

              {/* Media Upload */}
              {selectedType !== 'text' && (
                <div className="space-y-2">
                  <label className="block text-sm text-gray-600 font-medium">
                    {selectedType === 'image' && '上传图片'}
                    {selectedType === 'video' && '上传视频'}
                    {selectedType === 'audio' && '上传音频'}
                  </label>
                  <button className="w-full p-8 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-colors flex flex-col items-center gap-2">
                    <Camera size={32} className="text-gray-400" />
                    <span className="text-sm text-gray-600">点击选择文件</span>
                  </button>
                </div>
              )}

              {/* Content Guidelines */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                <p className="text-xs text-yellow-800">
                  📝 <strong>发布提示：</strong>重复或高度相似的内容会被自动去重，请发布原创高质量内容以获得更好的曝光。
                </p>
              </div>

              {/* AI Filter Details */}
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-700 font-medium mb-2">内容过滤范围：</p>
                <div className="flex flex-wrap gap-2">
                  {['裸露内容', '暴力血腥', '毒品相关', '军火武器', '政治敏感', '仇恨言论', '虚假信息'].map((tag) => (
                    <span key={tag} className="px-2 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}