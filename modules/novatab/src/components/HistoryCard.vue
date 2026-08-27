<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { featureMap } from '../core/featureRegistry';
import { onPermissionsAdded, requestPermissions } from '../core/permissions';
import { settings } from '../core/storage';
import { openBrowserPage } from '../core/browser';
import { favicon, timeAgo } from '../core/utils';

defineProps<{ panel?: boolean }>();

const items = ref<chrome.history.HistoryItem[]>([]);
const denied = ref(false);

async function load() {
  const ok = await requestPermissions(featureMap.history);
  if (!ok) {
    denied.value = true;
    return;
  }
  try {
    items.value = await chrome.history.search({
      text: '',
      maxResults: settings.history.maxItems,
      startTime: Date.now() - 7 * 86_400_000
    });
    denied.value = false;
  } catch {
    denied.value = true;
  }
}

let offPermissionAdded: (() => void) | undefined;

function onPermissionAdded(perms: chrome.permissions.Permissions) {
  if (perms.permissions?.includes('history')) void load();
}

onMounted(() => {
  void load();
  offPermissionAdded = onPermissionsAdded(onPermissionAdded);
});

onUnmounted(() => {
  offPermissionAdded?.();
});

function onFaviconError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <div v-if="denied" class="dock-denied">
    <div class="hint">需要历史记录权限才能显示</div>
    <button class="chip" @click="load()">授权并加载</button>
  </div>
  <template v-else>
    <div class="bm-list">
      <a
        v-for="h in items"
        :key="h.id"
        class="bm-item"
        :href="h.url || ''"
        target="_blank"
        rel="noreferrer"
      >
        <img class="favicon" :src="favicon(h.url || '', 32)" alt="" @error="onFaviconError" />
        <span class="bm-title">{{ h.title || h.url }}</span>
        <span class="bm-path">{{ timeAgo(h.lastVisitTime ?? 0) }}</span>
      </a>
      <div v-if="!items.length" class="hint">暂无历史记录</div>
    </div>
    <button v-if="!panel" class="chip" @click="openBrowserPage('history')">打开完整历史 ↗</button>
  </template>
</template>
