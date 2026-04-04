<template><button>{{ label }}</button></template>
<script setup lang="ts">
import { formatLabel } from "../lib/helper";

defineProps<{ label: string }>();
</script>
