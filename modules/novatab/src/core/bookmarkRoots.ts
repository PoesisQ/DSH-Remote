import { featureMap } from './featureRegistry';
import { requestPermissions } from './permissions';

export interface BmRoot {
  id: string;
  title: string;
}

let cache: BmRoot[] | null = null;

/** 获取收藏夹顶层根文件夹（书签栏、其他书签…），失败/无权限返回空数组 */
export async function getRootFolders(): Promise<BmRoot[]> {
  if (cache) return cache;
  const ok = await requestPermissions(featureMap.bookmarks);
  if (!ok) return [];
  try {
    const tree = await chrome.bookmarks.getTree();
    cache = (tree[0]?.children ?? []).map((n) => ({ id: n.id, title: n.title }));
    return cache;
  } catch {
    return [];
  }
}

export function invalidateRootFolders() {
  cache = null;
}
