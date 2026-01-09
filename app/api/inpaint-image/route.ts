import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.GEMINI_API_BASE || 'https://api.nkb.nkbpal.cn';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-image-preview';

export async function POST(request: NextRequest) {
  try {
    console.log('API_BASE:', API_BASE);
    console.log('API_KEY:', API_KEY ? '已配置' : '未配置');
    console.log('MODEL:', MODEL);

    const { image_base64, mask_base64, instruction } = await request.json();

    if (!image_base64) {
      return NextResponse.json(
        { success: false, message: '图片数据不能为空' },
        { status: 400 }
      );
    }

    if (!mask_base64) {
      return NextResponse.json(
        { success: false, message: '遮罩数据不能为空' },
        { status: 400 }
      );
    }

    if (!instruction) {
      return NextResponse.json(
        { success: false, message: '编辑指令不能为空' },
        { status: 400 }
      );
    }

    if (!API_KEY) {
      return NextResponse.json(
        { success: false, message: '未配置 GEMINI_API_KEY' },
        { status: 500 }
      );
    }

    const result = await inpaintImage(image_base64, mask_base64, instruction);

    if (result) {
      return NextResponse.json({
        success: true,
        message: '图片编辑成功',
        data: { image_base64: result }
      });
    } else {
      return NextResponse.json(
        { success: false, message: '图片编辑失败，未能获取有效图片' },
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
      { success: false, message: `图片编辑失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

async function inpaintImage(
  imageBase64: string,
  maskBase64: string,
  instruction: string
): Promise<string | null> {
  const url = `${API_BASE}/v1beta/models/${MODEL}:generateContent`;

  const prompt = `请根据遮罩区域（白色部分）对图片进行编辑。

【编辑指令】
${instruction}

【要求】
1. 只修改遮罩白色区域标记的部分
2. 保持图片其他区域完全不变
3. 修改后的内容要与周围环境自然融合
4. 保持原图的风格和色调

直接输出编辑后的完整图片。`;

  const parts: any[] = [{ text: prompt }];

  // 添加原始图片
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
  } else {
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: imageBase64
      }
    });
  }

  // 添加遮罩图片
  if (maskBase64.startsWith('data:')) {
    const match = maskBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      parts.push({
        inline_data: {
          mime_type: match[1],
          data: match[2]
        }
      });
    }
  } else {
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: maskBase64
      }
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
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
