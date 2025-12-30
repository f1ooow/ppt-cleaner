import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.GEMINI_API_BASE || 'https://api.nkb.nkbpal.cn';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-image-preview';

export async function POST(request: NextRequest) {
  try {
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
    console.error('图片清洗失败:', error);
    return NextResponse.json(
      { success: false, message: `图片清洗失败: ${error}` },
      { status: 500 }
    );
  }
}

async function cleanSlideImage(imageBase64: string): Promise<string | null> {
  const prompt = `请仔细观察这张PPT图片，然后重新生成一张干净的图片。

【必须去除的内容】
1. PPT模板装饰：页眉页脚、角落装饰、边框线条、标题栏装饰
2. 所有文字内容：标题、正文、标签、说明文字等
3. 背景图案：渐变背景、纹理背景、装饰性背景

【必须保留的内容】
1. 核心插图：人物、场景、物品等主体插画
2. 图标元素：功能图标、示意图标
3. 数据可视化：图表、流程图、示意图（去掉其中的文字标签）
4. 文本框/色块框架：保留文本框的形状和颜色，只去除里面的文字
5. 装饰性插画元素

【输出要求】
1. 整体背景改为纯白色
2. 保持原有插图和元素的位置、大小
3. 保持原有的风格和色彩
4. 保持16:9比例
5. 如果页面只有文字没有任何插图，则输出纯白图片

直接生成图片，不要输出任何文字说明。`;

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
