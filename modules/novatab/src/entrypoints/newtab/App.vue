<script setup lang="ts">
import { computed, ref } from 'vue';
import WallpaperLayer from '../../components/WallpaperLayer.vue';
import SearchBar from '../../components/SearchBar.vue';
import QuickLinksBar from '../../components/QuickLinksBar.vue';
import TodoBar from '../../components/TodoBar.vue';
import CornerGreeting from '../../components/CornerGreeting.vue';
import TopBar from '../../components/TopBar.vue';
import DockPanel from '../../components/DockPanel.vue';
import Icon from '../../components/Icon.vue';
import SettingsPanel from '../../components/SettingsPanel.vue';
import SuiteLink from '../../components/SuiteLink.vue';
import { settings } from '../../core/storage';
import { toasts } from '../../core/toast';

const rootStyle = computed(() => ({
  '--card-opacity': String(settings.layout.cardOpacity),
  '--card-blur': `${settings.layout.cardBlur}px`
}));

// 没有问候语时搜索栏稍下移，避免贴顶局促
const heroClass = computed(() => ({ solo: !settings.features.clock }));
const panelOpen = ref(false);
</script>

<template>
  <div class="ntp" :style="rootStyle">
    <WallpaperLayer v-if="settings.features.wallpaper" />
    <main class="content">
      <header v-if="settings.features.search" class="hero" :class="heroClass">
        <SearchBar />
      </header>
      <QuickLinksBar v-if="settings.features.quicklinks" />
      <TodoBar v-if="settings.features.todos" />
    </main>
    <CornerGreeting v-if="settings.features.clock" />
    <DockPanel />
    <TopBar v-if="settings.features.browserlinks" />
    <button class="gear" title="设置" @click="panelOpen = true"><Icon name="settings" :size="30" /></button>
    <SettingsPanel :open="panelOpen" @update:open="panelOpen = $event" />
    <SuiteLink />
    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast">{{ t.text }}</div>
    </div>
  </div>
</template>
