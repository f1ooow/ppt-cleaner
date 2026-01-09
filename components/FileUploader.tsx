'use client';

import { useCallback, useState } from 'react';
import JSZip from 'jszip';
import type { SlideImage } from './types';

interface FileUploaderProps {
  onImagesExtracted: (images: SlideImage[]) => void;
}

export default function FileUploader({ onImagesExtracted }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const extractImagesFromPPTX = async (file: File): Promise<SlideImage[]> => {
    const zip = await JSZip.loadAsync(file);
    const images: SlideImage[] = [];

    const mediaFiles = Object.keys(zip.files)
      .filter(name => name.startsWith('ppt/media/') && /\.(png|jpg|jpeg|gif)$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

    setProgress({ current: 0, total: mediaFiles.length });

    for (let i = 0; i < mediaFiles.length; i++) {
      const fileName = mediaFiles[i];
      const zipFile = zip.files[fileName];
      const base64 = await zipFile.async('base64');
      const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
      const mimeType = ext === 'jpg' ? 'jpeg' : ext;

      images.push({
        id: `slide-${i + 1}`,
        pageNumber: i + 1,
        originalBase64: `data:image/${mimeType};base64,${base64}`,
        status: 'pending'
      });

      setProgress({ current: i + 1, total: mediaFiles.length });
    }

    return images;
  };

  const extractImagesFromImages = async (files: FileList): Promise<SlideImage[]> => {
    const images: SlideImage[] = [];
    const imageFiles = Array.from(files).filter(f =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)
    );

    setProgress({ current: 0, total: imageFiles.length });

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      images.push({
        id: `img-${i + 1}`,
        pageNumber: i + 1,
        originalBase64: base64,
        status: 'pending'
      });

      setProgress({ current: i + 1, total: imageFiles.length });
    }

    return images;
  };

  const extractImagesFromPDF = async (file: File): Promise<SlideImage[]> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: SlideImage[] = [];
    const scale = 2;

    setProgress({ current: 0, total: pdf.numPages });

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (context) {
        await page.render({
          canvasContext: context,
          viewport: viewport,
          // @ts-ignore - pdfjs-dist types issue
          canvas: canvas
        }).promise;

        const base64 = canvas.toDataURL('image/png');
        images.push({
          id: `page-${i}`,
          pageNumber: i,
          originalBase64: base64,
          status: 'pending'
        });
      }

      setProgress({ current: i, total: pdf.numPages });
    }

    return images;
  };

  const handleFile = async (file: File, files?: FileList) => {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (!ext || !['pptx', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      alert('请上传 .pptx、.pdf 或图片文件');
      return;
    }

    setIsProcessing(true);
    try {
      let images: SlideImage[];

      if (ext === 'pptx') {
        images = await extractImagesFromPPTX(file);
      } else if (ext === 'pdf') {
        images = await extractImagesFromPDF(file);
      } else {
        images = await extractImagesFromImages(files || new DataTransfer().files);
        if (images.length === 0) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          images = [{
            id: 'img-1',
            pageNumber: 1,
            originalBase64: base64,
            status: 'pending'
          }];
        }
      }

      if (images.length === 0) {
        alert('未能从文件中提取到图片');
        return;
      }

      onImagesExtracted(images);
    } catch (error: any) {
      console.error('解析文件失败:', error);
      alert(`解析文件失败: ${error?.message || error}`);
    } finally {
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0], files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0], files);
    }
  };

  return (
    <div className="w-full">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200
          ${isProcessing ? 'pointer-events-none opacity-60' : 'cursor-pointer'}
        `}
        style={{
          borderColor: isDragging ? 'rgb(var(--color-primary))' : 'rgb(var(--border-color))',
          backgroundColor: isDragging ? 'rgb(var(--color-primary) / 0.05)' : 'transparent'
        }}
        onClick={() => !isProcessing && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pptx,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          multiple
          onChange={handleInputChange}
          className="hidden"
        />

        {isProcessing ? (
          <div className="space-y-4">
            <div
              className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto"
              style={{ borderColor: 'rgb(var(--color-primary))', borderTopColor: 'transparent' }}
            />
            <p style={{ color: 'rgb(var(--text-secondary))' }}>
              正在解析文件...
            </p>
            {progress.total > 0 && (
              <p className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>
                {progress.current} / {progress.total} 页
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto mb-4" style={{ color: 'rgb(var(--text-muted))' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-lg font-medium mb-2" style={{ color: 'rgb(var(--text-primary))' }}>
              拖放文件到此处，或点击上传
            </p>
            <p className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>
              支持 .pptx、.pdf 和图片格式
            </p>
          </>
        )}
      </div>
    </div>
  );
}
