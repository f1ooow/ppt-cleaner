'use client';

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { DrawMode } from './types';

interface CanvasEditorProps {
  imageUrl: string | null;
  drawMode: DrawMode;
  brushSize: number;
  isProcessing?: boolean;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean, hasDrawings: boolean) => void;
}

export interface CanvasEditorRef {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  buildMaskBase64: () => string | null;
  getImageBase64: () => string | null;
}

const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>(
  ({ imageUrl, drawMode, brushSize, isProcessing = false, onHistoryChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<any>(null);
    const canvasInstanceRef = useRef<any>(null);
    const imageInfoRef = useRef<{ width: number; height: number } | null>(null);

    const historyRef = useRef<any[][]>([[]]);
    const historyStepRef = useRef(0);
    const [, setHistoryStep] = useState(0);
    const [, setHistoryLength] = useState(1);
    const [canvasReady, setCanvasReady] = useState(false);

    const isRectDrawingRef = useRef(false);
    const rectStartPointRef = useRef<{ x: number; y: number } | null>(null);
    const currentRectRef = useRef<any>(null);

    const snapshotObjects = useCallback((canvas: any) => {
      return canvas.getObjects().map((obj: any) => obj.toObject(['selectable', 'evented']));
    }, []);

    const notifyHistoryChange = useCallback(() => {
      const canvas = canvasInstanceRef.current;
      if (!canvas) return;
      const canUndo = historyStepRef.current > 0;
      const canRedo = historyStepRef.current < historyRef.current.length - 1;
      const hasDrawings = canvas.getObjects().length > 0;
      onHistoryChange?.(canUndo, canRedo, hasDrawings);
    }, [onHistoryChange]);

    const pushHistory = useCallback(() => {
      const canvas = canvasInstanceRef.current;
      if (!canvas) return;

      console.log('[CanvasEditor] pushHistory called, objects:', canvas.getObjects().length);

      const snapshot = snapshotObjects(canvas);
      let next = historyRef.current.slice(0, historyStepRef.current + 1);
      next.push(snapshot);

      const MAX_HISTORY = 50;
      if (next.length > MAX_HISTORY) next = next.slice(next.length - MAX_HISTORY);

      historyRef.current = next;
      historyStepRef.current = next.length - 1;
      setHistoryLength(next.length);
      setHistoryStep(historyStepRef.current);
      notifyHistoryChange();
    }, [snapshotObjects, notifyHistoryChange]);

    const restoreObjectsFromSnapshot = useCallback(async (snapshot: any[]) => {
      const canvas = canvasInstanceRef.current;
      const fabric = fabricRef.current;
      if (!canvas || !fabric) return;

      canvas.discardActiveObject();
      canvas.getObjects().slice().forEach((obj: any) => canvas.remove(obj));

      for (const objJson of snapshot) {
        let obj: any = null;
        if (objJson?.type === 'rect') {
          obj = await fabric.Rect.fromObject(objJson);
        } else if (objJson?.type === 'path' || objJson?.type === 'Path') {
          obj = await fabric.Path.fromObject(objJson);
        }
        if (obj) {
          obj.set({ selectable: false, evented: false });
          canvas.add(obj);
        }
      }
      canvas.requestRenderAll();
      notifyHistoryChange();
    }, [notifyHistoryChange]);

    const undo = useCallback(() => {
      const nextStep = historyStepRef.current - 1;
      if (nextStep < 0) return;

      historyStepRef.current = nextStep;
      setHistoryStep(nextStep);
      restoreObjectsFromSnapshot(historyRef.current[nextStep]);
    }, [restoreObjectsFromSnapshot]);

    const redo = useCallback(() => {
      const nextStep = historyStepRef.current + 1;
      if (nextStep >= historyRef.current.length) return;

      historyStepRef.current = nextStep;
      setHistoryStep(nextStep);
      restoreObjectsFromSnapshot(historyRef.current[nextStep]);
    }, [restoreObjectsFromSnapshot]);

    const clear = useCallback(() => {
      const canvas = canvasInstanceRef.current;
      if (!canvas) return;
      canvas.getObjects().slice().forEach((obj: any) => canvas.remove(obj));
      canvas.requestRenderAll();
      pushHistory();
    }, [pushHistory]);

    const buildMaskBase64 = useCallback((): string | null => {
      const canvas = canvasInstanceRef.current;
      const fabric = fabricRef.current;
      if (!canvas || !fabric) return null;

      const bgImage = canvas.backgroundImage;
      if (!bgImage) return null;

      const objects = canvas.getObjects();
      if (objects.length === 0) return null;

      const originalBg = canvas.backgroundImage;
      const originalBgColor = canvas.backgroundColor;
      const originalStyles = objects.map((obj: any) => ({
        obj,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        opacity: obj.opacity,
      }));

      try {
        canvas.discardActiveObject();
        canvas.backgroundImage = null;
        canvas.backgroundColor = 'black';

        objects.forEach((obj: any) => {
          if (obj.type === 'path' || obj.type === 'Path') {
            obj.set({ stroke: 'white', opacity: 1 });
          } else if (obj.type === 'rect') {
            obj.set({ fill: 'white', stroke: 'white', opacity: 1 });
          }
        });

        canvas.renderAll();

        const originalVpt = canvas.viewportTransform;
        try {
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          const maskDataUrl = canvas.toDataURL({
            format: 'png',
            left: 0,
            top: 0,
            width: bgImage.width,
            height: bgImage.height,
            multiplier: 1,
            enableRetinaScaling: false,
          });
          return maskDataUrl.split(',')[1];
        } finally {
          canvas.setViewportTransform(originalVpt);
        }
      } finally {
        canvas.backgroundImage = originalBg;
        canvas.backgroundColor = originalBgColor;
        originalStyles.forEach((style: { obj: any; fill: any; stroke: any; strokeWidth: any; opacity: any }) => {
          style.obj.set({ fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity });
        });
        canvas.requestRenderAll();
      }
    }, []);

    const getImageBase64 = useCallback((): string | null => {
      const canvas = canvasInstanceRef.current;
      if (!canvas || !canvas.backgroundImage) return null;

      const bgImage = canvas.backgroundImage;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bgImage.width;
      tempCanvas.height = bgImage.height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(bgImage.getElement(), 0, 0);
      return tempCanvas.toDataURL('image/png').split(',')[1];
    }, []);

    useImperativeHandle(ref, () => ({
      undo,
      redo,
      clear,
      buildMaskBase64,
      getImageBase64,
    }), [undo, redo, clear, buildMaskBase64, getImageBase64]);

    // Initialize Fabric.js canvas
    useEffect(() => {
      if (!canvasRef.current || !containerRef.current) return;

      let mounted = true;

      const initCanvas = async () => {
        const fabric = await import('fabric');
        if (!mounted) return;

        fabricRef.current = fabric;

        const canvas = new fabric.Canvas(canvasRef.current!, {
          isDrawingMode: false,
          selection: false,
          backgroundColor: '#F2F2F7',
          preserveObjectStacking: true,
          enableRetinaScaling: true,
          uniformScaling: false,
        });

        canvasInstanceRef.current = canvas;

        const container = containerRef.current;
        if (container) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          canvas.setDimensions({ width: w, height: h });
        }

        setCanvasReady(true);
      };

      initCanvas();

      return () => {
        mounted = false;
        setCanvasReady(false);
        if (canvasInstanceRef.current) {
          canvasInstanceRef.current.dispose();
          canvasInstanceRef.current = null;
        }
      };
    }, []);

    // Handle container resize
    useEffect(() => {
      const canvas = canvasInstanceRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const handleResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        canvas.setDimensions({ width: w, height: h });

        if (imageInfoRef.current && canvas.backgroundImage) {
          const { width: imgW, height: imgH } = imageInfoRef.current;
          const scale = Math.min(w / imgW, h / imgH, 1);
          const tx = (w - imgW * scale) / 2;
          const ty = (h - imgH * scale) / 2;
          canvas.setViewportTransform([scale, 0, 0, scale, tx, ty]);
          canvas.requestRenderAll();
        }
      };

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);

      return () => resizeObserver.disconnect();
    }, []);

    // Load image when imageUrl changes or canvas becomes ready
    useEffect(() => {
      if (!canvasReady) return;
      const canvas = canvasInstanceRef.current;
      const fabric = fabricRef.current;
      if (!canvas || !fabric || !imageUrl) return;

      fabric.FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' })
        .then((img: any) => {
          imageInfoRef.current = { width: img.width, height: img.height };

          img.set({
            scaleX: 1,
            scaleY: 1,
            originX: 'left',
            originY: 'top',
            left: 0,
            top: 0,
          });

          canvas.clear();
          canvas.backgroundColor = '#F2F2F7';
          canvas.backgroundImage = img;

          canvas.clipPath = new fabric.Rect({
            left: 0,
            top: 0,
            width: img.width,
            height: img.height,
            originX: 'left',
            originY: 'top',
            absolutePositioned: true,
            selectable: false,
            evented: false,
          });

          const container = containerRef.current;
          if (container) {
            const viewW = container.clientWidth;
            const viewH = container.clientHeight;
            const scale = Math.min(viewW / img.width, viewH / img.height, 1);
            const tx = (viewW - img.width * scale) / 2;
            const ty = (viewH - img.height * scale) / 2;
            canvas.setViewportTransform([scale, 0, 0, scale, tx, ty]);
          }

          canvas.requestRenderAll();

          historyRef.current = [[]];
          historyStepRef.current = 0;
          setHistoryLength(1);
          setHistoryStep(0);
          notifyHistoryChange();
        })
        .catch(console.error);
    }, [canvasReady, imageUrl, notifyHistoryChange]);

    // Handle draw mode changes
    useEffect(() => {
      if (!canvasReady) return;
      const canvas = canvasInstanceRef.current;
      const fabric = fabricRef.current;
      if (!canvas || !fabric) return;

      canvas.off('mouse:down');
      canvas.off('mouse:move');
      canvas.off('mouse:up');
      canvas.off('path:created');

      if (drawMode === 'brush') {
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.getObjects().forEach((obj: any) => {
          obj.set({ selectable: false, evented: false });
        });

        const brush = new fabric.PencilBrush(canvas);
        brush.color = 'rgba(255, 0, 0, 0.5)';
        brush.width = brushSize;
        canvas.freeDrawingBrush = brush;
        canvas.isDrawingMode = true;

        canvas.on('path:created', () => {
          pushHistory();
        });
      } else if (drawMode === 'rectangle') {
        canvas.isDrawingMode = false;
        canvas.selection = false;

        canvas.getObjects().forEach((obj: any) => {
          obj.set({
            selectable: true,
            evented: true,
          });
          if (obj.type === 'rect') {
            obj.setControlsVisibility({ mtr: false });
          }
        });
        canvas.requestRenderAll();

        const handleMouseDown = (opt: any) => {
          const pointer = canvas.getScenePoint(opt.e);
          const objects = canvas.getObjects();

          for (let i = objects.length - 1; i >= 0; i--) {
            const obj = objects[i];
            if (obj.containsPoint(pointer)) {
              canvas.setActiveObject(obj);
              canvas.requestRenderAll();
              return;
            }
          }
          isRectDrawingRef.current = true;
          rectStartPointRef.current = { x: pointer.x, y: pointer.y };

          const rect = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 0,
            height: 0,
            originX: 'left',
            originY: 'top',
            fill: 'rgba(255, 0, 0, 0.3)',
            stroke: 'rgba(255, 0, 0, 0.8)',
            strokeWidth: 2,
            selectable: true,
            evented: true,
          });
          rect.setControlsVisibility({
            mtr: false,
          });
          currentRectRef.current = rect;
          canvas.add(rect);
        };

        const handleMouseMove = (opt: any) => {
          if (!isRectDrawingRef.current || !rectStartPointRef.current || !currentRectRef.current) return;

          const pointer = canvas.getScenePoint(opt.e);
          const startX = rectStartPointRef.current.x;
          const startY = rectStartPointRef.current.y;

          const left = Math.min(startX, pointer.x);
          const top = Math.min(startY, pointer.y);
          const width = Math.abs(pointer.x - startX);
          const height = Math.abs(pointer.y - startY);

          currentRectRef.current.set({ left, top, width, height });
          canvas.requestRenderAll();
        };

        const handleMouseUp = () => {
          if (!isRectDrawingRef.current) return;

          isRectDrawingRef.current = false;
          rectStartPointRef.current = null;

          if (currentRectRef.current) {
            const rect = currentRectRef.current;
            if (rect.width < 5 || rect.height < 5) {
              canvas.remove(rect);
            } else {
              pushHistory();
            }
          }
          currentRectRef.current = null;
        };

        const handleObjectModified = () => {
          pushHistory();
        };

        canvas.on('mouse:down', handleMouseDown);
        canvas.on('mouse:move', handleMouseMove);
        canvas.on('mouse:up', handleMouseUp);
        canvas.on('object:modified', handleObjectModified);
      } else if (drawMode === 'eraser') {
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.getObjects().forEach((obj: any) => {
          obj.set({ selectable: false, evented: false });
        });

        const brush = new fabric.PencilBrush(canvas);
        brush.color = 'rgba(128, 128, 128, 0.5)';
        brush.width = brushSize;
        canvas.freeDrawingBrush = brush;
        canvas.isDrawingMode = true;

        canvas.on('path:created', (e: any) => {
          const erasePath = e.path;
          const toRemove: any[] = [];

          canvas.getObjects().forEach((obj: any) => {
            if (obj !== erasePath && obj.intersectsWithObject(erasePath)) {
              toRemove.push(obj);
            }
          });

          toRemove.forEach((obj) => canvas.remove(obj));
          canvas.remove(erasePath);
          canvas.requestRenderAll();

          if (toRemove.length > 0) {
            pushHistory();
          }
        });
      }

      return () => {
        canvas.off('mouse:down');
        canvas.off('mouse:move');
        canvas.off('mouse:up');
        canvas.off('path:created');
        canvas.off('object:modified');
      };
    }, [canvasReady, drawMode, brushSize, pushHistory]);

    // Update brush size
    useEffect(() => {
      const canvas = canvasInstanceRef.current;
      if (!canvas || !canvas.freeDrawingBrush) return;
      canvas.freeDrawingBrush.width = brushSize;
    }, [brushSize]);

    // Keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        const isMod = e.ctrlKey || e.metaKey;

        if (isMod && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((isMod && e.key === 'y') || (isMod && e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    // Disable canvas interaction when processing
    useEffect(() => {
      const canvas = canvasInstanceRef.current;
      if (!canvas) return;

      if (isProcessing) {
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.getObjects().forEach((obj: any) => {
          obj.set({ selectable: false, evented: false });
        });
        canvas.requestRenderAll();
      }
    }, [isProcessing]);

    return (
      <div ref={containerRef} className="relative w-full h-full min-h-[400px] bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
        <canvas ref={canvasRef} />
        {isProcessing && (
          <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-600 dark:text-slate-300 font-medium">AI 处理中...</span>
            </div>
          </div>
        )}
      </div>
    );
  }
);

CanvasEditor.displayName = 'CanvasEditor';

export default CanvasEditor;
