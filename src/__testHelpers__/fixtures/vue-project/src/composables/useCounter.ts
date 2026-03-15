export function useCounter(initialValue = 0) {
  let count = initialValue;
  return {
    count: () => count,
    increment: () => {
      count++;
    },
  };
}
