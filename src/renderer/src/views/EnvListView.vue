<script setup lang="ts">
import { onMounted, ref } from 'vue'

// 07-env-manager 接线前，env:list 返回 NOT_IMPLEMENTED 信封 —— 属预期占位
const message = ref('加载中…')

onMounted(async () => {
  const res = await window.api.envList()
  if (res.ok) {
    message.value = res.data.length > 0 ? `共 ${res.data.length} 个环境` : '暂无环境'
  } else {
    message.value = `通道占位中：${res.error.code}`
  }
})
</script>

<template>
  <section class="env-list">
    <h2>环境列表</h2>
    <p>{{ message }}</p>
    <p class="empty">环境管理由 02-storage / 07-env-manager 模块提供。</p>
  </section>
</template>

<style scoped>
.env-list {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
h2 {
  font-size: 16px;
  margin: 0 0 8px;
}
.empty {
  color: #9ca3af;
  font-size: 13px;
}
</style>
