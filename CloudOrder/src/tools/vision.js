/**
 * 图片识别工具：调用支持图片输入（vision）的模型，识别图片内容。
 *
 * 主要用途：识别用户上传的衣物照片，产出可直接录入「衣柜」的结构化参数
 * （名称、类别、颜色、材质、风格、季节、版型、品牌等）。
 *
 * 依赖：主模型或 config.visionModel 指向的模型必须支持图片输入
 * （如 deepseek-chat / gpt-4o-mini / qwen-vl-* 等 OpenAI 兼容视觉模型）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../llm.js';
import { WARDROBE_IMAGE_DIR, WARDROBE_DIR, UPLOAD_DIR } from '../config.js';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CLOTHING_SYSTEM = [
  '你是资深的服装与形象分析专家。请仔细观察用户提供的衣物图片，',
  '识别这件衣服的品类、颜色、材质、风格、版型、适合季节以及可观察到的品牌/标识等。',
  '要求：只依据图片中确实可见的信息作答；无法判断的字段一律留空字符串或空数组，并在 unsure 中列明字段名，绝不编造。',
  '最后只输出一个 JSON 对象（不要包裹在 markdown 代码块中，不要输出任何多余文字），字段如下：',
  '{',
  '  "name": "单品名称（品类+颜色+特征，如 米白色针织开衫）",',
  '  "category": "类别，优先从这些里选：上衣/衬衫/针织-毛衣/卫衣/外套/西装/大衣/羽绒服/裤装/裙装/连衣裙/鞋/包/配饰/帽饰/围巾/其他",',
  '  "colors": ["主色与配色，中文，如 米白、卡其"],',
  '  "material": "材质，如 棉 / 羊毛 / 真丝 / 牛仔 / 皮革；看不出来就留空",',
  '  "style": ["风格，如 简约、通勤、休闲、街头、复古"],',
  '  "seasons": ["适合季节，只能取 春/夏/秋/冬"],',
  '  "fit": "版型，如 修身 / 直筒 / 宽松 / oversize",',
  '  "brand": "品牌，能看清标识才填，看不清留空",',
  '  "tags": ["其它特征标签，如 立领、图案、做旧"],',
  '  "notes": "补充说明，如明显的新旧程度、搭配建议",',
  '  "confidence": 0.0,',
  '  "unsure": ["没把握的字段名"]',
  '}'
].join('\n');

const DESCRIBE_SYSTEM =
  '你是一个严谨的图像描述助手。用简洁的中文描述这张图片的主体、颜色、场景以及图中出现的文字；只描述确实可见的内容，不要臆测。';

/** 解析图片参数：dataURL / 本地路径 / 衣柜图片 / http(s) 链接 */
async function resolveImage(input, workspace) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('未提供图片：请传 image 或 path');

  if (/^data:image\//i.test(raw)) {
    const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/s.exec(raw);
    if (!m) throw new Error('dataURL 图片格式无效');
    const bytes = Buffer.from(m[2], 'base64').length;
    if (bytes > MAX_IMAGE_BYTES) throw new Error('图片过大（上限 8MB）');
    return { url: raw, bytes };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, bytes: null };
  }

  // 相对路径候选：衣柜图片目录、数据目录、工作区
  const candidates = [];
  const base = path.basename(raw);
  if (raw.startsWith('images/')) candidates.push(path.join(WARDROBE_DIR, raw));
  if (raw.startsWith('uploads/')) candidates.push(path.join(UPLOAD_DIR, path.basename(raw)));
  candidates.push(path.join(WARDROBE_IMAGE_DIR, base));
  candidates.push(path.join(UPLOAD_DIR, base));
  candidates.push(path.resolve(workspace, raw));
  candidates.push(path.resolve(raw));

  let file = null;
  for (const c of candidates) {
    const st = await fs.stat(c).catch(() => null);
    if (st && st.isFile()) {
      file = c;
      break;
    }
  }
  if (!file) throw new Error(`找不到图片文件：${raw}（已尝试 ${candidates.slice(0, 2).join(' / ')} ...）`);

  const st = await fs.stat(file);
  if (st.size > MAX_IMAGE_BYTES) throw new Error(`图片过大（${(st.size / 1024 / 1024).toFixed(1)}MB，上限 8MB）`);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`不支持的图片类型：${ext || '(无扩展名)'}（仅支持 png/jpg/webp/gif/bmp）`);
  const buf = await fs.readFile(file);
  return { url: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length, file };
}

