/** @type {import('next').NextConfig} */
const nextConfig = {
  // 允许外部图片
  images: {
    unoptimized: true,
  },
  // 禁用静态导出时的图片优化
  output: 'standalone',
};

module.exports = nextConfig;
