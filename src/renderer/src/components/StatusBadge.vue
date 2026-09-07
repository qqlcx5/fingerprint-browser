<script setup lang="ts">
import { computed } from 'vue'
import type { EnvStatus } from '@shared/types'

const props = defineProps<{ status: EnvStatus }>()

const LABEL: Record<EnvStatus, string> = {
  idle: '空闲',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中'
}

const cls = computed(() => `badge badge--${props.status}`)
</script>

<template>
  <span :class="cls">{{ LABEL[props.status] }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
}
.badge--idle {
  background: #f3f4f6;
  color: #6b7280;
}
.badge--starting,
.badge--stopping {
  background: #fef3c7;
  color: #b45309;
}
.badge--running {
  background: #dcfce7;
  color: #15803d;
}
</style>
