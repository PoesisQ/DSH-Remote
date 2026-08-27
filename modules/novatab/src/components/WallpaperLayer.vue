<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { settings } from '../core/storage';
import { getImage } from '../core/images';

const objectUrl = ref<string | null>(null);
const grainUrl = ref('');
let currentUrl: string | null = null;

watch(
  () => settings.wallpaper.imageId,
  async (id) => {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    objectUrl.value = null;
    if (!id) return;
    const blob = await getImage(id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    objectUrl.value = url;
  },
  { immediate: true }
);

const wp = computed(() => settings.wallpaper);
const isGradient = computed(() => wp.value.mode === 'gradient' || !objectUrl.value);

const gradientStyle = computed(() => ({
  background: `linear-gradient(135deg, ${wp.value.gradientFrom}, ${wp.value.gradientTo})`
}));

const filterCss = computed(() => {
  const parts: string[] = [];
  if (wp.value.blur > 0) parts.push(`blur(${wp.value.blur}px)`);
  parts.push(`brightness(${wp.value.brightness})`);
  parts.push(`contrast(${wp.value.contrast})`);
  parts.push(`saturate(${wp.value.saturation})`);
  return parts.join(' ');
});

const imgStyle = computed(() => {
  const zoom = wp.value.zoom * (wp.value.blur > 0 ? 1.06 : 1);
  const tx = (wp.value.posX - 50) * 2;
  const ty = (wp.value.posY - 50) * 2;
  return {
    filter: filterCss.value,
    transform: `scale(${zoom}) translate(${tx}%, ${ty}%)`
  };
});

const tileStyle = computed(() => ({
  backgroundImage: objectUrl.value ? `url("${objectUrl.value}")` : 'none',
  backgroundRepeat: 'repeat',
  backgroundSize: `${100 / wp.value.zoom}%`,
  filter: filterCss.value
}));

const vignetteStyle = computed(() => {
  const v = wp.value.vignette;
  const inner = Math.max(0, 100 - v * 65);
  return {
    background: `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${(v * 0.9).toFixed(3)}) 100%)`
  };
});

const dimStyle = computed(() => ({ background: `rgba(0,0,0,${wp.value.dim})` }));

onMounted(() => {
  // 运行时生成噪点贴图，避免内置图片资源
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 18;
  }
  ctx.putImageData(img, 0, 0);
  grainUrl.value = canvas.toDataURL();
});
</script>

<template>
  <div class="wallpaper-layer" aria-hidden="true">
    <div class="bg" :style="gradientStyle" />
    <img
      v-if="!isGradient && wp.fit !== 'tile'"
      class="img"
      :class="`fit-${wp.fit}`"
      :src="objectUrl || ''"
      :style="imgStyle"
      alt=""
    />
    <div v-else-if="!isGradient" class="img tile" :style="tileStyle" />
    <div class="fx vignette" :style="vignetteStyle" />
    <div class="fx dim" :style="dimStyle" />
    <div
      v-if="wp.grain > 0 && grainUrl"
      class="fx grain"
      :style="{ backgroundImage: `url(${grainUrl})`, opacity: wp.grain }"
    />
  </div>
</template>
