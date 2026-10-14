/**
 * 衣柜（Wardrobe）工具：读取/维护本地衣物数据库。
 *
 * 关键约束（写进工具描述，让模型遵守）：
 *   推荐穿搭时**只能**从衣柜里挑选单品，不得编造衣柜中没有的衣物。
 */
import * as wardrobe from '../wardrobe.js';

export function createWardrobeTools(config) {
  const list = new Map();
  void config;

  list.set('wardrobe_list', {
    name: 'wardrobe_list',
    description:
      '查看「衣柜」中当前可用的衣物（本地数据库）。推荐穿搭前应先调用它，只从返回的单品中挑选搭配。' +
      '支持按类别/颜色/季节/风格筛选，也支持关键词搜索；不传参数则返回全部单品。' +
      '若衣柜为空，应提醒用户先在网页版「衣柜」入口录入衣物，不要凭空编造单品。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按类别筛选，如 上衣 / 裤装 / 鞋 / 外套' },
        color: { type: 'string', description: '按颜色筛选，如 黑 / 白 / 卡其' },
        season: { type: 'string', description: '按季节筛选：春 / 夏 / 秋 / 冬' },
        style: { type: 'string', description: '按风格筛选，如 简约 / 街头 / 通勤' },
        keyword: { type: 'string', description: '关键词，会匹配名称、材质、备注等' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args = {}) {
      const items = wardrobe.listItems(args);
      const total = wardrobe.listAll().length;
      if (!total) {
        return [
          '衣柜为空：用户尚未录入任何衣物。',
          '请告诉用户：先在网页版右上角的「衣柜」入口添加衣物（名称、类别、颜色、材质、季节、风格，可上传图片），',
          '然后你才能基于真实单品给出搭配。不要编造衣柜里没有的衣服。'
        ].join('\n');
      }
      if (!items.length) {
        return `没有符合筛选条件的单品（衣柜共 ${total} 件）。可放宽条件或调用 wardrobe_list 查看全部。`;
      }
      const header = `衣柜共 ${total} 件，符合条件 ${items.length} 件：`;
      const body = items.map((it) => wardrobe.formatItem(it, { detail: false })).join('\n');
      return `${header}\n${body}\n\n（搭配时只能从以上单品中挑选；需要某件单品的完整参数用 wardrobe_get。若搭配需要但衣柜里没有的单品，应明确告诉用户「衣柜里缺 XX」，而不是假装它有。）`;
    }
  });

  list.set('wardrobe_get', {
    name: 'wardrobe_get',
    description: '读取衣柜中某一件单品的完整参数（材质、颜色、版型、尺码、品牌、备注、图片等）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '单品 id，如 w_xxx（从 wardrobe_list 获得）' },
        name: { type: 'string', description: '若不传 id，可用名称精确查找' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args = {}) {
      let item = null;
      if (args.id) item = wardrobe.getItem(String(args.id));
      if (!item && args.name) {
        const key = String(args.name).trim();
        item = wardrobe.listItems({ keyword: key }).find((it) => it.name === key) || null;
      }
      if (!item) {
        const names = wardrobe.listAll().map((it) => `${it.name}[${it.id}]`).join('、') || '(空)';
        throw new Error(`未找到该单品。当前衣柜：${names}`);
      }
      const d = [
        `【单品】${item.name}`,
        `  id：${item.id}`,
        item.category ? `  类别：${item.category}` : '',
        item.colors?.length ? `  颜色：${item.colors.join(' / ')}` : '',
        item.material ? `  材质：${item.material}` : '',
        item.style?.length ? `  风格：${item.style.join(' / ')}` : '',
        item.seasons?.length ? `  适合季节：${item.seasons.join(' / ')}` : '',
        item.fit ? `  版型：${item.fit}` : '',
        item.size ? `  尺码：${item.size}` : '',
        item.brand ? `  品牌：${item.brand}` : '',
        item.tags?.length ? `  标签：${item.tags.join(' / ')}` : '',
        item.notes ? `  备注：${item.notes}` : '',
        item.image ? `  图片：/api/wardrobe/image/${item.image.split('/').pop()}` : ''
      ].filter(Boolean);
      return d.join('\n');
    }
  });

  list.set('wardrobe_add', {
    name: 'wardrobe_add',
    description:
      '向衣柜新增一件衣物。名称必填；类别、颜色、材质、风格、季节、版型、尺码、品牌、备注等尽量补全，' +
      '参数越全后续搭配越准确。若用户用自然语言描述了新买的衣服，可先确认关键参数再调用本工具。' +
      '（图片需用户在网页版上传，本工具不处理图片内容。）',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '单品名称，如「白色府绸衬衫」' },
        category: { type: 'string', description: '类别，如 上衣 / 衬衫 / 裤装 / 鞋 / 外套' },
        colors: { type: 'array', items: { type: 'string' }, description: '颜色，如 ["白","蓝"]' },
        material: { type: 'string', description: '材质，如 棉 / 羊毛 / 真丝 / 牛仔' },
        style: { type: 'array', items: { type: 'string' }, description: '风格，如 ["简约","通勤"]' },
        seasons: { type: 'array', items: { type: 'string' }, description: '适合季节，取自 春/夏/秋/冬' },
        fit: { type: 'string', description: '版型，如 修身 / 直筒 / 宽松 / oversize' },
        size: { type: 'string', description: '尺码，如 M / 39 / 均码' },
        brand: { type: 'string', description: '品牌' },
        tags: { type: 'array', items: { type: 'string' }, description: '自定义标签' },
        notes: { type: 'string', description: '备注（新旧程度、搭配注意等）' }
      },
      required: ['name']
    },
    risk: 'medium',
    safeByDefault: false,
    async run(args = {}) {
      const item = wardrobe.addItem(args);
      return `已加入衣柜：${item.name}（id ${item.id}）。当前衣柜共 ${wardrobe.listAll().length} 件。`;
    }
  });

  list.set('wardrobe_update', {
    name: 'wardrobe_update',
    description: '修改衣柜中某件单品的参数（只传需要改的字段，其余保持不变）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要修改的单品 id（必填）' },
        name: { type: 'string', description: '新名称' },
        category: { type: 'string', description: '新类别' },
        colors: { type: 'array', items: { type: 'string' }, description: '新颜色列表' },
        material: { type: 'string', description: '新材质' },
        style: { type: 'array', items: { type: 'string' }, description: '新风格列表' },
        seasons: { type: 'array', items: { type: 'string' }, description: '新季节列表' },
        fit: { type: 'string', description: '新版型' },
        size: { type: 'string', description: '新尺码' },
        brand: { type: 'string', description: '新品牌' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签' },
        notes: { type: 'string', description: '新备注' }
      },
      required: ['id']
    },
    risk: 'medium',
    safeByDefault: false,
    async run(args = {}) {
      const { id, ...patch } = args;
      const item = wardrobe.updateItem(String(id), patch);
      return `已更新：${item.name}（id ${item.id}）。`;
    }
  });

  list.set('wardrobe_remove', {
    name: 'wardrobe_remove',
    description: '从衣柜中删除一件单品（不可恢复，图片一并删除）。删除前建议先向用户确认。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的单品 id（必填）' }
      },
      required: ['id']
    },
    risk: 'high',
    safeByDefault: false,
    async run(args = {}) {
      const removed = wardrobe.removeItem(String(args.id));
      return `已从衣柜删除：${removed.name}（id ${removed.id}）。当前衣柜共 ${wardrobe.listAll().length} 件。`;
    }
  });

  return list;
}
