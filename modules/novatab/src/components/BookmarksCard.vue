<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { featureMap } from '../core/featureRegistry';
import { onPermissionsAdded, requestPermissions } from '../core/permissions';
import { settings } from '../core/storage';
import { favicon } from '../core/utils';
import Icon from './Icon.vue';
import { toast } from '../core/toast';

defineProps<{ panel?: boolean }>();

interface BmNode {
  id: string;
  title: string;
  url?: string;
  children?: BmNode[];
}

interface FlatBm {
  id: string;
  title: string;
  url: string;
  path: string;
}

const ready = ref(false);
const denied = ref(false);
const roots = ref<BmNode[]>([]);
const nodes = ref<BmNode[]>([]);
const flat = ref<FlatBm[]>([]);
const query = ref('');
const folder = ref<BmNode | null>(null);

function flatten(list: BmNode[], path: string, acc: FlatBm[]) {
  for (const n of list) {
    if (n.url) acc.push({ id: n.id, title: n.title || n.url, url: n.url, path });
    if (n.children && n.children.length) {
      flatten(n.children, path ? `${path} › ${n.title}` : n.title, acc);
    }
  }
}

function compute() {
  const root = settings.bookmarks.rootId ? roots.value.find((r) => r.id === settings.bookmarks.rootId) : undefined;
  const start = root ? root.children ?? [] : roots.value;
  nodes.value = start;
  const acc: FlatBm[] = [];
  flatten(start, '', acc);
  flat.value = acc;
  folder.value = null;
}

async function init() {
  const ok = await requestPermissions(featureMap.bookmarks);
  if (!ok) {
    denied.value = true;
    return;
  }
  try {
    const tree = await chrome.bookmarks.getTree();
    roots.value = tree[0]?.children ?? [];
    compute();
    ready.value = true;
    denied.value = false;
  } catch {
    denied.value = true;
  }
}

let offPermissionAdded: (() => void) | undefined;

function onPermissionAdded(perms: chrome.permissions.Permissions) {
  if (perms.permissions?.includes('bookmarks')) void init();
}

onMounted(() => {
  void init();
  offPermissionAdded = onPermissionsAdded(onPermissionAdded);
});

onUnmounted(() => {
  offPermissionAdded?.();
});

watch(
  () => settings.bookmarks.rootId,
  () => {
    if (ready.value) compute();
  }
);

const showContents = computed(() => settings.bookmarks.showContents);
const list = computed(() => flat.value.slice(0, settings.bookmarks.maxItems));
const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return flat.value
    .filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    .slice(0, 15);
});
const folderItems = computed(() => folder.value?.children ?? []);

function countLinks(n: BmNode): number {
  if (n.url) return 1;
  return (n.children ?? []).reduce((sum, c) => sum + countLinks(c), 0);
}

async function removeBookmark(id: string) {
  try {
    await chrome.bookmarks.remove(id);
    toast('已删除');
    await init();
  } catch {
    toast('删除失败');
  }
}

function onFaviconError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <div v-if="denied" class="dock-denied">
    <div class="hint">需要收藏夹权限才能显示</div>
    <button class="chip" @click="init()">授权并加载</button>
  </div>
  <template v-else-if="ready">
    <div v-if="!panel" class="bm-toolbar">
      <input v-model="query" class="mini-input" type="text" placeholder="搜索收藏夹…" />
      <button class="chip" @click="settings.bookmarks.showContents = !settings.bookmarks.showContents">
        {{ showContents ? '只显示文件夹' : '显示全部内容' }}
      </button>
    </div>

    <div v-if="query && !panel" class="bm-list">
      <a v-for="b in searchResults" :key="b.id" class="bm-item" :href="b.url" target="_blank" rel="noreferrer">
        <img class="favicon" :src="favicon(b.url, 32)" alt="" @error="onFaviconError" />
        <span class="bm-title">{{ b.title }}</span>
        <span class="bm-path">{{ b.path }}</span>
      </a>
      <div v-if="!searchResults.length" class="hint">没有匹配的收藏</div>
    </div>

    <template v-else-if="!showContents">
      <div v-if="folder" class="bm-crumb">
        <button class="chip" @click="folder = null">← 返回</button>
        <span class="bm-path">{{ folder.title }}</span>
      </div>
      <div class="bm-list">
        <template v-for="n in folder ? folderItems : nodes" :key="n.id">
          <button v-if="!n.url" class="bm-item" type="button" @click="folder = n">
            <span class="bm-folder"><Icon name="folder" :size="15" /></span>
            <span class="bm-title">{{ n.title }}</span>
            <span class="bm-path">{{ countLinks(n) }} 项</span>
          </button>
          <a v-else class="bm-item" :href="n.url" target="_blank" rel="noreferrer">
            <img class="favicon" :src="favicon(n.url, 32)" alt="" @error="onFaviconError" />
            <span class="bm-title">{{ n.title || n.url }}</span>
          </a>
        </template>
        <div v-if="!(folder ? folderItems : nodes).length" class="hint">该文件夹为空</div>
      </div>
    </template>

    <div v-else class="bm-list">
      <a v-for="b in list" :key="b.id" class="bm-item" :href="b.url" target="_blank" rel="noreferrer">
        <img class="favicon" :src="favicon(b.url, 32)" alt="" @error="onFaviconError" />
        <span class="bm-title">{{ b.title }}</span>
        <span class="bm-path">{{ b.path }}</span>
        <button class="mini" title="删除收藏" @click.prevent="removeBookmark(b.id)">✕</button>
      </a>
      <div v-if="!list.length" class="hint">收藏夹为空</div>
    </div>
  </template>
  <div v-else class="hint">加载中…</div>
</template>
