<script setup lang="ts">
import { TriangleAlert, X } from '@lucide/vue'
import { useNotices } from './composables/useNotices'
import KernelGate from './components/KernelGate.vue'
import AppToasts from './components/AppToasts.vue'
import EnvListView from './views/EnvListView.vue'

// 启动期通知横幅（08-T8）：db_reset / weak_encryption
const { notices, dismiss } = useNotices()
// 崩溃通知（08-T9）在 EnvListView 内的 useEnvs 回调中订阅
// 主界面不加载任何远程页面（§8）
</script>

<template>
  <div class="app">
    <div v-if="notices.length" class="banners">
      <div v-for="n in notices" :key="n.kind" class="banner banner--warn">
        <span class="banner__msg">
          <TriangleAlert aria-hidden="true" />
          {{ n.message }}
        </span>
        <button
          class="banner__x"
          type="button"
          :aria-label="`关闭提示：${n.message}`"
          title="关闭提示"
          @click="dismiss(n.kind)"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
    <KernelGate>
      <EnvListView />
    </KernelGate>
    <AppToasts />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}
.banners {
  max-width: 860px;
  margin: 12px auto 0;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.banner__msg {
  display: flex;
  align-items: center;
  gap: 6px;
}
.banner--warn {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
.banner__x {
  border: none;
  background: none;
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
}
.banner__x:hover {
  background: rgb(146 64 14 / 10%);
}
</style>
