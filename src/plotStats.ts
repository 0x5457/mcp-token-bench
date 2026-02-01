export const meanStd = (vals: number[]) => {
  if (vals.length === 0) return { mean: 0, std: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, std: Math.sqrt(variance) };
};

export const wilsonInterval = (successes: number, total: number) => {
  if (total === 0) return { center: 0, low: 0, high: 0 };
  const z = 1.96;
  const phat = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (phat + (z * z) / (2 * total)) / denom;
  const half =
    (z / denom) *
    Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return {
    center,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
};
