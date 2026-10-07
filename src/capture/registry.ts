import type { HookDefinition, PluginConfig } from './types';

const configs = import.meta.glob('../../abx-plugins/abx_plugins/plugins/*/config.json', { eager: true, import: 'default' }) as Record<string, PluginConfig>;
declare const __ABX_HOOK_PATHS__: string[];
export const plugins = Object.fromEntries(Object.entries(configs).map(([path, config]) => [path.split('/').at(-2)!, config]));
export const hooks: HookDefinition[] = __ABX_HOOK_PATHS__.map(key => {
  const name = key.split('/').at(-1)!;
  const plugin = key.split('/').at(-3)!;
  const match = /^on_(\w+)__(?:(\d+)_)?(.+)$/.exec(name)!;
  return { key, plugin, name, event: match[1]!, order: Number(match[2] || 0), background: name.includes('.bg.'), config: plugins[plugin]! };
}).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

export function selectPlugins(selected: string[]): string[] {
  const result = new Set<string>();
  const visiting = new Set<string>();
  function add(name: string) {
    if (visiting.has(name)) throw new Error(`Plugin dependency cycle: ${name}`);
    if (result.has(name)) return;
    if (!plugins[name]) throw new Error(`Unknown plugin: ${name}`);
    visiting.add(name);
    for (const dep of plugins[name].required_plugins || []) add(dep);
    visiting.delete(name); result.add(name);
  }
  selected.forEach(add);
  return [...result];
}
