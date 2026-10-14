/** 技能（Skills）工具：渐进式披露的加载入口 */
export function createSkillTools(config, skillsRef) {
  const list = new Map();

  list.set('load_skill', {
    name: 'load_skill',
    description:
      '读取某个技能的完整说明文档。当用户请求与某个技能相关时，先调用它获取详细步骤，再按说明执行。' +
      '已有上下文里如果已经加载过同一技能，不要重复加载。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名，必须与技能列表中的名字完全一致' }
      },
      required: ['name']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const skills = skillsRef.current ?? new Map();
      const skill = skills.get(String(args.name));
      if (!skill) {
        const names = [...skills.keys()].join(', ') || '(无)';
        throw new Error(`未找到技能 "${args.name}"。可用技能: ${names}`);
      }
      const parts = [`# 技能：${skill.name}`, '', skill.body];
      if (skill.resources?.length) {
        parts.push('', '## 附带资源', skill.resources.map((r) => `- ${r}`).join('\n'));
      }
      if (skill.dir) {
        parts.push('', `技能目录：${skill.dir}`);
      }
      return parts.join('\n');
    }
  });

  list.set('list_skills', {
    name: 'list_skills',
    description: '列出本机已安装的全部技能及其用途。',
    parameters: { type: 'object', properties: {} },
    risk: 'low',
    safeByDefault: true,
    async run() {
      const skills = skillsRef.current ?? new Map();
      if (!skills.size) return '当前没有安装任何技能。技能放在 skills/ 目录下，每个技能是含 SKILL.md 的文件夹。';
      return [...skills.values()].map((s) => `- ${s.name}: ${s.description}`).join('\n');
    }
  });

  return list;
}
