export interface SlideImage {
  id: string;
  pageNumber: number;
  originalBase64: string;
  cleanedBase64?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}
