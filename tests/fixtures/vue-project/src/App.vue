<script setup lang="ts">
import { useCounter } from "./composables/useCounter";

const _counter = useCounter(0);
</script>

<template>
  <div>{{ counter.count() }}</div>
</template>
