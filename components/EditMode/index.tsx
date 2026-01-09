'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { DrawMode, EditModeProps } from './types';
import type { CanvasEditorRef } from './CanvasEditor';

export default function EditMode({}: EditModeProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ url: string; label: string }>>([]);
  const [drawMode, setDrawMode] = useState<DrawMode>('brush');
  const [brushSize, setBrushSize] = useState(30);
  const [instruction, setInstruction] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasDrawings, setHasDrawings] = useState(false);
  const [CanvasEditor, setCanvasEditor] = useState<any>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const canvasRef = useRef<CanvasEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    import('./CanvasEditor').then((mod) => setCanvasEditor(() => mod.default));
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageUrl(dataUrl);
      setOriginalImageUrl(dataUrl);
      setHistory([{ url: dataUrl, label: '原图' }]);
      setInstruction('');
      setShowOriginal(false);
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  }, []);

  const handleHistoryChange = useCallback((u: boolean, r: boolean, d: boolean) => {
    setCanUndo(u);
    setCanRedo(r);
    setHasDrawings(d);
  }, []);

  const handleApply = useCallback(async () => {
    if (!canvasRef.current || !instruction.trim()) return;
    const maskBase64 = canvasRef.current.buildMaskBase64();
    const imageBase64 = canvasRef.current.getImageBase64();
    if (!maskBase64 || !imageBase64) return alert('请先标记要编辑的区域');

    setIsProcessing(true);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 180000);
      const res = await fetch('/api/inpaint-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: `data:image/png;base64,${imageBase64}`,
          mask_base64: `data:image/png;base64,${maskBase64}`,
          instruction,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.data?.image_base64) {
        const newUrl = data.data.image_base64.startsWith('data:') ? data.data.image_base64 : `data:image/png;base64,${data.data.image_base64}`;
        setImageUrl(newUrl);
        setHistory(prev => [...prev, { url: newUrl, label: `编辑 ${prev.length}` }]);
        setInstruction('');
        canvasRef.current?.clear();
      } else throw new Error(data.message || '处理失败');
    } catch (e: any) {
      alert(e.name === 'AbortError' ? '请求超时' : `失败: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [instruction]);

  const isBrush = drawMode === 'brush' || drawMode === 'eraser';

  return (
    <div className="w-full">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />

      <div
        className="rounded-2xl overflow-hidden flex"
        style={{
          backgroundColor: 'rgb(var(--bg-card))',
          border: '1px solid rgb(var(--border-color) / 0.5)',
        }}
      >
        {/* 画布 */}
        <div className="w-[65%] shrink-0">
          {imageUrl && CanvasEditor ? (
            <div className="relative aspect-video">
              <CanvasEditor
                ref={canvasRef}
                imageUrl={showOriginal ? originalImageUrl : imageUrl}
                drawMode={drawMode}
                brushSize={brushSize}
                isProcessing={isProcessing}
                onHistoryChange={handleHistoryChange}
              />
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="aspect-video flex flex-col items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'rgb(var(--bg-elevated))' }}
            >
              <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} style={{ color: 'rgb(var(--text-muted))' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm" style={{ color: 'rgb(var(--text-muted))' }}>上传图片</span>
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        <div
          className="flex-1 p-4 flex flex-col gap-4 text-xs"
          style={{ borderLeft: '1px solid rgb(var(--border-color) / 0.5)' }}
        >
          {/* 工具选择 */}
          <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'rgb(var(--bg-elevated))' }}>
            {[
              { mode: 'brush' as const, label: '画笔' },
              { mode: 'rectangle' as const, label: '矩形' },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setDrawMode(mode)}
                className="flex-1 py-2 rounded-md transition-all font-medium"
                style={{
                  backgroundColor: (mode === 'brush' ? isBrush : drawMode === mode) ? 'rgb(var(--bg-card))' : 'transparent',
                  color: (mode === 'brush' ? isBrush : drawMode === mode) ? 'rgb(var(--text-primary))' : 'rgb(var(--text-muted))',
                  boxShadow: (mode === 'brush' ? isBrush : drawMode === mode) ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 画笔子选项 */}
          {isBrush && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                {[
                  { mode: 'brush' as const, label: '涂抹遮罩' },
                  { mode: 'eraser' as const, label: '擦除遮罩' },
                ].map(({ mode, label }) => (
                  <button
                    key={mode}
                    onClick={() => setDrawMode(mode)}
                    className="flex-1 py-2 rounded-lg transition-all"
                    style={{
                      backgroundColor: drawMode === mode ? 'rgb(var(--color-primary))' : 'rgb(var(--bg-elevated))',
                      color: drawMode === mode ? 'white' : 'rgb(var(--text-secondary))',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: 'rgb(var(--text-muted))' }}>大小</span>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={brushSize}
                  onChange={(e) => setBrushSize(+e.target.value)}
                  className="flex-1 h-1.5 rounded appearance-none cursor-pointer"
                  style={{ backgroundColor: 'rgb(var(--border-color))', accentColor: 'rgb(var(--color-primary))' }}
                />
                <span className="w-8 text-right tabular-nums" style={{ color: 'rgb(var(--text-muted))' }}>{brushSize}</span>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 p-1 rounded-lg" style={{ backgroundColor: 'rgb(var(--bg-elevated))' }}>
            {[
              { action: () => canvasRef.current?.undo(), disabled: !canUndo, icon: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3', label: '撤销' },
              { action: () => canvasRef.current?.redo(), disabled: !canRedo, icon: 'M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3', label: '重做' },
              { action: () => canvasRef.current?.clear(), disabled: !hasDrawings, icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', label: '清空' },
            ].map(({ action, disabled, icon, label }) => (
              <button
                key={label}
                onClick={action}
                disabled={disabled}
                className="flex-1 py-2 rounded-md transition-colors disabled:opacity-25 flex items-center justify-center gap-1.5"
                style={{ color: 'rgb(var(--text-secondary))' }}
                title={label}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* 指令输入 - 填满剩余空间 */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="描述修改效果..."
              className="w-full flex-1 p-3 rounded-lg resize-none focus:outline-none focus:ring-2 min-h-[60px]"
              style={{
                backgroundColor: 'rgb(var(--bg-elevated))',
                color: 'rgb(var(--text-primary))',
                '--tw-ring-color': 'rgb(var(--color-primary) / 0.3)',
              } as React.CSSProperties}
            />
          </div>

          {/* 底部操作区 */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleApply}
              disabled={!hasDrawings || !instruction.trim() || isProcessing}
              className="w-full py-2.5 rounded-lg font-medium transition-all disabled:opacity-40"
              style={{ backgroundColor: 'rgb(var(--color-primary))', color: 'white' }}
            >
              {isProcessing ? '处理中...' : '应用'}
            </button>

            {imageUrl && (
              <>
                {originalImageUrl && originalImageUrl !== imageUrl && (
                  <button
                    onClick={() => setShowOriginal(!showOriginal)}
                    className="w-full py-2 rounded-lg transition-all flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: showOriginal ? 'rgb(var(--color-primary))' : 'rgb(var(--bg-elevated))',
                      color: showOriginal ? 'white' : 'rgb(var(--text-secondary))',
                    }}
                  >
                    {showOriginal ? '返回编辑' : '查看原图'}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = imageUrl;
                      a.download = `img-${Date.now()}.png`;
                      a.click();
                    }}
                    className="flex-1 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: 'rgb(var(--bg-elevated))', color: 'rgb(var(--text-secondary))' }}
                  >
                    下载
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: 'rgb(var(--bg-elevated))', color: 'rgb(var(--text-secondary))' }}
                  >
                    换图
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 历史图片区域 */}
      {history.length > 0 && (
        <div
          className="mt-3 p-3 rounded-xl"
          style={{
            backgroundColor: 'rgb(var(--bg-card))',
            border: '1px solid rgb(var(--border-color) / 0.5)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium" style={{ color: 'rgb(var(--text-secondary))' }}>
              历史版本
            </span>
            <span className="text-xs" style={{ color: 'rgb(var(--text-muted))' }}>
              ({history.length})
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.map((item, index) => (
              <button
                key={index}
                onClick={() => {
                  setImageUrl(item.url);
                  setShowOriginal(false);
                  canvasRef.current?.clear();
                }}
                className="shrink-0 rounded-lg overflow-hidden transition-all hover:ring-2"
                style={{
                  width: '80px',
                  height: '45px',
                  border: imageUrl === item.url ? '2px solid rgb(var(--color-primary))' : '1px solid rgb(var(--border-color))',
                  '--tw-ring-color': 'rgb(var(--color-primary) / 0.3)',
                } as React.CSSProperties}
                title={item.label}
              >
                <img
                  src={item.url}
                  alt={item.label}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
