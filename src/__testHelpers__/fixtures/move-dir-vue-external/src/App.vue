<template><div>{{ count }}</div></template>
<script setup lang="ts">
import { useCounter } from "./composables/useCounter";
import Button from "./components/Button.vue";

const { count } = useCounter();
</script>
