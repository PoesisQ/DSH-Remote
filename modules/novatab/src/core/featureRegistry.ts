import type { FeatureId } from '../types/settings';

export interface FeatureDef {
  id: FeatureId;
  label: string;
  icon: string;
  description: string;
  defaultOn: boolean;
  card: boolean;
  permissions?: { permissions?: string[]; origins?: string[] };
}

export const FEATURES: FeatureDef[] = [
  { id: 'wallpaper', label: '壁纸与效果', icon: '🖼️', description: '本地壁纸、渐变、暗角等视觉效果', defaultOn: true, card: false },
  { id: 'clock', label: '问候语', icon: '💬', description: '页面左下角的自定义问候文字', defaultOn: true, card: false },
  { id: 'search', label: '搜索栏', icon: '🔍', description: '多引擎搜索、建议词、搜索历史与最常搜索', defaultOn: true, card: false },
  { id: 'bookmarks', label: '收藏夹', icon: '⭐', description: '左上角图标：悬停展开收藏夹，点击进入书签管理', defaultOn: true, card: true, permissions: { permissions: ['bookmarks'] } },
  { id: 'quicklinks', label: '常用网址', icon: '🚀', description: '搜索栏下方的常用网址行：网站图标 + 可编辑名称', defaultOn: true, card: true, permissions: { permissions: ['topSites'] } },
  { id: 'todos', label: '待办事项', icon: '📝', description: '搜索栏下方的待办宽条：可设时间、位置可调、悬停滚动', defaultOn: true, card: true },
  { id: 'history', label: '浏览历史', icon: '🕘', description: '左上角图标：悬停查看最近历史，点击进入历史页', defaultOn: false, card: true, permissions: { permissions: ['history'] } },
  { id: 'downloads', label: '下载', icon: '⬇️', description: '左上角图标：悬停查看最近下载，点击进入下载页', defaultOn: false, card: true, permissions: { permissions: ['downloads'] } },
  { id: 'browserlinks', label: '浏览器入口', icon: '⚙️', description: '右上角的浏览器功能快捷图标', defaultOn: true, card: true }
];

export const featureMap = Object.fromEntries(FEATURES.map((f) => [f.id, f])) as Record<FeatureId, FeatureDef>;
