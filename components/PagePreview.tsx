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
  const [isDownloading, setIsDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [showingOriginal, setShowingOriginal] = useState<Set<string>>(new Set());

  const sessionRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const imagesRef = useRef<SlideImage[]>(images);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    const newSessionId = images[0]?.id || '';
    if (sessionRef.current && sessionRef.current !== newSessionId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsProcessing(false);
      setBatchProgress(null);
    }
    sessionRef.current = newSessionId;
  }, [images]);

  const processedCount = images.filter(img => img.status === 'completed').length;
  const errorCount = images.filter(img => img.status === 'error').length;

  const cleanImage = async (image: SlideImage, index: number): Promise<SlideImage> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    try {
      const response = await fetch('/api/clean-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: image.originalBase64 }),
        signal: controller.signal
      });

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

    const indicesToProcess = imagesRef.current
      .map((img, idx) => ({ img, idx }))
      .filter(({ img }) => img.status !== 'completed' && img.status !== 'processing')
      .map(({ idx }) => idx);

    if (indicesToProcess.length === 0) return;

    setIsProcessing(true);
    setBatchProgress({ done: 0, total: indicesToProcess.length });

    const queuedImages = imagesRef.current.map((img, idx) => {
      if (!indicesToProcess.includes(idx)) return img;
      if (img.status === 'processing') return img;
      return { ...img, status: 'queued' as const, error: undefined };
    });
    onImagesUpdate(queuedImages);
    imagesRef.current = queuedImages;

    let cursor = 0;
    let inFlight = 0;
    const maxConcurrent = 3;

    const finishIfDone = () => {
      if (sessionRef.current !== currentSession) return;
      if (cursor < indicesToProcess.length) return;
      if (inFlight > 0) return;
      setIsProcessing(false);
      setBatchProgress(null);
    };

    const launchNext = () => {
      if (sessionRef.current !== currentSession) return;

      const indicesLaunching: number[] = [];
      while (inFlight < maxConcurrent && cursor < indicesToProcess.length) {
        const idx = indicesToProcess[cursor++];
        indicesLaunching.push(idx);
        inFlight += 1;
      }

      if (indicesLaunching.length === 0) return;

      const launchingSet = new Set(indicesLaunching);
      const processingImages = imagesRef.current.map((img, i) =>
        launchingSet.has(i)
          ? { ...img, status: 'processing' as const, error: undefined }
          : img
      );
      onImagesUpdate(processingImages);
      imagesRef.current = processingImages;

      for (const idx of indicesLaunching) {
        cleanImage(imagesRef.current[idx], idx)
          .then((result) => {
            if (sessionRef.current !== currentSession) return;
            const updatedImages = imagesRef.current.map((img, i) => (i === idx ? result : img));
            onImagesUpdate(updatedImages);
            imagesRef.current = updatedImages;
          })
          .catch((error) => {
            if (sessionRef.current !== currentSession) return;
            const updatedImages = imagesRef.current.map((img, i) =>
              i === idx ? { ...img, status: 'error' as const, error: String(error) } : img
            );
            onImagesUpdate(updatedImages);
            imagesRef.current = updatedImages;
          })
          .finally(() => {
            inFlight -= 1;
            setBatchProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
            launchNext();
            finishIfDone();
          });
      }
    };

    launchNext();
  };

  const handleCleanSingle = async (index: number) => {
    const currentSession = sessionRef.current;
    const targetImage = imagesRef.current[index];

    const processingImages = imagesRef.current.map((img, i) =>
      i === index ? { ...img, status: 'processing' as const } : img
    );
    onImagesUpdate(processingImages);

    const result = await cleanImage(targetImage, index);

    if (sessionRef.current !== currentSession) {
      console.log('[Clean] Session changed, not updating single image');
      return;
    }

    const updatedImages = imagesRef.current.map((img, i) =>
      i === index ? result : img
    );
    onImagesUpdate(updatedImages);
  };

  const handleDownloadAll = async () => {
    console.log('[Download] 开始打包下载, images:', images.length, 'processedCount:', processedCount);
    const completedImages = images
      .filter(img => img.cleanedBase64)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    console.log('[Download] completedImages:', completedImages.length);

    if (completedImages.length === 0) {
      alert('没有可下载的图片');
      return;
    }

    setIsDownloading(true);
    try {
      const zip = new JSZip();

      for (const img of completedImages) {
        if (!img.cleanedBase64) continue;
        const match = img.cleanedBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
        const base64Data = match?.[2] || img.cleanedBase64.split(',')[1];
        zip.file(`slide-${img.pageNumber}.png`, base64Data, { base64: true });
      }

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
    } finally {
      setIsDownloading(false);
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
          className="flex items-center gap-2 transition-colors"
          style={{ color: 'rgb(var(--text-secondary))' }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>

        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>
            {processedCount} / {images.length} 已处理
            {errorCount > 0 && <span className="ml-2" style={{ color: 'rgb(var(--color-error))' }}>{errorCount} 失败</span>}
          </span>

          <button
            onClick={handleCleanAll}
            disabled={isProcessing || processedCount === images.length}
            className="btn-primary btn-sm"
          >
            {isProcessing ? '处理中...' : '批量清洗'}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={processedCount === 0 || isDownloading}
            className="btn-success btn-sm"
          >
            {isDownloading ? '打包中...' : '打包下载'}
          </button>
        </div>
      </div>

      {/* 进度条 */}
      {isProcessing && batchProgress && (
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--bg-elevated))' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${batchProgress.total ? (batchProgress.done / batchProgress.total) * 100 : 0}%`,
              backgroundColor: 'rgb(var(--color-primary))'
            }}
          />
        </div>
      )}

      {/* 图片网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((image, index) => (
          <div
            key={image.id}
            className="relative rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'rgb(var(--bg-card))',
              border: '1px solid rgb(var(--border-color) / 0.5)'
            }}
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
                className="w-full h-full object-contain"
                style={{ backgroundColor: 'rgb(var(--bg-elevated))' }}
              />

              {/* 状态覆盖层 */}
              {image.status === 'processing' && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                  <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="text-white text-sm">AI 正在清洗...</span>
                </div>
              )}

              {image.status === 'queued' && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <span className="text-white text-sm bg-black/40 px-3 py-1 rounded-lg">
                    队列中
                  </span>
                </div>
              )}

              {image.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgb(var(--color-error) / 0.1)' }}>
                  <span className="text-sm px-3 py-1.5 rounded-lg bg-white" style={{ color: 'rgb(var(--color-error))' }}>
                    {image.error || '处理失败'}
                  </span>
                </div>
              )}

              {image.status === 'completed' && (
                <div className="absolute top-2 left-2 badge-success">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  已清洗
                </div>
              )}
            </div>

            {/* 操作栏 */}
            <div className="p-3 flex items-center justify-between">
              <span className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>第 {image.pageNumber} 页</span>

              <div className="flex gap-1.5">
                {(image.status === 'pending' || image.status === 'error') && (
                  <button
                    onClick={() => handleCleanSingle(index)}
                    className="text-xs px-2.5 py-1 rounded-lg transition-all"
                    style={{
                      backgroundColor: 'rgb(var(--color-primary) / 0.1)',
                      color: 'rgb(var(--color-primary))'
                    }}
                  >
                    清洗
                  </button>
                )}

                {image.cleanedBase64 && (
                  <>
                    <button
                      onClick={() => toggleShowOriginal(image.id)}
                      className="text-xs px-2.5 py-1 rounded-lg transition-all"
                      style={{
                        backgroundColor: 'rgb(var(--bg-elevated))',
                        color: 'rgb(var(--text-secondary))'
                      }}
                    >
                      {showingOriginal.has(image.id) ? '查看效果' : '查看原图'}
                    </button>
                    <button
                      onClick={() => handleCleanSingle(index)}
                      className="text-xs px-2.5 py-1 rounded-lg transition-all"
                      style={{
                        backgroundColor: 'rgb(var(--color-warning) / 0.1)',
                        color: 'rgb(var(--color-warning))'
                      }}
                    >
                      重新清洗
                    </button>
                    <button
                      onClick={() => handleDownloadSingle(image)}
                      className="text-xs px-2.5 py-1 rounded-lg transition-all"
                      style={{
                        backgroundColor: 'rgb(var(--color-success) / 0.1)',
                        color: 'rgb(var(--color-success))'
                      }}
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
