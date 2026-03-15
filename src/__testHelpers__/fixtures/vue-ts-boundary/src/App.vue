<script setup lang="ts">
import { greetUser } from "./utils";

const _message = greetUser("world");
</script>

<template>
  <div>{{ message }}</div>
</template>
