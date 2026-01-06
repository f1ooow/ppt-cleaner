'use client';

import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import type { SlideImage } from './types';

interface PagePreviewProps {
  images: SlideImage[];
  onImagesUpdate: (images: SlideImage[]) => void;
  onBack: () => void;
}

export default function PagePreview({ images, onImagesUpdate, onBack }: PagePreviewProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [showingOriginal, setShowingOriginal] = useState<Set<string>>(new Set());

  // 用于追踪当前 session，防止旧请求覆盖新数据
  const sessionRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  // 保存最新的 images 引用，避免闭包问题
  const imagesRef = useRef<SlideImage[]>(images);

  // 同步 imagesRef
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // 当 images 数组的第一个元素的 id 改变时，说明上传了新文件
  useEffect(() => {
    const newSessionId = images[0]?.id || '';
    if (sessionRef.current && sessionRef.current !== newSessionId) {
      // 新文件上传，取消正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsProcessing(false);
      setCurrentIndex(-1);
    }
    sessionRef.current = newSessionId;
  }, [images]);

  const processedCount = images.filter(img => img.status === 'completed').length;
  const errorCount = images.filter(img => img.status === 'error').length;

  // 压缩图片到指定大小以下
  const compressImage = async (base64: string, maxSizeKB: number = 1500): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // 如果原图很大，先缩小尺寸
        const maxDimension = 2000;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // 尝试不同质量压缩
        let quality = 0.8;
        let result = canvas.toDataURL('image/jpeg', quality);

        while (result.length > maxSizeKB * 1024 * 1.37 && quality > 0.3) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(result);
      };
      img.src = base64;
    });
  };

  const cleanImage = async (image: SlideImage, index: number): Promise<SlideImage> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120秒超时

    try {
      // 压缩图片避免请求过大
      const compressedBase64 = await compressImage(image.originalBase64);

      const response = await fetch('/api/clean-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: compressedBase64 }),
        signal: controller.signal
      });

      // 检查响应是否成功
      if (!response.ok) {
        const errorText = await response.text();
        return { ...image, status: 'error', error: `请求失败: ${response.status}` };
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { ...image, status: 'error', error: '服务器返回格式错误' };
      }

      console.log('[Clean] API Response:', data.success, !!data.data?.image_base64);

      if (data.success && data.data?.image_base64) {
        return { ...image, cleanedBase64: data.data.image_base64, status: 'completed' };
      } else {
        return { ...image, status: 'error', error: data.message || '处理失败' };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ...image, status: 'error', error: '请求超时，请重试' };
      }
      return { ...image, status: 'error', error: String(error) };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const handleCleanAll = async () => {
    const currentSession = sessionRef.current;
    abortControllerRef.current = new AbortController();

    setIsProcessing(true);

    for (let i = 0; i < imagesRef.current.length; i++) {
      // 检查 session 是否仍然有效（用户可能上传了新文件）
      if (sessionRef.current !== currentSession) {
        console.log('[Clean] Session changed, stopping batch clean');
        break;
      }

      if (imagesRef.current[i].status === 'completed') continue;

      setCurrentIndex(i);
      // 设置当前图片为 processing
      const processingImages = imagesRef.current.map((img, idx) =>
        idx === i ? { ...img, status: 'processing' as const } : img
      );
      onImagesUpdate(processingImages);

      const result = await cleanImage(imagesRef.current[i], i);

      // 再次检查 session
      if (sessionRef.current !== currentSession) {
        console.log('[Clean] Session changed after API call, not updating');
        break;
      }

      // 使用最新的 imagesRef 更新
      const updatedImages = imagesRef.current.map((img, idx) =>
        idx === i ? result : img
      );
      onImagesUpdate(updatedImages);
    }

    // 只有当 session 仍然有效时才重置状态
    if (sessionRef.current === currentSession) {
      setCurrentIndex(-1);
      setIsProcessing(false);
    }
  };

  const handleCleanSingle = async (index: number) => {
    const currentSession = sessionRef.current;
    const targetImage = imagesRef.current[index];

    // 1. 设置 processing 状态
    const processingImages = imagesRef.current.map((img, i) =>
      i === index ? { ...img, status: 'processing' as const } : img
    );
    onImagesUpdate(processingImages);

    // 2. 调用 API
    const result = await cleanImage(targetImage, index);

    // 3. 检查 session 是否仍然有效
    if (sessionRef.current !== currentSession) {
      console.log('[Clean] Session changed, not updating single image');
      return;
    }

    // 4. 使用最新的 imagesRef 更新结果，只更新对应 index 的图片
    const updatedImages = imagesRef.current.map((img, i) =>
      i === index ? result : img
    );
    onImagesUpdate(updatedImages);
  };

  const handleDownloadAll = async () => {
    const completedImages = images
      .filter(img => img.cleanedBase64)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (completedImages.length === 0) {
      alert('没有可下载的图片');
      return;
    }

    try {
      const zip = new JSZip();
      const imagesFolder = zip.folder('images');

      // 写入图片文件夹
      for (const img of completedImages) {
        if (img.cleanedBase64) {
          const base64Data = img.cleanedBase64.split(',')[1];
          imagesFolder?.file(`slide-${img.pageNumber}.png`, base64Data, { base64: true });
        }
      }

      // 生成 PPTX（服务端生成，避免客户端打包 Node 内置模块）
      const pptSlides = await Promise.all(
        completedImages.map(async (img) => ({
          pageNumber: img.pageNumber,
          dataUrl: img.cleanedBase64 ? await compressImage(img.cleanedBase64, 1200) : '',
        }))
      );

      const pptxResp = await fetch('/api/generate-pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides: pptSlides.filter(s => s.dataUrl) }),
      });

      if (!pptxResp.ok) {
        const errText = await pptxResp.text().catch(() => '');
        throw new Error(`PPT 生成失败: ${pptxResp.status} ${errText.slice(0, 200)}`);
      }

      const pptxArrayBuffer = await pptxResp.arrayBuffer();
      zip.file('slides.pptx', pptxArrayBuffer);

      // 打包下载
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cleaned-slides.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败', error);
      alert('导出失败，请重试');
    }
  };

  const handleDownloadSingle = (image: SlideImage) => {
    if (!image.cleanedBase64) return;

    const a = document.createElement('a');
    a.href = image.cleanedBase64;
    a.download = `slide-${image.pageNumber}.png`;
    a.click();
  };

  const toggleShowOriginal = (imageId: string) => {
    setShowingOriginal(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {processedCount} / {images.length} 已处理
            {errorCount > 0 && <span className="text-red-500 ml-2">{errorCount} 失败</span>}
          </span>

          <button
            onClick={handleCleanAll}
            disabled={isProcessing || processedCount === images.length}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? '处理中...' : '开始清洗'}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={processedCount === 0}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            打包下载（含PPT）
          </button>
        </div>
      </div>

      {/* 进度条 */}
      {isProcessing && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / images.length) * 100}%` }}
          />
        </div>
      )}

      {/* 图片网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((image, index) => (
          <div
            key={image.id}
            className="relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden"
          >
            {/* 原图/处理后图片 */}
            <div className="aspect-video relative">
              <img
                src={
                  image.cleanedBase64 && !showingOriginal.has(image.id)
                    ? image.cleanedBase64
                    : image.originalBase64
                }
                alt={`Slide ${image.pageNumber}`}
                className="w-full h-full object-contain bg-gray-100 dark:bg-gray-900"
              />

              {/* 状态覆盖层 */}
              {image.status === 'processing' && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                  <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="text-white text-sm">AI 正在清洗...</span>
                </div>
              )}

              {image.status === 'error' && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                  <span className="text-red-600 text-sm bg-white px-2 py-1 rounded">
                    {image.error || '处理失败'}
                  </span>
                </div>
              )}

              {image.status === 'completed' && (
                <div className="absolute top-2 left-2 px-2 py-1 bg-green-500 text-white text-xs rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  已清洗
                </div>
              )}
            </div>

            {/* 操作栏 */}
            <div className="p-2 flex items-center justify-between">
              <span className="text-sm text-gray-500">第 {image.pageNumber} 页</span>

              <div className="flex gap-2">
                {image.status !== 'completed' && image.status !== 'processing' && (
                  <button
                    onClick={() => handleCleanSingle(index)}
                    className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                  >
                    清洗
                  </button>
                )}

                {image.cleanedBase64 && (
                  <>
                    <button
                      onClick={() => toggleShowOriginal(image.id)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      {showingOriginal.has(image.id) ? '查看效果' : '查看原图'}
                    </button>
                    <button
                      onClick={() => handleCleanSingle(index)}
                      className="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200"
                    >
                      重新清洗
                    </button>
                    <button
                      onClick={() => handleDownloadSingle(image)}
                      className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded hover:bg-green-200"
                    >
                      下载
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
