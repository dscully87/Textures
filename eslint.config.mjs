// eslint-config-next ships a native flat config array in Next 16, so it is
// spread directly — FlatCompat is neither needed nor compatible here.
import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
];

export default config;
