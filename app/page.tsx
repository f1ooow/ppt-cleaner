'use client';

import { useState } from 'react';
import FileUploader from '@/components/FileUploader';
import PagePreview from '@/components/PagePreview';
import type { SlideImage } from '@/components/types';

export default function Home() {
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

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* 标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            PPT 素材清洗工具
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            上传 PPT 或 PDF 文件，AI 自动去除文字和模板装饰，提取纯净素材
          </p>
        </div>

        {/* 主内容区 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6">
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
      </div>
    </main>
  );
}
