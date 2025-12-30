/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    // 忽略 pdfjs-dist 的 canvas 依赖（浏览器中使用原生 canvas）
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
