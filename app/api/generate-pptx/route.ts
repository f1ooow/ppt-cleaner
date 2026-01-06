import { NextRequest, NextResponse } from 'next/server';
import PptxGenJS from 'pptxgenjs';

export const runtime = 'nodejs';

type GeneratePptxRequest = {
  slides: Array<{
    pageNumber?: number;
    dataUrl: string;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<GeneratePptxRequest>;
    const slides = Array.isArray(body.slides) ? body.slides : [];

    if (slides.length === 0) {
      return NextResponse.json(
        { success: false, message: 'slides 不能为空' },
        { status: 400 }
      );
    }

    const pptx = new PptxGenJS();
    pptx.layout = '16x9';

    const slideWidth = (pptx as any).width ?? 13.333;
    const slideHeight = (pptx as any).height ?? 7.5;

    for (const item of slides) {
      if (!item?.dataUrl) continue;
      const slide = pptx.addSlide();
      slide.addImage({
        data: item.dataUrl,
        x: 0,
        y: 0,
        w: slideWidth,
        h: slideHeight,
      });
    }

    const buf = (await (pptx as any).write('nodebuffer')) as Buffer | Uint8Array;
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const filename = 'slides.pptx';

    return new Response(buffer as any, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('生成 PPTX 失败:', error);
    return NextResponse.json(
      { success: false, message: `生成 PPTX 失败: ${error}` },
      { status: 500 }
    );
  }
}