export function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 执行图片识别（可被工具与 Web 端点复用）。
 * @returns {Promise<{mode:string, model:string, text:string, parsed:object|null}>}
 */
export async function identifyImage(config, args = {}) {
  const workspace = args.workspace || config.workspace;
  const img = await resolveImage(args.image || args.path, workspace);
  const mode = ['clothing', 'describe', 'custom'].includes(args.mode) ? args.mode : 'clothing';

  let system;
  let userText;
  if (mode === 'custom') {
    system = '你是一个严谨的图像分析助手，只依据图片中可见的内容作答，不臆测。';
    userText = String(args.prompt || '请分析这张图片，只描述确实可见的内容。');
  } else if (mode === 'describe') {
    system = DESCRIBE_SYSTEM;
    userText = '请描述这张图片。';
  } else {
    system = CLOTHING_SYSTEM;
    userText = '请识别这件衣物，并按要求的 JSON 字段输出（只输出 JSON）。';
  }

  const model = String(args.model || config.visionModel || config.model || '').trim();
  if (!model) throw new Error('未配置识别模型（config.visionModel / model 均为空）');

  const res = await chatCompletion({
    config: { ...config, model, stream: false, temperature: mode === 'clothing' ? 0.2 : 0.4 },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: img.url } }
        ]
      }
    ],
    signal: args.signal
  });

  const text = String(res.content || '').trim();
  if (!text) throw new Error('模型没有返回识别结果（可能该模型不支持图片输入）');

  return { mode, model, text, parsed: mode === 'clothing' ? parseJsonLoose(text) : null };
}

export function createVisionTools(config) {
  const list = new Map();

  list.set('analyze_image', {
    name: 'analyze_image',
    description:
      '识别与分析一张图片的内容，使用支持图片输入的多模态模型。' +
      'mode=clothing（默认）：识别衣物照片，输出可直接录入「衣柜」的结构化参数（名称/类别/颜色/材质/风格/季节/版型/品牌等），' +
      '用户上传衣服图片、或让你识别衣服的参数时使用；识别结果应先讲给用户确认，再用 wardrobe_add 录入。' +
      'mode=describe：通用描述图片内容。mode=custom：按 prompt 分析。' +
      '图片可来自本地文件路径（相对工作区，或衣柜图片如 images/xxx.png）或 http(s) 链接。',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '图片路径（相对工作区或绝对路径），或 http(s) 图片链接' },
        path: { type: 'string', description: '同 image，二者提供其一即可' },
        mode: { type: 'string', enum: ['clothing', 'describe', 'custom'], description: '分析模式，默认 clothing' },
        prompt: { type: 'string', description: 'mode=custom 时的自定义分析要求' },
        model: { type: 'string', description: '可选：本次识别使用的视觉模型，留空则用配置中的 visionModel / 主模型' }
      },
      required: []
    },
    risk: 'low',
    safeByDefault: true,
    async run(args = {}, ctx = {}) {
      const { mode, model, text, parsed } = await identifyImage(config, {
        ...args,
        workspace: ctx.workspace,
        signal: ctx.signal
      });

      const head = `【图片识别 · ${mode === 'clothing' ? '衣物' : mode === 'describe' ? '描述' : '自定义'}】model=${model}`;

      if (mode !== 'clothing') {
        return `${head}\n${text}`;
      }

      if (!parsed) {
        return `${head}\n（模型未返回规整 JSON，原始输出如下，请自行判断）\n${text}`;
      }
      return [
        head,
        JSON.stringify(parsed, null, 2),
        '',
        '（以上为依据图片推断的参数；unsure 中列出的字段表示模型没有把握，务必先向用户确认，再用 wardrobe_add 录入衣柜。图片本身需由用户在网页版上传。）'
      ].join('\n');
    }
  });

  return list;
}
