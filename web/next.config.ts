import type { NextConfig } from 'next';
import path from 'node:path';

// The site reads canonical JSON that lives beside web/, in the repo's data/ folder. Those
// reads use runtime paths, which Next cannot trace on its own, so the files are declared
// here; without this they are missing from the deployed serverless bundle.
const repoRoot = path.join(import.meta.dirname, '..');
const config: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    '/': ['../data/normalized/daily-*.json', '../data/reference/*.json'],
  },
};
export default config;
