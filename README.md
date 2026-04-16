# COT Buck ESR 网页分析工具

这是一个可直接部署到 Vercel 的 Vite + React 项目。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 部署到 Vercel

1. 把整个项目上传到 GitHub 仓库
2. 登录 Vercel，点击 **Add New > Project**
3. 导入这个仓库
4. Framework 选择 **Vite**（通常会自动识别）
5. Build Command 保持 `npm run build`
6. Output Directory 保持 `dist`
7. 点击 Deploy

## 说明

- 所有计算都在浏览器端完成，不需要后端服务器
- 可导入 SIMPLIS CSV，对比 Python 理论与仿真波特图
- 可导出曲线和汇总 CSV
