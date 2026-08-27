<script setup lang="ts">
import { computed } from 'vue';
import { settings } from '../core/storage';

const text = computed(() => settings.greeting.text.trim());
</script>

<template>
  <div v-if="text" class="corner-greeting" :title="text">{{ text }}</div>
</template>
