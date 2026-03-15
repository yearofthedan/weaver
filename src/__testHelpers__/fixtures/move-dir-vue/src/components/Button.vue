<template><button>{{ label }}</button></template>
<script setup lang="ts">
import { formatLabel } from "./utils";

defineProps<{ label: string }>();
</script>
