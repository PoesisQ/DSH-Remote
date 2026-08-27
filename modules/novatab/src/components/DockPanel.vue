<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { settings } from '../core/storage';
import { openBrowserPage } from '../core/browser';
import BookmarksCard from './BookmarksCard.vue';
import HistoryCard from './HistoryCard.vue';
import DownloadsCard from './DownloadsCard.vue';
import Icon, { type IconName } from './Icon.vue';
import type { FeatureId } from '../types/settings';

type DockId = Extract<FeatureId, 'bookmarks' | 'history' | 'downloads'>;

interface DockItem {
  id: DockId;
  icon: IconName;
  label: string;
  page: 'bookmarks' | 'history' | 'downloads';
}

const items: DockItem[] = [
  { id: 'bookmarks', icon: 'star', label: '收藏夹', page: 'bookmarks' },
  { id: 'history', icon: 'clock', label: '浏览历史', page: 'history' },
  { id: 'downloads', icon: 'download', label: '下载', page: 'downloads' }
];

const components: Record<DockId, Component> = {
  bookmarks: BookmarksCard,
  history: HistoryCard,
  downloads: DownloadsCard
};

const visible = computed(() => items.filter((i) => settings.features[i.id]));
const openId = ref<DockId | null>(null);
const openItem = computed(() => items.find((i) => i.id === openId.value) ?? null);
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function cancelClose() {
  clearTimeout(closeTimer);
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    openId.value = null;
  }, 200);
}

async function onIconClick(item: DockItem) {
  cancelClose();
  await openBrowserPage(item.page);
}
</script>

<template>
  <div v-if="visible.length" class="dock" @mouseleave="scheduleClose">
    <button
      v-for="i in visible"
      :key="i.id"
      class="dock-icon"
      :class="{ active: openId === i.id }"
      :title="i.label"
      @mouseenter="cancelClose(); openId = i.id"
      @click="onIconClick(i)"
    >
      <Icon :name="i.icon" />
    </button>
    <div v-if="openId && openItem" class="dock-panel" @mouseenter="cancelClose">
      <div class="dock-panel-head"><Icon :name="openItem.icon" :size="15" />{{ openItem.label }}</div>
      <div class="dock-panel-body">
        <component :is="openId ? components[openId] : undefined" panel />
      </div>
    </div>
  </div>
</template>
