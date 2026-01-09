'use client';

import { useState } from 'react';
import FileUploader from '@/components/FileUploader';
import PagePreview from '@/components/PagePreview';
import EditMode from '@/components/EditMode';
import type { SlideImage } from '@/components/types';

type AppMode = 'clean' | 'edit';

export default function Home() {
  const [mode, setMode] = useState<AppMode>('clean');
  const [images, setImages] = useState<SlideImage[]>([]);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');

  const handleImagesExtracted = (extractedImages: SlideImage[]) => {
    setImages(extractedImages);
    setStep('preview');
  };

  const handleBack = () => {
    setStep('upload');
    setImages([]);
  };

  const handleModeChange = (newMode: AppMode) => {
    setMode(newMode);
    if (newMode === 'clean') {
      setStep('upload');
      setImages([]);
    }
  };

  return (
    <main className="min-h-screen">
      <div className="mx-auto px-6 py-8 max-w-7xl xl:px-10">
        {/* 头部区域 */}
        <header className="mb-4">
          <div className="mb-4">
            <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'rgb(var(--text-primary))' }}>
              PPT 素材工具
            </h1>
            <p className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>
              {mode === 'clean'
                ? '上传 PPT/PDF，AI 自动提取纯净素材'
                : '上传图片，标记区域，AI 智能编辑'}
            </p>
          </div>

          {/* 模式切换 - 下划线样式 */}
          <div className="flex gap-6 border-b" style={{ borderColor: 'rgb(var(--border-color))' }}>
            <button
              onClick={() => handleModeChange('clean')}
              className="pb-2 text-sm font-medium transition-colors relative"
              style={{ color: mode === 'clean' ? 'rgb(var(--color-primary))' : 'rgb(var(--text-muted))' }}
            >
              素材清洗
              {mode === 'clean' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: 'rgb(var(--color-primary))' }} />
              )}
            </button>
            <button
              onClick={() => handleModeChange('edit')}
              className="pb-2 text-sm font-medium transition-colors relative"
              style={{ color: mode === 'edit' ? 'rgb(var(--color-primary))' : 'rgb(var(--text-muted))' }}
            >
              图片编辑
              {mode === 'edit' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: 'rgb(var(--color-primary))' }} />
              )}
            </button>
          </div>
        </header>

        {/* 主内容区 */}
        {mode === 'clean' ? (
          <div className="card p-6">
            {step === 'upload' ? (
              <FileUploader onImagesExtracted={handleImagesExtracted} />
            ) : (
              <PagePreview
                images={images}
                onImagesUpdate={setImages}
                onBack={handleBack}
              />
            )}
          </div>
        ) : (
          <EditMode />
        )}
      </div>
    </main>
  );
}
