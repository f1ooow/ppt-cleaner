// EditMode 类型定义

export type DrawMode = 'brush' | 'rectangle' | 'eraser';

export interface EditModeProps {
  onBack?: () => void;
}

export interface CanvasEditorProps {
  imageUrl: string | null;
  drawMode: DrawMode;
  brushSize: number;
  onCanvasReady: (canvas: any) => void;
}

export interface ControlPanelProps {
  drawMode: DrawMode;
  onDrawModeChange: (mode: DrawMode) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  onApply: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isProcessing: boolean;
  hasDrawings: boolean;
}

export interface HistoryState {
  objects: any[];
}
