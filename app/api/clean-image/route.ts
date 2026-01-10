import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.GEMINI_API_BASE || 'https://api.nkb.nkbpal.cn';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-image-preview';

export async function POST(request: NextRequest) {
  try {
    console.log('API_BASE:', API_BASE);
    console.log('API_KEY:', API_KEY ? '已配置' : '未配置');
    console.log('MODEL:', MODEL);

    const { image_base64 } = await request.json();

    if (!image_base64) {
      return NextResponse.json(
        { success: false, message: '图片数据不能为空' },
        { status: 400 }
      );
    }

    if (!API_KEY) {
      return NextResponse.json(
        { success: false, message: '未配置 GEMINI_API_KEY' },
        { status: 500 }
      );
    }

    const result = await cleanSlideImage(image_base64);

    if (result) {
      return NextResponse.json({
        success: true,
        message: '图片清洗成功',
        data: { image_base64: result }
      });
    } else {
      return NextResponse.json(
        { success: false, message: '图片清洗失败，未能获取有效图片' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('==================== 完整错误信息 ====================');
    console.error('错误类型:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('错误信息:', error);
    console.error('错误堆栈:', error instanceof Error ? error.stack : 'N/A');
    console.error('==================================================');
    return NextResponse.json(
      { success: false, message: `图片清洗失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

async function cleanSlideImage(imageBase64: string): Promise<string | null> {
  const prompt = `You are an image cleaner. Task: remove ALL text from a PPT slide image, especially flowcharts.

Processing order:
1) Inspect the whole slide and every sub-region (all boxes, arrows, connectors, swimlanes, legends).
2) Remove text first, then restore shapes/background.
3) If any text remains, continue erasing until ZERO text is present.

Remove (must erase completely):
- All characters: letters, numbers, symbols, Chinese/Japanese/Korean text, handwriting, watermarks, annotations, axis labels.
- Text inside shapes, inside arrows, along lines/connectors, in legends or captions.
- Erase glyph strokes fully and fill with matching background color/gradient/texture. No residual strokes or halos.

Keep (must preserve exactly):
- Shapes, arrows, connectors, lines, boxes, swimlane dividers, color blocks, gradients, layout, spacing, proportions.
- Do NOT remove or deform arrows/lines/connectors while erasing text.

Negative constraints:
- No text, no numbers, no letters, no words, no logos or watermarks in the output.
- Do not add new text or symbols.

Output requirements:
- Return a clean image with identical layout/colors/shapes but 0 text.
- If any text is still visible, refine until all text is gone.`;

  return callGeminiImageAPI(prompt, imageBase64);
}

async function callGeminiImageAPI(
  prompt: string,
  imageBase64: string
): Promise<string | null> {
  const url = `${API_BASE}/v1beta/models/${MODEL}:generateContent`;

  const parts: any[] = [{ text: prompt }];

  // 解析 base64 图片
  if (imageBase64.startsWith('data:')) {
    const match = imageBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      parts.push({
        inline_data: {
          mime_type: match[1],
          data: match[2]
        }
      });
    }
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '2K'
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText.slice(0, 200)}`);
  }

  const result = await response.json();

  // 从响应中提取图片
  if (result.candidates?.[0]?.content?.parts) {
    for (const part of result.candidates[0].content.parts) {
      if (part.inlineData) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        const imageData = part.inlineData.data;
        return `data:${mimeType};base64,${imageData}`;
      }
    }
  }

  return null;
}
